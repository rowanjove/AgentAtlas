import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {
  assertSafeRelativePath,
  detectUnsafeHtmlOrMdx,
  parseKnowledgeMarkdown,
  validateContentBundle,
  previewObsidianImport,
} from '../index.js';
import { ContentBundle } from '@agent-atlas/shared';

function makeEmptyBundle(): ContentBundle {
  return {
    version: '1.0.0',
    compiledAt: '2026-11-26T00:00:00Z',
    sources: [
      {
        id: 'anthropic.effective-agents',
        title: 'Building effective agents',
        url: 'https://www.anthropic.com/engineering/building-effective-agents',
        kind: 'engineering-blog',
        licenseStatus: 'Reference link only',
        upstreamVersion: '2024-12',
        verifiedAt: '2026-11-26',
      },
    ],
    glossary: [],
    nodes: [],
    relations: [],
    paths: [],
    assessments: [],
    labs: [],
    ecosystem: [],
    casebooks: [],
  };
}

describe('@agent-atlas/content security and validation', () => {
  it('blocks path traversal and absolute paths', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sec-'));
    expect(() => assertSafeRelativePath(tmp, '../secret.txt')).toThrow(/Path traversal/);
    expect(() => assertSafeRelativePath(tmp, 'C:\\Windows\\win.ini')).toThrow(/Path traversal/);
    expect(() => assertSafeRelativePath(tmp, 'sub/../../etc/passwd')).toThrow(/Path traversal/);
    const ok = assertSafeRelativePath(tmp, 'knowledge/agent-loop.md');
    expect(ok).toBe(path.resolve(tmp, 'knowledge/agent-loop.md'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('detects XSS scripts, event handlers, and MDX imports in prose while allowing fenced code', () => {
    const safeDoc = '```tsx\nimport React from "react";\n<script>console.log(1)</script>\n```\n\nNormal text with `<script>` and `javascript:alert(1)` examples.';
    expect(detectUnsafeHtmlOrMdx(safeDoc)).toHaveLength(0);

    const xssDoc = 'Hello <script>alert(1)</script> and <img src=x onerror="alert(2)">';
    const findings = detectUnsafeHtmlOrMdx(xssDoc);
    expect(findings.length).toBeGreaterThanOrEqual(2);

    // Unquoted event handler, backtick attribute bypass, <svg>, and HTML-entity URI bypass
    expect(detectUnsafeHtmlOrMdx('<img src=x onerror=alert(1)>').some((f) => f.code === 'UNSAFE_EVENT_HANDLER')).toBe(true);
    expect(detectUnsafeHtmlOrMdx('<img src=x onerror=`alert(1)`>').some((f) => f.code === 'UNSAFE_EVENT_HANDLER')).toBe(true);
    expect(detectUnsafeHtmlOrMdx('<img alt=">" onerror=alert(1)>').some((f) => f.code === 'UNSAFE_EVENT_HANDLER')).toBe(true);
    expect(detectUnsafeHtmlOrMdx('<svg onload=alert(1)>').some((f) => f.code === 'UNSAFE_HTML_TAG')).toBe(true);
    expect(detectUnsafeHtmlOrMdx('[x](javascript&#58;alert(1))').some((f) => f.code === 'UNSAFE_JS_URI')).toBe(true);
  });

  it('blocks executable gray-matter js/javascript frontmatter engines during parse and import preview', () => {
    const bundle = makeEmptyBundle();
    const markerKey = '__atlas_rce_test__';
    delete (globalThis as Record<string, unknown>)[markerKey];

    const jsFrontmatter = `---js
{ id: 'node.rce', title: (() => { globalThis.${markerKey} = true; return 'RCE'; })() }
---
Body`;
    const javascriptFrontmatter = jsFrontmatter.replace('---js', '---javascript');

    expect(() => parseKnowledgeMarkdown(jsFrontmatter, 'rce.md')).toThrow(/Executable frontmatter engine is disabled/);
    expect((globalThis as Record<string, unknown>)[markerKey]).toBeUndefined();

    const preview = previewObsidianImport(
      [
        { filename: 'js.md', content: jsFrontmatter },
        { filename: 'javascript.md', content: javascriptFrontmatter },
      ],
      bundle,
    );
    expect(preview.valid).toBe(false);
    expect(preview.items[0].action).toBe('rejected');
    expect(preview.items[1].action).toBe('rejected');
    expect((globalThis as Record<string, unknown>)[markerKey]).toBeUndefined();
  });

  it('detects duplicate IDs and prerequisite DAG cycles', () => {
    const bundle = makeEmptyBundle();
    const mdA = `---
id: node.a
slug: node-a
title: Node A
enTitle: Node A
type: concept
domain: agent-core
level: beginner
summary: A
objectives: [Understand A]
requires: [node.b]
sourceIds: [anthropic.effective-agents]
verifiedAt: "2026-11-26"
---
See [[node.b]].`;
    const mdB = `---
id: node.b
slug: node-b
title: Node B
enTitle: Node B
type: concept
domain: agent-core
level: beginner
summary: B
objectives: [Understand B]
requires: [node.a]
sourceIds: [anthropic.effective-agents]
verifiedAt: "2026-11-26"
---
See [[node.a]].`;
    bundle.nodes = [parseKnowledgeMarkdown(mdA, 'a.md'), parseKnowledgeMarkdown(mdB, 'b.md')];
    const report = validateContentBundle(bundle);
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.code === 'PREREQUISITE_CYCLE')).toBe(true);
  });

  it('rejects duplicate IDs and XSS during Obsidian import preview', () => {
    const bundle = makeEmptyBundle();
    const validMd = `---
id: node.x
slug: node-x
title: Node X
enTitle: Node X
type: concept
domain: agent-core
level: beginner
summary: X
objectives: [Learn X]
sourceIds: [anthropic.effective-agents]
verifiedAt: "2026-11-26"
---
Safe body`;
    const xssMd = validMd.replace('Safe body', '<script>alert(1)</script>');
    const preview = previewObsidianImport(
      [
        { filename: 'x1.md', content: validMd },
        { filename: 'x2.md', content: xssMd },
      ],
      bundle,
    );
    expect(preview.valid).toBe(false);
    expect(preview.items[1].action).toBe('rejected');
  });

  it('rejects slug collisions, unknown sources, and cross-node prerequisite cycles on import preview', () => {
    const bundle = makeEmptyBundle();
    const existingMd = `---
id: agent.existing
slug: shared-slug
title: Existing
enTitle: Existing
type: concept
domain: agent-core
level: beginner
summary: Existing
objectives: [Learn]
requires: [agent.incoming]
sourceIds: [anthropic.effective-agents]
verifiedAt: "2026-11-26"
---
Body`;
    bundle.nodes = [parseKnowledgeMarkdown(existingMd, 'knowledge/02-agent-core/shared-slug.md')];

    const slugConflictMd = existingMd
      .replace('id: agent.existing', 'id: agent.other')
      .replace('requires: [agent.incoming]', 'requires: []');
    const badSourceMd = existingMd
      .replace('id: agent.existing', 'id: agent.bad-source')
      .replace('slug: shared-slug', 'slug: bad-source')
      .replace('requires: [agent.incoming]', 'requires: []')
      .replace('anthropic.effective-agents', 'unknown.source');
    const cycleMd = existingMd
      .replace('id: agent.existing', 'id: agent.incoming')
      .replace('slug: shared-slug', 'slug: incoming')
      .replace('requires: [agent.incoming]', 'requires: [agent.existing]');

    const preview = previewObsidianImport(
      [
        { filename: 'conflict.md', content: slugConflictMd },
        { filename: 'bad-source.md', content: badSourceMd },
        { filename: 'cycle.md', content: cycleMd },
      ],
      bundle,
    );
    expect(preview.valid).toBe(false);
    expect(preview.items[0].errors.some((e) => e.includes('collides'))).toBe(true);
    expect(preview.items[1].errors.some((e) => e.includes('Unknown source'))).toBe(true);
    expect(preview.items[2].errors.some((e) => e.includes('Prerequisite cycle'))).toBe(true);
  });
});

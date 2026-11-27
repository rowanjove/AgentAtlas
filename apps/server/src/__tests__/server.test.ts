import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAtlasServer, AtlasServerContext } from '../app.js';
import { redactSecrets } from '../services/tutor.js';

function createFixtureContent(dir: string) {
  fs.mkdirSync(path.join(dir, 'sources'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'glossary'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'knowledge', 'agent-core'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'paths'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assessments'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'labs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'ecosystem'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'casebook'), { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'sources', 'sources.yaml'),
    `- id: anthropic.effective-agents
  title: Building effective agents
  url: https://www.anthropic.com/engineering/building-effective-agents
  kind: engineering-blog
  licenseStatus: Reference link
  upstreamVersion: "2024-12"
  verifiedAt: "2026-11-26"
`,
    'utf8',
  );

  fs.writeFileSync(
    path.join(dir, 'glossary', 'terms.yaml'),
    `- id: term.agent-loop
  term: Agent Loop
  zhTerm: 智能体循环
  aliases: [Agent 执行循环]
  domain: agent-core
  definition: 模型推理、工具调用与环境观察的迭代控制循环
  sourceIds: [anthropic.effective-agents]
  nodeId: agent.loop
`,
    'utf8',
  );

  fs.writeFileSync(
    path.join(dir, 'knowledge', 'agent-core', 'agent-loop.md'),
    `---
id: agent.loop
slug: agent-loop
title: Agent 执行循环
enTitle: Agent Loop
aliases: [Agent Loop, 智能体循环]
type: concept
domain: agent-core
level: beginner
revision: 1
majorUpdate: false
estimatedMinutes: 15
summary: 模型在环境中迭代执行推理与工具调用直到满足停止条件。
objectives:
  - 掌握循环收敛与停止条件
sourceIds: [anthropic.effective-agents]
verifiedAt: "2026-11-26"
---
## 核心机制

Agent 执行循环包含规划、工具调用、观测与停止条件判断。
`,
    'utf8',
  );

  fs.writeFileSync(
    path.join(dir, 'paths', 'foundations.yaml'),
    `id: agent-foundations
title: Agent 基础
enTitle: Agent Foundations
goal: 掌握基础循环
stages:
  - id: s1
    title: 核心基础
    nodeIds: [agent.loop]
requiredNodeIds: [agent.loop]
`,
    'utf8',
  );

  fs.writeFileSync(
    path.join(dir, 'assessments', 'q1.yaml'),
    `- id: q.loop.1
  nodeId: agent.loop
  domain: agent-core
  kind: scenario-judgment
  difficulty: beginner
  prompt: 固定三步报表是否需要自治 Agent Loop？
  options:
    - id: a
      text: 不需要，确定性工作流更可控
    - id: b
      text: 必须使用多 Agent
  correctOptionId: a
  explanation: 固定步骤应优先使用确定性 Workflow。
`,
    'utf8',
  );
}

describe('AtlasServer security, bilingual FTS5 search, atomic update & backup/restore', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) await fn();
    }
  });

  async function bootTempServer(): Promise<{ ctx: AtlasServerContext; root: string }> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-srv-'));
    const contentDir = path.join(root, 'content');
    const dataDir = path.join(root, 'data');
    createFixtureContent(contentDir);
    const ctx = await createAtlasServer({ contentDir, dataDir });
    cleanups.push(async () => {
      await ctx.app.close();
      ctx.db.close();
      fs.rmSync(root, { recursive: true, force: true });
    });
    return { ctx, root };
  }

  it('rejects mutating requests without CSRF token or from disallowed Origin (AC11)', async () => {
    const { ctx } = await bootTempServer();
    const resNoToken = await ctx.app.inject({
      method: 'PUT',
      url: '/api/progress/agent.loop',
      payload: { status: 'read' },
    });
    expect(resNoToken.statusCode).toBe(403);

    const resBadOrigin = await ctx.app.inject({
      method: 'PUT',
      url: '/api/progress/agent.loop',
      headers: {
        origin: 'https://evil.example.com',
        'x-atlas-token': ctx.csrfToken,
      },
      payload: { status: 'read' },
    });
    expect(resBadOrigin.statusCode).toBe(403);

    const resValid = await ctx.app.inject({
      method: 'PUT',
      url: '/api/progress/agent.loop',
      headers: {
        origin: 'http://127.0.0.1:4317',
        'x-atlas-token': ctx.csrfToken,
      },
      payload: { status: 'read' },
    });
    expect(resValid.statusCode).toBe(200);
    expect(resValid.headers['x-content-type-options']).toBe('nosniff');
    expect(resValid.headers['x-frame-options']).toBe('DENY');

    // Invalid Zod payload should return 400 rather than 500
    const resZodBad = await ctx.app.inject({
      method: 'PUT',
      url: '/api/progress/agent.loop',
      headers: {
        origin: 'http://127.0.0.1:4317',
        'x-atlas-token': ctx.csrfToken,
      },
      payload: { status: 'invalid_enum_value' },
    });
    expect(resZodBad.statusCode).toBe(400);
    expect(resZodBad.json().error).toBe('Validation failed');
  });

  it('exports valid Obsidian PKZIP archive with PK magic header and node markdown', async () => {
    const { ctx } = await bootTempServer();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/content/export/obsidian.zip' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    const buf = res.rawPayload;
    expect(buf.subarray(0, 4).toString('hex')).toBe('504b0304');
    expect(buf.toString('utf8')).toContain('knowledge/agent-core/agent-loop.md');
  });

  it('supports Chinese 2-char, English, and glossary synonym FTS5 search (AC04)', async () => {
    const { ctx } = await bootTempServer();
    for (const q of ['循环', '智能体循环', 'Agent Loop', '停止条件']) {
      const res = await ctx.app.inject({ method: 'GET', url: `/api/search?q=${encodeURIComponent(q)}` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items.some((i: { id: string }) => i.id === 'agent.loop')).toBe(true);
    }
  });

  it('preserves progress on minor update, flags needs_review on majorUpdate, and rolls back safely (AC08/AC10)', async () => {
    const { ctx, root } = await bootTempServer();
    const headers = { 'x-atlas-token': ctx.csrfToken };

    await ctx.app.inject({ method: 'PUT', url: '/api/progress/agent.loop', headers, payload: { status: 'assessed' } });
    await ctx.app.inject({ method: 'POST', url: '/api/notes', headers, payload: { nodeId: 'agent.loop', body: 'My critical note' } });

    const backupRes = await ctx.app.inject({ method: 'POST', url: '/api/backup/create', headers, payload: { label: 'test' } });
    expect(backupRes.statusCode).toBe(200);
    const backupId = backupRes.json().backupId;

    // Commit a majorUpdate revision 2
    const updatedMd = fs
      .readFileSync(path.join(root, 'content', 'knowledge', 'agent-core', 'agent-loop.md'), 'utf8')
      .replace('revision: 1', 'revision: 2')
      .replace('majorUpdate: false', 'majorUpdate: true');
    const importRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/content/import/commit',
      headers,
      payload: { files: [{ filename: 'agent-loop.md', content: updatedMd }] },
    });
    expect(importRes.statusCode).toBe(200);

    const nodeAfterUpdate = (await ctx.app.inject({ method: 'GET', url: '/api/knowledge/agent.loop' })).json();
    expect(nodeAfterUpdate.progress.status).toBe('needs_review');
    expect(nodeAfterUpdate.notes).toHaveLength(1);

    // Restore backup -> restores assessed status and note
    const restoreRes = await ctx.app.inject({ method: 'POST', url: '/api/backup/restore', headers, payload: { backupId } });
    expect(restoreRes.statusCode).toBe(200);

    const nodeAfterRestore = (await ctx.app.inject({ method: 'GET', url: '/api/knowledge/agent.loop' })).json();
    expect(nodeAfterRestore.progress.status).toBe('assessed');
    expect(nodeAfterRestore.notes[0].body).toBe('My critical note');
  });

  it('validates Host headers (including IPv6), query params, search synonyms, wrong-attempt resolution, and API key origin isolation', async () => {
    const { ctx } = await bootTempServer();
    const headers = { 'x-atlas-token': ctx.csrfToken };

    // IPv6 loopback host with port is allowed; external host is blocked
    const ipv6Res = await ctx.app.inject({ method: 'GET', url: '/api/health', headers: { host: '[::1]:4317' } });
    expect(ipv6Res.statusCode).toBe(200);
    const evilHostRes = await ctx.app.inject({ method: 'GET', url: '/api/health', headers: { host: 'evil.example.com:4317' } });
    expect(evilHostRes.statusCode).toBe(403);

    // Invalid query params return 400 rather than 500
    const badLimit = await ctx.app.inject({ method: 'GET', url: '/api/search?q=agent&limit=abc' });
    expect(badLimit.statusCode).toBe(400);

    // Single-character query does not trigger noisy substring glossary expansion
    const singleCharSearch = await ctx.app.inject({ method: 'GET', url: '/api/search?q=z&limit=5' });
    expect(singleCharSearch.statusCode).toBe(200);
    expect(singleCharSearch.json().items).toHaveLength(0);

    // Wrong attempt creates needsReview=1; passing same assessment resolves it automatically
    const wrongAttempt = await ctx.app.inject({
      method: 'POST',
      url: '/api/assessments/q.loop.1/attempt',
      headers,
      payload: { selectedOptionId: 'b' },
    });
    expect(wrongAttempt.statusCode).toBe(200);
    expect(wrongAttempt.json().isCorrect).toBe(false);

    const passAttempt = await ctx.app.inject({
      method: 'POST',
      url: '/api/assessments/q.loop.1/attempt',
      headers,
      payload: { selectedOptionId: 'a' },
    });
    expect(passAttempt.statusCode).toBe(200);
    expect(passAttempt.json().isCorrect).toBe(true);

    const overviewAfterPass = (await ctx.app.inject({ method: 'GET', url: '/api/overview' })).json();
    expect(overviewAfterPass.wrongAttemptsCount).toBe(0);

    // Changing tutor baseUrl origin automatically clears stored API key
    await ctx.app.inject({
      method: 'POST',
      url: '/api/settings/api-key',
      headers,
      payload: { apiKey: 'sk-test-secret-123456', keyStorage: 'memory' },
    });
    const settingsUpdate = await ctx.app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers,
      payload: {
        tutor: {
          enabled: true,
          baseUrl: 'http://127.0.0.1:9999/v1',
          model: 'test-model',
          timeoutMs: 10000,
          maxTokens: 512,
        },
      },
    });
    expect(settingsUpdate.statusCode).toBe(200);
    expect(settingsUpdate.json().apiKeyClearedForNewOrigin).toBe(true);
    expect(ctx.secretVault.hasApiKey()).toBe(false);

    // Secret redaction masks Bearer tokens and sk- keys
    expect(redactSecrets('Authorization: Bearer sk-secretkey999 failed', 'sk-secretkey999')).not.toContain('sk-secretkey999');
  });

  it('serves newly built static assets dynamically without restart and falls back SPA routes cleanly', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-static-'));
    const contentDir = path.join(root, 'content');
    const dataDir = path.join(root, 'data');
    const webDistDir = path.join(root, 'webdist');
    createFixtureContent(contentDir);
    fs.mkdirSync(path.join(webDistDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(webDistDir, 'index.html'), '<!doctype html><html><body>Atlas</body></html>', 'utf8');

    const ctx = await createAtlasServer({ contentDir, dataDir, webDistDir });
    cleanups.push(async () => {
      await ctx.app.close();
      ctx.db.close();
      fs.rmSync(root, { recursive: true, force: true });
    });

    // Simulate a rebuild writing a brand-new hashed JS bundle after server startup
    fs.writeFileSync(path.join(webDistDir, 'assets', 'index-newHash123.js'), 'console.log("ok");', 'utf8');

    const newAssetRes = await ctx.app.inject({ method: 'GET', url: '/assets/index-newHash123.js' });
    expect(newAssetRes.statusCode).toBe(200);
    expect(newAssetRes.body).toContain('ok');

    const missingAssetRes = await ctx.app.inject({ method: 'GET', url: '/assets/missing-chunk.js' });
    expect(missingAssetRes.statusCode).toBe(404);

    const spaRouteRes = await ctx.app.inject({ method: 'GET', url: '/library/agent.loop' });
    expect(spaRouteRes.statusCode).toBe(200);
    expect(spaRouteRes.headers['cache-control']).toBe('no-cache');
    expect(spaRouteRes.body).toContain('Atlas');
  });

  it('ranks FTS5 title matches above body-only matches, stores relative snapshot IDs, isolates failed imports, and blocks unsafe tutor URLs', async () => {
    const { ctx, root } = await bootTempServer();
    const headers = { 'x-atlas-token': ctx.csrfToken };

    // Add a second node where "Agent Loop" only appears in the body
    const bodyOnlyMd = `---
id: agent.secondary
slug: agent-secondary
title: 次级观测节点
enTitle: Secondary Telemetry
type: concept
domain: agent-core
level: beginner
revision: 1
majorUpdate: false
estimatedMinutes: 10
summary: 用于测试排序权重。
objectives:
  - 验证 BM25 标题权重高于正文
sourceIds: [anthropic.effective-agents]
verifiedAt: "2026-11-26"
---
## 说明

这里仅在正文提及 Agent Loop 一次。
`;
    const addRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/content/import/commit',
      headers,
      payload: { files: [{ filename: 'agent-secondary.md', content: bodyOnlyMd }] },
    });
    expect(addRes.statusCode).toBe(200);

    // 1. BM25 title match ranks ahead of body-only match
    const searchRes = await ctx.app.inject({ method: 'GET', url: '/api/search?q=Agent%20Loop' });
    expect(searchRes.statusCode).toBe(200);
    const searchItems = searchRes.json().items as Array<{ id: string }>;
    expect(searchItems.length).toBeGreaterThanOrEqual(2);
    expect(searchItems[0].id).toBe('agent.loop');

    // 2. Snapshot stores relative ID (portable across directory moves) and rolls back cleanly
    const snaps = ctx.db.listSnapshots();
    expect(snaps.length).toBeGreaterThanOrEqual(1);
    expect(snaps[0].snapshotPath).toBe(snaps[0].id);
    expect(snaps[0].snapshotPath).not.toMatch(/[\\/]/);

    // 3. Staged commitImport rejects post-import broken wikilink without polluting live contentDir
    const brokenMd = bodyOnlyMd.replace('这里仅在正文提及 Agent Loop 一次。', '链接到 [[missing.nonexistent]]');
    const brokenRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/content/import/commit',
      headers,
      payload: { files: [{ filename: 'agent-secondary.md', content: brokenMd }] },
    });
    expect(brokenRes.statusCode).toBe(400);
    const liveNode = ctx.contentManager.nodeById.get('agent.secondary');
    expect(liveNode).toBeDefined();
    const liveBody = fs.readFileSync(path.join(root, 'content', liveNode!.bodyPath), 'utf8');
    expect(liveBody).not.toContain('missing.nonexistent');

    // Rollback to pre-import snapshot removes agent.secondary cleanly
    const rollbackRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/content/rollback/${encodeURIComponent(snaps[0].id)}`,
      headers,
    });
    expect(rollbackRes.statusCode).toBe(200);
    expect(ctx.contentManager.nodeById.has('agent.secondary')).toBe(false);

    // 4. Reject cloud metadata baseUrl in PUT /api/settings
    const badTutorUrlRes = await ctx.app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers,
      payload: {
        tutor: {
          enabled: true,
          baseUrl: 'http://169.254.169.254/v1',
          model: 'test',
          timeoutMs: 10000,
          maxTokens: 512,
        },
      },
    });
    expect(badTutorUrlRes.statusCode).toBe(400);
  });
});

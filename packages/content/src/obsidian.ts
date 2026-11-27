import matter from 'gray-matter';
import { ContentBundle, KnowledgeNode, getKnowledgeFolderForDomain } from '@agent-atlas/shared';
import { parseKnowledgeMarkdown } from './compiler.js';
import { detectUnsafeHtmlOrMdx } from './security.js';
import { findPrerequisiteCycles } from './validator.js';

export interface ObsidianExportFile {
  relativePath: string;
  content: string;
}

export function exportNodeToObsidianMarkdown(node: KnowledgeNode): string {
  const frontmatter = {
    id: node.id,
    slug: node.slug,
    title: node.title,
    enTitle: node.enTitle,
    aliases: node.aliases,
    type: node.type,
    domain: node.domain,
    level: node.level,
    revision: node.revision,
    majorUpdate: node.majorUpdate,
    estimatedMinutes: node.estimatedMinutes,
    summary: node.summary,
    objectives: node.objectives,
    requires: node.requires,
    related: node.related,
    contrasts: node.contrasts,
    implements: node.implements,
    exampleOf: node.exampleOf,
    supersedes: node.supersedes,
    tags: node.tags,
    sourceIds: node.sourceIds,
    labIds: node.labIds,
    verifiedAt: node.verifiedAt,
  };
  return matter.stringify(node.body, frontmatter);
}

export function exportBundleToObsidian(bundle: ContentBundle): ObsidianExportFile[] {
  return bundle.nodes.map((node) => ({
    relativePath: node.bodyPath || `knowledge/${getKnowledgeFolderForDomain(node.domain)}/${node.slug}.md`,
    content: exportNodeToObsidianMarkdown(node),
  }));
}

export interface ImportPreviewItem {
  filename: string;
  nodeId: string | null;
  action: 'create' | 'update' | 'rejected';
  majorUpdate: boolean;
  errors: string[];
  parsedNode?: KnowledgeNode;
}

export function previewObsidianImport(
  files: Array<{ filename: string; content: string }>,
  existingBundle: ContentBundle,
): { valid: boolean; items: ImportPreviewItem[] } {
  const existingIds = new Map(existingBundle.nodes.map((n) => [n.id, n]));
  const existingBySlug = new Map(existingBundle.nodes.map((n) => [n.slug, n]));
  const existingByPath = new Map(existingBundle.nodes.map((n) => [n.bodyPath, n]));
  const existingSourceIds = new Set(existingBundle.sources.map((s) => s.id));

  const batchIds = new Set<string>();
  const batchSlugs = new Set<string>();
  const batchPaths = new Set<string>();
  const items: ImportPreviewItem[] = [];

  for (const file of files) {
    const errors: string[] = [];
    if (!file.filename.toLowerCase().endsWith('.md')) {
      items.push({ filename: file.filename, nodeId: null, action: 'rejected', majorUpdate: false, errors: ['Only .md files are supported'] });
      continue;
    }
    if (
      file.filename.includes('\0') ||
      file.filename.includes('..') ||
      file.filename.startsWith('/') ||
      file.filename.startsWith('\\') ||
      /^[a-zA-Z]:/.test(file.filename)
    ) {
      items.push({ filename: file.filename, nodeId: null, action: 'rejected', majorUpdate: false, errors: ['Path traversal detected in filename'] });
      continue;
    }
    if (Buffer.byteLength(file.content, 'utf8') > 512 * 1024) {
      items.push({ filename: file.filename, nodeId: null, action: 'rejected', majorUpdate: false, errors: ['File exceeds 512KB limit'] });
      continue;
    }

    let node: KnowledgeNode;
    try {
      node = parseKnowledgeMarkdown(file.content, `knowledge/imported/${file.filename.split(/[\\/]/).pop()}`);
    } catch (err) {
      items.push({
        filename: file.filename,
        nodeId: null,
        action: 'rejected',
        majorUpdate: false,
        errors: [err instanceof Error ? err.message : 'Invalid frontmatter or markdown'],
      });
      continue;
    }

    if (batchIds.has(node.id)) {
      errors.push(`Duplicate ID '${node.id}' within import batch`);
    }
    batchIds.add(node.id);

    if (batchSlugs.has(node.slug)) {
      errors.push(`Duplicate slug '${node.slug}' within import batch`);
    }
    batchSlugs.add(node.slug);

    const existing = existingIds.get(node.id);
    const slugOwner = existingBySlug.get(node.slug);
    if (slugOwner && slugOwner.id !== node.id) {
      errors.push(`Slug '${node.slug}' collides with existing node '${slugOwner.id}'`);
    }

    const targetRelPath = existing ? existing.bodyPath : `knowledge/${getKnowledgeFolderForDomain(node.domain)}/${node.slug}.md`;
    if (batchPaths.has(targetRelPath)) {
      errors.push(`Target file path '${targetRelPath}' collides within import batch`);
    }
    batchPaths.add(targetRelPath);

    const pathOwner = existingByPath.get(targetRelPath);
    if (pathOwner && pathOwner.id !== node.id) {
      errors.push(`Target file path '${targetRelPath}' collides with existing node '${pathOwner.id}'`);
    }

    if (existingSourceIds.size > 0) {
      for (const sid of node.sourceIds) {
        if (!existingSourceIds.has(sid)) {
          errors.push(`Unknown source reference '${sid}'`);
        }
      }
    }

    for (const f of detectUnsafeHtmlOrMdx(node.body)) {
      errors.push(`${f.code}: ${f.reason}`);
    }

    if (node.requires.includes(node.id)) {
      errors.push(`Self-referencing prerequisite in '${node.id}'`);
    }

    items.push({
      filename: file.filename,
      nodeId: node.id,
      action: errors.length > 0 ? 'rejected' : existing ? 'update' : 'create',
      majorUpdate: Boolean(node.majorUpdate || (existing && node.revision > existing.revision)),
      errors,
      parsedNode: errors.length === 0 ? node : undefined,
    });
  }

  // Check cross-node prerequisite DAG cycles against merged existing + imported nodes
  const validImported = items.map((i) => i.parsedNode).filter((n): n is KnowledgeNode => Boolean(n));
  if (validImported.length > 0) {
    const mergedMap = new Map(existingBundle.nodes.map((n) => [n.id, n]));
    for (const imp of validImported) {
      mergedMap.set(imp.id, imp);
    }
    const cycles = findPrerequisiteCycles({ ...existingBundle, nodes: [...mergedMap.values()] });
    if (cycles.length > 0) {
      for (const item of items) {
        if (!item.parsedNode) continue;
        const hitCycle = cycles.find((c) => c.includes(item.parsedNode!.id));
        if (hitCycle) {
          item.errors.push(`Prerequisite cycle detected: ${hitCycle.join(' -> ')}`);
          item.action = 'rejected';
          item.parsedNode = undefined;
        }
      }
    }
  }

  return {
    valid: items.every((i) => i.action !== 'rejected'),
    items,
  };
}

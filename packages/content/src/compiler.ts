import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import {
  AssessmentQuestionSchema,
  CasebookEntry,
  CasebookFrontmatterSchema,
  ContentBundle,
  EcosystemItemSchema,
  GlossaryTermSchema,
  KnowledgeFrontmatterSchema,
  KnowledgeNode,
  LabMetaSchema,
  LearningPathSchema,
  Relation,
  SourceEntrySchema,
  TocHeading,
} from '@agent-atlas/shared';
import { slugifyHeading } from './security.js';

function walkFiles(dir: string, exts: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath, exts));
    } else if (exts.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

export function extractWikilinks(markdown: string): string[] {
  const prose = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '');
  const matches = prose.matchAll(/\[\[([^\]]+)\]\]/g);
  const targets = new Set<string>();
  for (const match of matches) {
    const raw = match[1].split('|')[0].split('#')[0].trim();
    if (raw) targets.add(raw);
  }
  return [...targets];
}

export function extractHeadings(markdown: string): TocHeading[] {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, '');
  const headings: TocHeading[] = [];
  for (const line of withoutCode.split(/\r?\n/)) {
    const m = /^(#{1,4})\s+(.+)$/.exec(line.trim());
    if (m) {
      const text = m[2].replace(/`/g, '').trim();
      headings.push({
        level: m[1].length,
        text,
        slug: slugifyHeading(text),
      });
    }
  }
  return headings;
}

function disabledEngine(): never {
  throw new Error('Executable frontmatter engine is disabled');
}

function parseFrontmatterSafely(rawContent: string) {
  return matter(rawContent, {
    engines: {
      js: disabledEngine,
      javascript: disabledEngine,
      coffee: disabledEngine,
    },
  });
}

export function parseKnowledgeMarkdown(rawContent: string, relativeBodyPath: string): KnowledgeNode {
  const parsed = parseFrontmatterSafely(rawContent);
  const fm = KnowledgeFrontmatterSchema.parse(parsed.data);
  const body = parsed.content.trim();
  return {
    ...fm,
    bodyPath: relativeBodyPath.replace(/\\/g, '/'),
    body,
    wikilinks: extractWikilinks(body),
    backlinks: [],
    headings: extractHeadings(body),
  };
}

function loadYamlItems<T>(dir: string, schema: { parse: (v: unknown) => T }): T[] {
  const files = walkFiles(dir, ['.yaml', '.yml']);
  const items: T[] = [];
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const data = yaml.load(raw);
    if (Array.isArray(data)) {
      for (const item of data) items.push(schema.parse(item));
    } else if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      const list = record.items ?? record.sources ?? record.terms ?? record.questions ?? record.assessments;
      if (Array.isArray(list)) {
        for (const item of list) items.push(schema.parse(item));
      } else {
        items.push(schema.parse(data));
      }
    }
  }
  return items;
}

export function compileContentDirectory(contentDir: string): ContentBundle {
  const root = path.resolve(contentDir);

  const sources = loadYamlItems(path.join(root, 'sources'), SourceEntrySchema);
  const glossary = loadYamlItems(path.join(root, 'glossary'), GlossaryTermSchema);
  const paths = loadYamlItems(path.join(root, 'paths'), LearningPathSchema);
  const assessments = loadYamlItems(path.join(root, 'assessments'), AssessmentQuestionSchema);
  const ecosystem = loadYamlItems(path.join(root, 'ecosystem'), EcosystemItemSchema);

  const labFiles = walkFiles(path.join(root, 'labs'), ['.json']);
  const labs = labFiles.map((file) => LabMetaSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8'))));

  const mdFiles = walkFiles(path.join(root, 'knowledge'), ['.md']);
  const nodes: KnowledgeNode[] = mdFiles.map((file) => {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    const raw = fs.readFileSync(file, 'utf8');
    return parseKnowledgeMarkdown(raw, rel);
  });

  const casebookFiles = walkFiles(path.join(root, 'casebook'), ['.md']);
  const casebooks: CasebookEntry[] = casebookFiles.map((file) => {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    const parsed = parseFrontmatterSafely(fs.readFileSync(file, 'utf8'));
    const fm = CasebookFrontmatterSchema.parse(parsed.data);
    return {
      ...fm,
      bodyPath: rel,
      body: parsed.content.trim(),
    };
  });

  // Resolve wikilinks (by id or slug) to populate backlinks & relations
  const byIdOrSlug = new Map<string, KnowledgeNode>();
  for (const node of nodes) {
    byIdOrSlug.set(node.id, node);
    byIdOrSlug.set(node.slug, node);
  }

  const relations: Relation[] = [];
  const relationKeySet = new Set<string>();
  const addRelation = (fromId: string, toId: string, type: Relation['type']) => {
    const key = `${fromId}->${toId}:${type}`;
    if (!relationKeySet.has(key)) {
      relationKeySet.add(key);
      relations.push({ fromId, toId, type });
    }
  };

  for (const node of nodes) {
    for (const req of node.requires) addRelation(node.id, req, 'requires');
    for (const rel of node.related) addRelation(node.id, rel, 'related');
    for (const con of node.contrasts) addRelation(node.id, con, 'contrasts');
    for (const imp of node.implements) addRelation(node.id, imp, 'implements');
    for (const ex of node.exampleOf) addRelation(node.id, ex, 'example-of');
    for (const sup of node.supersedes) addRelation(node.id, sup, 'supersedes');

    for (const linkTarget of node.wikilinks) {
      const targetNode = byIdOrSlug.get(linkTarget);
      if (targetNode && targetNode.id !== node.id) {
        if (!targetNode.backlinks.includes(node.id)) {
          targetNode.backlinks.push(node.id);
        }
        addRelation(node.id, targetNode.id, 'related');
      }
    }
  }

  return {
    version: '1.0.0',
    compiledAt: new Date().toISOString(),
    sources,
    glossary,
    nodes,
    relations,
    paths,
    assessments,
    labs,
    ecosystem,
    casebooks,
  };
}

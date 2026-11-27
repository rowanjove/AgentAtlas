import fs from 'node:fs';
import path from 'node:path';
import Fastify, { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import {
  DOMAINS,
  ProgressStatusSchema,
  TutorConfig,
} from '@agent-atlas/shared';
import {
  exportBundleToObsidian,
  previewObsidianImport,
} from '@agent-atlas/content';
import { runSimulation } from '@agent-atlas/simulator';
import { AtlasDatabase } from './db/database.js';
import { registerSecurityGuards } from './security/guard.js';
import { LocalSecretVault } from './security/secrets.js';
import { BackupService } from './services/backup.js';
import { ContentManager } from './services/contentManager.js';
import { assertSafeProviderUrl, TutorService } from './services/tutor.js';
import { buildZipArchive } from './services/zip.js';

export interface ServerOptions {
  contentDir: string;
  dataDir: string;
  webDistDir?: string;
  logger?: boolean;
}

export interface AtlasServerContext {
  app: FastifyInstance;
  db: AtlasDatabase;
  contentManager: ContentManager;
  backupService: BackupService;
  secretVault: LocalSecretVault;
  csrfToken: string;
}

const REL_PRIORITY: Record<string, number> = {
  requires: 1,
  contrasts: 2,
  implements: 3,
  'example-of': 4,
  supersedes: 5,
  related: 6,
};

function isDisallowedExternalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h === '::' || h === '0.0.0.0') return true;
  if (
    h === 'metadata.google.internal' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.localhost')
  ) {
    return true;
  }
  if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) return true;
  if (/^(0[0-7]+|0x[0-9a-f]+)(\.|$)/i.test(h) && /^[0-9a-fx.]+$/i.test(h)) return true;
  if (h.startsWith('fc') || h.startsWith('fd') || /^fe[89ab]/.test(h)) return true;
  if (h.startsWith('::ffff:')) {
    return isDisallowedExternalHost(h.slice('::ffff:'.length));
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

const DEFAULT_SETTINGS = {
  theme: 'system' as 'system' | 'light' | 'dark',
  readerWidthPx: 780,
  fontSizePx: 16,
  reducedMotion: false,
  tutor: {
    enabled: false,
    baseUrl: 'http://127.0.0.1:1234/v1',
    model: 'local-model',
    timeoutMs: 25000,
    maxTokens: 1200,
    keyStorage: 'memory' as 'memory' | 'dpapi',
  },
};

export async function createAtlasServer(options: ServerOptions): Promise<AtlasServerContext> {
  const app = Fastify({
    logger: options.logger
      ? {
          redact: ['req.headers.authorization', 'req.headers["x-atlas-token"]', 'body.apiKey'],
        }
      : false,
    bodyLimit: 4 * 1024 * 1024,
  });

  await app.register(fastifyCookie);
  const { csrfToken } = registerSecurityGuards(app);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.code(400).send({
        error: 'Validation failed',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const statusCode = (err as { statusCode?: number }).statusCode;
    return reply.code(statusCode && statusCode >= 400 ? statusCode : 500).send({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  });

  fs.mkdirSync(options.dataDir, { recursive: true });
  const dbPath = path.join(options.dataDir, 'atlas.sqlite');
  const db = new AtlasDatabase(dbPath);
  const secretVault = new LocalSecretVault(options.dataDir);
  const contentManager = new ContentManager(
    options.contentDir,
    path.join(options.dataDir, 'snapshots'),
    db,
  );
  const backupService = new BackupService(
    options.contentDir,
    path.join(options.dataDir, 'backups'),
    db,
  );
  const tutorService = new TutorService();
  let maintenanceLock = false;
  const withMaintenanceLock = async <T>(
    reply: { code: (code: number) => { send: (payload: unknown) => unknown } },
    fn: () => Promise<T> | T,
  ) => {
    if (maintenanceLock) {
      return reply.code(409).send({ error: 'Another content or backup maintenance operation is already in progress' });
    }
    maintenanceLock = true;
    try {
      return await fn();
    } finally {
      maintenanceLock = false;
    }
  };

  const getTutorConfig = (): TutorConfig => {
    const saved = db.getSetting('tutor', DEFAULT_SETTINGS.tutor);
    return {
      ...DEFAULT_SETTINGS.tutor,
      ...saved,
      keyStorage: secretVault.getStorageMode(),
      hasApiKey: secretVault.hasApiKey(),
    };
  };

  // Health & Overview
  app.get('/api/health', async () => ({
    status: 'ok',
    uptimeSec: Math.round(process.uptime()),
    memoryRssMb: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
    contentStats: contentManager.validation.stats,
  }));

  app.get('/api/overview', async () => {
    const progress = db.getAllProgress();
    const history = db.getReadingHistory(8);
    const bookmarks = db.listBookmarks();
    const notes = db.listNotes().slice(0, 6);
    const attempts = db.getAssessmentAttempts();
    const wrongNeedsReview = attempts.filter((a) => a.needsReview);
    const nodeMap = contentManager.nodeById;

    const needsReviewNodes = [...progress.values()]
      .filter((p) => p.status === 'needs_review')
      .map((p) => nodeMap.get(p.nodeId))
      .filter(Boolean);

    const pathSummaries = contentManager.bundle.paths.map((lp) => {
      const doneCount = lp.requiredNodeIds.filter((id) => {
        const st = progress.get(id)?.status;
        return st === 'read' || st === 'assessed';
      }).length;
      const assessedCount = lp.requiredNodeIds.filter((id) => progress.get(id)?.status === 'assessed').length;
      return {
        id: lp.id,
        title: lp.title,
        enTitle: lp.enTitle,
        goal: lp.goal,
        requiredTotal: lp.requiredNodeIds.length,
        doneCount,
        assessedCount,
      };
    });

    const uniqueReviewNodeIds = new Set<string>([
      ...needsReviewNodes.map((n) => n!.id),
      ...wrongNeedsReview.map((a) => a.nodeId),
    ]);

    return {
      domains: DOMAINS,
      stats: contentManager.validation.stats,
      progressSummary: {
        totalNodes: contentManager.bundle.nodes.length,
        readOrAssessed: [...progress.values()].filter((p) => p.status === 'read' || p.status === 'assessed').length,
        assessedOnly: [...progress.values()].filter((p) => p.status === 'assessed').length,
        inProgress: [...progress.values()].filter((p) => p.status === 'in_progress').length,
        needsReview: uniqueReviewNodeIds.size,
      },
      recentReading: history
        .map((h) => {
          const n = nodeMap.get(h.nodeId);
          return n
            ? {
                nodeId: n.id,
                title: n.title,
                enTitle: n.enTitle,
                domain: n.domain,
                visitedAt: h.visitedAt,
                status: progress.get(n.id)?.status ?? 'not_started',
              }
            : null;
        })
        .filter(Boolean),
      bookmarks: bookmarks
        .map((b) => {
          const n = nodeMap.get(b.nodeId);
          return n ? { nodeId: n.id, title: n.title, domain: n.domain, createdAt: b.createdAt } : null;
        })
        .filter(Boolean),
      recentNotes: notes,
      needsReviewNodes: needsReviewNodes.map((n) => ({ nodeId: n!.id, title: n!.title, domain: n!.domain })),
      wrongAttemptsCount: wrongNeedsReview.length,
      pathSummaries,
      recommendedStarterPaths: ['agent-foundations', 'agent-architect'],
    };
  });

  // Search & Knowledge Library
  const searchQuerySchema = z.object({
    q: z.string().optional(),
    domain: z.string().optional(),
    type: z.string().optional(),
    level: z.string().optional(),
    status: z.string().optional(),
    tag: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  });

  app.get('/api/search', async (req) => {
    const q = searchQuerySchema.parse(req.query ?? {});
    const items = db.searchNodes({
      q: q.q,
      domain: q.domain,
      type: q.type,
      level: q.level,
      status: q.status,
      tag: q.tag,
      limit: q.limit ?? 50,
    });
    return { items, total: items.length };
  });

  app.get('/api/knowledge', async (req) => {
    const q = searchQuerySchema.parse(req.query ?? {});
    const items = db.searchNodes({
      q: q.q,
      domain: q.domain,
      type: q.type,
      level: q.level,
      status: q.status,
      tag: q.tag,
      limit: q.limit ?? 200,
    });
    return { items, domains: DOMAINS };
  });

  app.get('/api/knowledge/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const node = contentManager.nodeById.get(id) ?? contentManager.nodeBySlug.get(id);
    if (!node) return reply.code(404).send({ error: `Knowledge node '${id}' not found` });

    const progressMap = db.getAllProgress();
    const progress = progressMap.get(node.id) ?? {
      nodeId: node.id,
      status: 'not_started',
      lastReadAt: null,
      readRevision: node.revision,
      updatedAt: '',
    };
    const notes = db.listNotes(node.id);
    const isBookmarked = db.listBookmarks().some((b) => b.nodeId === node.id);
    const sources = node.sourceIds
      .map((sid) => contentManager.sourceById.get(sid))
      .filter(Boolean);
    const assessments = contentManager.assessmentsByNodeId.get(node.id) ?? [];
    const labs = contentManager.bundle.labs.filter((l) => node.labIds.includes(l.id) || l.relatedNodeIds.includes(node.id));
    const rawRelated = contentManager.bundle.relations
      .filter((r) => r.fromId === node.id || r.toId === node.id)
      .map((r) => {
        const peerId = r.fromId === node.id ? r.toId : r.fromId;
        const peer = contentManager.nodeById.get(peerId);
        return peer
          ? {
              nodeId: peer.id,
              title: peer.title,
              enTitle: peer.enTitle,
              domain: peer.domain,
              relationType: r.type,
              direction: (r.fromId === node.id ? 'outgoing' : 'incoming') as 'outgoing' | 'incoming',
              status: progressMap.get(peer.id)?.status ?? 'not_started',
            }
          : null;
      })
      .filter((r): r is NonNullable<typeof r> => Boolean(r));

    const dedupedMap = new Map<string, (typeof rawRelated)[number]>();
    for (const rel of rawRelated) {
      const existing = dedupedMap.get(rel.nodeId);
      if (!existing || (REL_PRIORITY[rel.relationType] ?? 99) < (REL_PRIORITY[existing.relationType] ?? 99)) {
        dedupedMap.set(rel.nodeId, rel);
      }
    }
    const relatedNodes = [...dedupedMap.values()];

    return {
      node,
      progress,
      isBookmarked,
      notes,
      sources,
      assessments,
      labs,
      relatedNodes,
    };
  });

  app.get('/api/graph', async (req) => {
    const q = z
      .object({
        scope: z.string().optional(),
        nodeId: z.string().optional(),
        depth: z.coerce.number().int().min(1).max(2).optional(),
        domain: z.string().optional(),
      })
      .parse(req.query ?? {});
    const progress = db.getAllProgress();
    const allNodes = contentManager.bundle.nodes;
    const allEdges = contentManager.bundle.relations;

    if (q.scope === 'global') {
      const filteredNodes = q.domain ? allNodes.filter((n) => n.domain === q.domain) : allNodes;
      const allowedIds = new Set(filteredNodes.map((n) => n.id));
      return {
        nodes: filteredNodes.map((n) => ({
          id: n.id,
          title: n.title,
          enTitle: n.enTitle,
          domain: n.domain,
          level: n.level,
          status: progress.get(n.id)?.status ?? 'not_started',
        })),
        edges: allEdges.filter((e) => allowedIds.has(e.fromId) && allowedIds.has(e.toId)),
      };
    }

    const centerId = q.nodeId || allNodes[0]?.id;
    const maxDepth = q.depth ?? 2;
    const visited = new Set<string>(centerId ? [centerId] : []);
    let frontier = centerId ? [centerId] : [];
    for (let d = 0; d < maxDepth; d++) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const e of allEdges) {
          if (e.fromId === cur && !visited.has(e.toId)) {
            visited.add(e.toId);
            next.push(e.toId);
          }
          if (e.toId === cur && !visited.has(e.fromId)) {
            visited.add(e.fromId);
            next.push(e.fromId);
          }
        }
      }
      frontier = next;
    }

    return {
      centerId,
      nodes: allNodes
        .filter((n) => visited.has(n.id))
        .map((n) => ({
          id: n.id,
          title: n.title,
          enTitle: n.enTitle,
          domain: n.domain,
          level: n.level,
          status: progress.get(n.id)?.status ?? 'not_started',
        })),
      edges: allEdges.filter((e) => visited.has(e.fromId) && visited.has(e.toId)),
    };
  });

  app.get('/api/glossary', async () => ({
    items: contentManager.bundle.glossary,
  }));

  // Learning Paths & Custom Paths
  app.get('/api/paths', async () => {
    const progress = db.getAllProgress();
    const customPaths = db.listCustomPaths();
    const hydratePath = (lp: {
      id: string;
      title: string;
      enTitle?: string;
      goal: string;
      audience?: string;
      estimatedHours?: number;
      stages: Array<{ id: string; title: string; description?: string; nodeIds: string[] }>;
      requiredNodeIds: string[];
      optionalNodeIds?: string[];
      extensionEdges?: Array<{ fromId: string; toId: string; kind: 'recommended' | 'extension' }>;
      isCustom?: boolean;
    }) => {
      const doneCount = lp.requiredNodeIds.filter((id) => {
        const s = progress.get(id)?.status;
        return s === 'read' || s === 'assessed';
      }).length;
      const assessedCount = lp.requiredNodeIds.filter((id) => progress.get(id)?.status === 'assessed').length;
      return {
        ...lp,
        doneCount,
        assessedCount,
        requiredTotal: lp.requiredNodeIds.length,
      };
    };

    return {
      presetPaths: contentManager.bundle.paths.map((p) => hydratePath({ ...p, isCustom: false })),
      customPaths: customPaths.map((cp) => {
        const allIds = [...new Set(cp.stages.flatMap((s) => s.nodeIds))].filter((id) =>
          contentManager.nodeById.has(id),
        );
        return hydratePath({
          id: cp.id,
          title: cp.title,
          enTitle: 'Custom Path',
          goal: cp.goal,
          audience: '个人定制',
          estimatedHours: Math.max(1, Math.round(allIds.length * 0.4)),
          stages: cp.stages,
          requiredNodeIds: allIds,
          optionalNodeIds: [],
          extensionEdges: [],
          isCustom: true,
        });
      }),
    };
  });

  app.get('/api/paths/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const progress = db.getAllProgress();
    const nodeMap = contentManager.nodeById;

    const preset = contentManager.bundle.paths.find((p) => p.id === id);
    const custom = !preset ? db.listCustomPaths().find((c) => c.id === id) : undefined;
    if (!preset && !custom) return reply.code(404).send({ error: `Path '${id}' not found` });

    const pathObj = preset
      ? { ...preset, isCustom: false }
      : {
          id: custom!.id,
          title: custom!.title,
          enTitle: 'Custom Path',
          goal: custom!.goal,
          audience: '个人定制',
          estimatedHours: Math.max(1, Math.round(custom!.stages.flatMap((s) => s.nodeIds).length * 0.4)),
          stages: custom!.stages.map((s) => ({ ...s, description: '' })),
          requiredNodeIds: [...new Set(custom!.stages.flatMap((s) => s.nodeIds))],
          optionalNodeIds: [] as string[],
          extensionEdges: [] as Array<{ fromId: string; toId: string; kind: 'recommended' | 'extension' }>,
          isCustom: true,
        };

    const allIds = [...new Set([...pathObj.requiredNodeIds, ...pathObj.optionalNodeIds, ...pathObj.stages.flatMap((s) => s.nodeIds)])];
    const nodes = allIds
      .map((nId) => {
        const n = nodeMap.get(nId);
        if (!n) return null;
        const missingPrereqs = n.requires.filter((reqId) => {
          const st = progress.get(reqId)?.status;
          return st !== 'read' && st !== 'assessed';
        });
        return {
          id: n.id,
          slug: n.slug,
          title: n.title,
          enTitle: n.enTitle,
          summary: n.summary,
          objectives: n.objectives,
          domain: n.domain,
          level: n.level,
          estimatedMinutes: n.estimatedMinutes,
          requires: n.requires,
          related: n.related,
          labIds: n.labIds,
          requiredInPath: pathObj.requiredNodeIds.includes(n.id),
          status: progress.get(n.id)?.status ?? 'not_started',
          missingPrereqs,
        };
      })
      .filter(Boolean);

    return { path: pathObj, nodes };
  });

  app.post('/api/custom-paths', async (req, reply) => {
    const schema = z.object({
      id: z.string().min(1).optional(),
      title: z.string().min(1),
      goal: z.string().default(''),
      stages: z.array(z.object({ id: z.string().min(1), title: z.string().min(1), nodeIds: z.array(z.string().min(1)).min(1) })).min(1),
    });
    const body = schema.parse(req.body);
    const id = body.id || `custom-${Date.now()}`;
    if (contentManager.bundle.paths.some((p) => p.id === id)) {
      return reply.code(400).send({ error: `Custom path ID '${id}' conflicts with preset path` });
    }
    const invalidNodeId = body.stages.flatMap((s) => s.nodeIds).find((nid) => !contentManager.nodeById.has(nid));
    if (invalidNodeId) {
      return reply.code(400).send({ error: `Unknown node ID '${invalidNodeId}' in custom path` });
    }
    return db.upsertCustomPath({ id, title: body.title, goal: body.goal, stages: body.stages });
  });

  app.delete('/api/custom-paths/:id', async (req) => {
    const { id } = req.params as { id: string };
    db.deleteCustomPath(id);
    return { deleted: true, id };
  });

  // Progress, History, Assessments, Notes, Bookmarks
  app.get('/api/progress', async () => ({
    items: [...db.getAllProgress().values()],
    history: db.getProgressHistory(60),
    readingHistory: db.getReadingHistory(30),
  }));

  app.put('/api/progress/:nodeId', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const node = contentManager.nodeById.get(nodeId);
    if (!node) return reply.code(404).send({ error: `Node '${nodeId}' not found` });
    const body = z.object({ status: ProgressStatusSchema, reason: z.string().optional() }).parse(req.body);
    return db.setProgress(node.id, body.status, node.revision, body.reason ?? 'user_action');
  });

  app.post('/api/reading-history', async (req, reply) => {
    const body = z.object({ nodeId: z.string().min(1), scrollHeading: z.string().nullable().optional() }).parse(req.body);
    if (!contentManager.nodeById.has(body.nodeId)) {
      return reply.code(404).send({ error: `Node '${body.nodeId}' not found` });
    }
    db.recordReadingHistory(body.nodeId, body.scrollHeading ?? null);
    return { ok: true };
  });

  app.get('/api/assessments', async (req) => {
    const q = req.query as { nodeId?: string; domain?: string };
    let items = contentManager.bundle.assessments;
    if (q.nodeId) items = items.filter((a) => a.nodeId === q.nodeId);
    if (q.domain) items = items.filter((a) => a.domain === q.domain);
    return { items, attempts: db.getAssessmentAttempts(q.nodeId) };
  });

  app.post('/api/assessments/:id/attempt', async (req, reply) => {
    const { id } = req.params as { id: string };
    const question = contentManager.bundle.assessments.find((a) => a.id === id);
    if (!question) return reply.code(404).send({ error: `Assessment '${id}' not found` });
    const body = z.object({ selectedOptionId: z.string().min(1) }).parse(req.body);
    const isCorrect = body.selectedOptionId === question.correctOptionId;
    const attempt = db.recordAssessmentAttempt({
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      assessmentId: question.id,
      nodeId: question.nodeId,
      selectedOptionId: body.selectedOptionId,
      isCorrect,
    });
    const node = contentManager.nodeById.get(question.nodeId);
    if (isCorrect) {
      db.resolveWrongAttemptsForAssessment(question.id);
      if (node) {
        db.setProgress(node.id, 'assessed', node.revision, `assessment_passed:${question.id}`);
      }
    }
    return { attempt, isCorrect, question };
  });

  app.post('/api/assessments/attempts/:attemptId/resolve', async (req) => {
    const { attemptId } = req.params as { attemptId: string };
    db.resolveWrongAttempt(attemptId);
    return { ok: true };
  });

  app.get('/api/notes', async (req) => {
    const q = req.query as { nodeId?: string };
    return { items: db.listNotes(q.nodeId) };
  });

  app.post('/api/notes', async (req, reply) => {
    const body = z
      .object({
        id: z.string().optional(),
        nodeId: z.string().min(1),
        body: z.string().min(1).max(20000),
        anchor: z.string().nullable().optional(),
      })
      .parse(req.body);
    if (!contentManager.nodeById.has(body.nodeId)) {
      return reply.code(404).send({ error: `Node '${body.nodeId}' not found` });
    }
    const id = body.id || `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    return db.upsertNote({ id, nodeId: body.nodeId, body: body.body, anchor: body.anchor });
  });

  app.delete('/api/notes/:id', async (req) => {
    const { id } = req.params as { id: string };
    db.deleteNote(id);
    return { deleted: true };
  });

  app.get('/api/bookmarks', async () => ({ items: db.listBookmarks() }));

  app.post('/api/bookmarks/:nodeId', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    if (!contentManager.nodeById.has(nodeId)) {
      return reply.code(404).send({ error: `Node '${nodeId}' not found` });
    }
    const body = z.object({ active: z.boolean() }).parse(req.body);
    db.toggleBookmark(nodeId, body.active);
    return { nodeId, active: body.active };
  });

  // Playground Labs
  app.get('/api/labs', async () => ({ items: contentManager.bundle.labs }));

  app.post('/api/labs/:id/simulate', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lab = contentManager.bundle.labs.find((l) => l.id === id);
    if (!lab) return reply.code(404).send({ error: `Lab '${id}' not found` });
    const body = z
      .object({
        seed: z.number().int().optional(),
        params: z.record(z.unknown()).optional(),
        faultInjection: z.string().nullable().optional(),
      })
      .parse(req.body ?? {});
    const result = runSimulation(id, {
      seed: body.seed ?? lab.defaultSeed,
      params: { ...lab.defaultParams, ...(body.params ?? {}) },
      faultInjection: body.faultInjection ?? null,
    });
    return result;
  });

  // Ecosystem & Casebook
  app.get('/api/ecosystem', async () => ({ items: contentManager.bundle.ecosystem }));

  app.get('/api/casebook', async () => ({
    items: contentManager.bundle.casebooks.map(({ body: _b, ...meta }) => meta),
  }));

  app.get('/api/casebook/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = contentManager.bundle.casebooks.find((c) => c.id === id);
    if (!item) return reply.code(404).send({ error: `Casebook '${id}' not found` });
    return item;
  });

  // Content Management & Obsidian Bridge
  app.get('/api/content/status', async () => ({
    validation: contentManager.validation,
    snapshots: db.listSnapshots(),
    drafts: db.listDrafts(),
    sources: contentManager.bundle.sources.map((s) => ({
      ...s,
      ...(db.getSourceChecks()[s.id] ?? { lastCheckedAt: null, lastCheckStatus: null }),
    })),
  }));

  app.post('/api/content/reindex', async () => {
    const { validation } = contentManager.compileAndIndex();
    return { ok: true, validation };
  });

  app.post('/api/content/import/preview', async (req) => {
    const body = z.object({ files: z.array(z.object({ filename: z.string(), content: z.string() })).min(1) }).parse(req.body);
    return previewObsidianImport(body.files, contentManager.bundle);
  });

  app.post('/api/content/import/commit', async (req, reply) => {
    const body = z.object({ files: z.array(z.object({ filename: z.string(), content: z.string() })).min(1) }).parse(req.body);
    return withMaintenanceLock(reply, () => {
      try {
        return contentManager.commitImport(body.files);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'Import failed' });
      }
    });
  });

  app.get('/api/content/export/obsidian', async () => ({
    files: exportBundleToObsidian(contentManager.bundle),
  }));

  app.get('/api/content/export/obsidian.zip', async (_req, reply) => {
    const files = exportBundleToObsidian(contentManager.bundle);
    const readme = `# AgentAtlas Obsidian Vault Export\n\n- Exported At: ${new Date().toISOString()}\n- Nodes: ${files.length}\n- Sources: ${contentManager.bundle.sources.length}\n`;
    const zipEntries = [
      { path: 'README.md', content: readme },
      ...files.map((f) => ({ path: f.relativePath, content: f.content })),
    ];
    const zipBuffer = buildZipArchive(zipEntries);
    const filename = `agent-atlas-obsidian-${new Date().toISOString().slice(0, 10)}.zip`;
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(zipBuffer);
  });

  app.post('/api/content/rollback/:snapshotId', async (req, reply) => {
    const { snapshotId } = req.params as { snapshotId: string };
    return withMaintenanceLock(reply, () => {
      try {
        return contentManager.rollbackToSnapshot(snapshotId);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'Rollback failed' });
      }
    });
  });

  app.get('/api/content/drafts', async () => ({ items: db.listDrafts() }));

  app.post('/api/content/drafts', async (req) => {
    const body = z
      .object({
        id: z.string().optional(),
        nodeId: z.string().min(1),
        title: z.string().min(1),
        domain: z.string().min(1),
        markdown: z.string().min(1),
        sourceNote: z.string().default('AI Tutor Draft (Unverified)'),
      })
      .parse(req.body);
    return db.upsertDraft({
      id: body.id || `draft-${Date.now()}`,
      nodeId: body.nodeId,
      title: body.title,
      domain: body.domain,
      markdown: body.markdown,
      sourceNote: body.sourceNote,
      verified: false,
    });
  });

  app.post('/api/content/drafts/:id/publish', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ verified: z.boolean() }).parse(req.body);
    return withMaintenanceLock(reply, () => {
      try {
        return contentManager.publishDraft(id, body.verified);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'Publish failed' });
      }
    });
  });

  app.delete('/api/content/drafts/:id', async (req) => {
    const { id } = req.params as { id: string };
    db.deleteDraft(id);
    return { deleted: true };
  });

  app.post('/api/content/check-links', async () => {
    const sources = contentManager.bundle.sources;
    const results: Array<{ sourceId: string; url: string; status: string }> = new Array(sources.length);
    let cursor = 0;
    const concurrency = 5;

    const checkOne = async (urlStr: string): Promise<string> => {
      let parsed: URL;
      try {
        parsed = new URL(urlStr);
      } catch {
        return 'invalid_url';
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return 'blocked_protocol';
      }
      if (isDisallowedExternalHost(parsed.hostname)) {
        return 'blocked_private_host';
      }

      const probe = async (method: 'HEAD' | 'GET') => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        try {
          const res = await fetch(urlStr, { method, redirect: 'manual', signal: controller.signal });
          if (method === 'GET') controller.abort();
          return res.status;
        } finally {
          clearTimeout(timer);
        }
      };

      try {
        let code = await probe('HEAD');
        if (code === 405 || code === 501) {
          code = await probe('GET');
        }
        return `HTTP ${code}`;
      } catch {
        return 'offline_or_timeout';
      }
    };

    const worker = async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= sources.length) return;
        const s = sources[idx];
        const status = await checkOne(s.url);
        db.updateSourceCheck(s.id, status);
        results[idx] = { sourceId: s.id, url: s.url, status };
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, () => worker()));
    return { checked: results.length, results };
  });

  // Settings, Secrets, Backup/Restore & AI Tutor
  app.get('/api/settings', async () => ({
    theme: db.getSetting('theme', DEFAULT_SETTINGS.theme),
    readerWidthPx: db.getSetting('readerWidthPx', DEFAULT_SETTINGS.readerWidthPx),
    fontSizePx: db.getSetting('fontSizePx', DEFAULT_SETTINGS.fontSizePx),
    reducedMotion: db.getSetting('reducedMotion', DEFAULT_SETTINGS.reducedMotion),
    tutor: getTutorConfig(),
    paths: {
      contentDir: options.contentDir,
      dataDir: options.dataDir,
      dbPath,
    },
  }));

  app.put('/api/settings', async (req, reply) => {
    const body = z
      .object({
        theme: z.enum(['system', 'light', 'dark']).optional(),
        readerWidthPx: z.number().int().min(640).max(1000).optional(),
        fontSizePx: z.number().int().min(14).max(20).optional(),
        reducedMotion: z.boolean().optional(),
        tutor: z
          .object({
            enabled: z.boolean(),
            baseUrl: z.string(),
            model: z.string(),
            timeoutMs: z.number().int().min(3000).max(120000),
            maxTokens: z.number().int().min(128).max(8192),
          })
          .optional(),
      })
      .parse(req.body);

    if (body.tutor?.baseUrl.trim()) {
      try {
        assertSafeProviderUrl(body.tutor.baseUrl.trim());
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'Invalid tutor baseUrl' });
      }
    }

    const prevTutor = getTutorConfig();
    let apiKeyClearedForNewOrigin = false;
    if (body.tutor !== undefined) {
      const nextOrigin = (() => {
        try {
          return new URL(body.tutor.baseUrl).origin;
        } catch {
          return body.tutor.baseUrl;
        }
      })();
      const prevOrigin = (() => {
        try {
          return new URL(prevTutor.baseUrl).origin;
        } catch {
          return prevTutor.baseUrl;
        }
      })();
      if (nextOrigin !== prevOrigin && secretVault.hasApiKey()) {
        secretVault.clearApiKey();
        apiKeyClearedForNewOrigin = true;
      }
    }

    if (body.theme !== undefined) db.setSetting('theme', body.theme);
    if (body.readerWidthPx !== undefined) db.setSetting('readerWidthPx', body.readerWidthPx);
    if (body.fontSizePx !== undefined) db.setSetting('fontSizePx', body.fontSizePx);
    if (body.reducedMotion !== undefined) db.setSetting('reducedMotion', body.reducedMotion);
    if (body.tutor !== undefined) db.setSetting('tutor', body.tutor);
    return { ok: true, apiKeyClearedForNewOrigin };
  });

  app.post('/api/settings/api-key', async (req, reply) => {
    const body = z.object({ apiKey: z.string().min(1), keyStorage: z.enum(['memory', 'dpapi']) }).parse(req.body);
    try {
      secretVault.setApiKey(body.apiKey, body.keyStorage);
      return { hasApiKey: secretVault.hasApiKey(), keyStorage: secretVault.getStorageMode() };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed to store API key' });
    }
  });

  app.delete('/api/settings/api-key', async () => {
    secretVault.clearApiKey();
    return { hasApiKey: false, keyStorage: secretVault.getStorageMode() };
  });

  app.get('/api/backup/list', async () => ({ backups: backupService.listBackups() }));

  app.post('/api/backup/create', async (req) => {
    const body = z.object({ label: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/).optional() }).parse(req.body ?? {});
    return backupService.createBackup(body.label ?? 'manual');
  });

  app.post('/api/backup/restore', async (req, reply) => {
    const body = z.object({ backupId: z.string().min(1) }).parse(req.body);
    return withMaintenanceLock(reply, () => {
      try {
        const outcome = backupService.restoreBackup(body.backupId);
        const compiled = contentManager.compileAndIndex();
        return { ...outcome, validation: compiled.validation };
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'Restore failed' });
      }
    });
  });

  app.post('/api/tutor/test-connection', async () => {
    return tutorService.testConnection(getTutorConfig(), secretVault.getApiKey());
  });

  app.post('/api/tutor/chat', async (req) => {
    const body = z
      .object({
        question: z.string().min(1),
        mode: z.enum(['concept-explain', 'deep-research', 'socratic', 'architecture-deduction', 'design-review', 'quiz-draft']),
        depth: z.enum(['concept', 'mechanism', 'architecture', 'practice']),
        currentNodeId: z.string().optional(),
        history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).optional(),
      })
      .parse(req.body);
    return tutorService.chat(body, getTutorConfig(), secretVault.getApiKey(), db, contentManager.bundle);
  });

  // Static serving for production web bundle (same-origin SPA fallback)
  if (options.webDistDir && fs.existsSync(options.webDistDir)) {
    await app.register(fastifyStatic, {
      root: options.webDistDir,
      wildcard: true,
      cacheControl: false,
      setHeaders: (res, filePath) => {
        if (path.basename(filePath) === 'index.html') {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=0');
        }
      },
    });
    app.setNotFoundHandler((request, reply) => {
      const urlPath = request.url.split('?')[0];
      if (urlPath === '/api' || urlPath.startsWith('/api/')) {
        return reply.code(404).send({ error: `API route not found: ${request.url}` });
      }
      if (
        urlPath.startsWith('/assets/') ||
        (!urlPath.startsWith('/library/') &&
          !urlPath.startsWith('/casebook/') &&
          /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|wasm)$/i.test(urlPath))
      ) {
        return reply.code(404).send({ error: `Asset not found: ${request.url}` });
      }
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html');
    });
  }

  return { app, db, contentManager, backupService, secretVault, csrfToken };
}

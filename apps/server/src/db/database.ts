import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {
  ContentBundle,
  ProgressStatus,
  UserProgressRecord,
} from '@agent-atlas/shared';

export interface SearchQueryOptions {
  q?: string;
  domain?: string;
  type?: string;
  level?: string;
  status?: string;
  tag?: string;
  limit?: number;
}

export interface SearchResultItem {
  id: string;
  slug: string;
  title: string;
  enTitle: string;
  domain: string;
  type: string;
  level: string;
  summary: string;
  tags: string[];
  status: ProgressStatus;
  snippet: string;
  score: number;
}

export interface NoteRecord {
  id: string;
  nodeId: string;
  body: string;
  anchor: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookmarkRecord {
  nodeId: string;
  createdAt: string;
}

export interface ReadingHistoryRecord {
  nodeId: string;
  visitedAt: string;
  scrollHeading: string | null;
}

export interface CustomPathRecord {
  id: string;
  title: string;
  goal: string;
  stages: Array<{ id: string; title: string; nodeIds: string[] }>;
  createdAt: string;
  updatedAt: string;
}

export interface ContentDraftRecord {
  id: string;
  nodeId: string;
  title: string;
  domain: string;
  markdown: string;
  sourceNote: string;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SnapshotRecord {
  id: string;
  reason: string;
  summary: string;
  createdAt: string;
  snapshotPath: string;
}

/**
 * Generates deterministic 2-gram, 3-gram, and unigram CJK tokens
 * so SQLite FTS5 `unicode61` matches 2-character Chinese terms (e.g. 循环, 状态)
 * alongside English tokens.
 */
export function tokenizeCJK(text: string): string {
  const tokens: string[] = [];
  const runs = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const run of runs) {
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let i = 0; i < run.length; i++) {
      if (i + 1 < run.length) tokens.push(run.slice(i, i + 2));
      if (i + 2 < run.length) tokens.push(run.slice(i, i + 3));
    }
  }
  return tokens.join(' ');
}

function escapeFtsTerm(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

export class AtlasDatabase {
  public readonly dbPath: string;
  public db: DatabaseSync;
  private glossaryCache: Array<{ term: string; zhTerm: string; lowerCandidates: string[] }> | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;

      -- Rebuildable Content Index Tables
      CREATE TABLE IF NOT EXISTS idx_nodes (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        en_title TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        type TEXT NOT NULL,
        domain TEXT NOT NULL,
        level TEXT NOT NULL,
        revision INTEGER NOT NULL,
        estimated_minutes INTEGER NOT NULL,
        summary TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        source_ids_json TEXT NOT NULL,
        verified_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS idx_edges (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        type TEXT NOT NULL,
        PRIMARY KEY (from_id, to_id, type)
      );

      CREATE TABLE IF NOT EXISTS idx_sources (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        kind TEXT NOT NULL,
        license_status TEXT NOT NULL,
        upstream_version TEXT NOT NULL,
        verified_at TEXT NOT NULL,
        last_checked_at TEXT,
        last_check_status TEXT
      );

      CREATE TABLE IF NOT EXISTS idx_glossary (
        id TEXT PRIMARY KEY,
        term TEXT NOT NULL,
        zh_term TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        domain TEXT NOT NULL,
        definition TEXT NOT NULL,
        node_id TEXT
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS idx_docs_fts USING fts5(
        id UNINDEXED,
        title,
        en_title,
        aliases,
        summary,
        tags,
        body,
        cjk_tokens,
        tokenize='unicode61'
      );

      -- Durable User State Tables (NEVER cleared on index rebuild)
      CREATE TABLE IF NOT EXISTS user_progress (
        node_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        last_read_at TEXT,
        read_revision INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS progress_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id TEXT NOT NULL,
        previous_status TEXT,
        new_status TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assessment_attempts (
        id TEXT PRIMARY KEY,
        assessment_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        selected_option_id TEXT NOT NULL,
        is_correct INTEGER NOT NULL,
        needs_review INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_notes (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        body TEXT NOT NULL,
        anchor TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bookmarks (
        node_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reading_history (
        node_id TEXT PRIMARY KEY,
        visited_at TEXT NOT NULL,
        scroll_heading TEXT
      );

      CREATE TABLE IF NOT EXISTS custom_paths (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        stages_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS content_drafts (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        title TEXT NOT NULL,
        domain TEXT NOT NULL,
        markdown TEXT NOT NULL,
        source_note TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS content_snapshots (
        id TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        snapshot_path TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_domain ON idx_nodes(domain);
      CREATE INDEX IF NOT EXISTS idx_notes_node_id ON user_notes(node_id);
      CREATE INDEX IF NOT EXISTS idx_attempts_node_review ON assessment_attempts(node_id, needs_review);
      CREATE INDEX IF NOT EXISTS idx_progress_history_node ON progress_history(node_id);
    `);
  }

  public reopen() {
    this.close();
    this.glossaryCache = null;
    this.db = new DatabaseSync(this.dbPath);
    this.init();
  }

  public close() {
    if (this.db.isOpen) {
      this.db.close();
    }
  }

  public vacuumBackupTo(destSqlitePath: string) {
    if (fs.existsSync(destSqlitePath)) {
      fs.rmSync(destSqlitePath, { force: true });
    }
    const escaped = destSqlitePath.replace(/'/g, "''");
    this.db.exec(`VACUUM INTO '${escaped}'`);
  }

  /**
   * Rebuilds search & graph indices atomically without touching any `user_*` table.
   */
  public rebuildIndex(bundle: ContentBundle) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec(`
        DELETE FROM idx_nodes;
        DELETE FROM idx_edges;
        DELETE FROM idx_glossary;
        DELETE FROM idx_docs_fts;
      `);

      const insertNode = this.db.prepare(`
        INSERT INTO idx_nodes (id, slug, title, en_title, aliases_json, type, domain, level, revision, estimated_minutes, summary, tags_json, source_ids_json, verified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertFts = this.db.prepare(`
        INSERT INTO idx_docs_fts (id, title, en_title, aliases, summary, tags, body, cjk_tokens)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const n of bundle.nodes) {
        insertNode.run(
          n.id,
          n.slug,
          n.title,
          n.enTitle,
          JSON.stringify(n.aliases),
          n.type,
          n.domain,
          n.level,
          n.revision,
          n.estimatedMinutes,
          n.summary,
          JSON.stringify(n.tags),
          JSON.stringify(n.sourceIds),
          n.verifiedAt,
        );
        const allText = [n.title, n.enTitle, n.aliases.join(' '), n.summary, n.tags.join(' '), n.body].join(' ');
        insertFts.run(
          n.id,
          n.title,
          n.enTitle,
          n.aliases.join(' '),
          n.summary,
          n.tags.join(' '),
          n.body,
          tokenizeCJK(allText),
        );
      }

      const insertEdge = this.db.prepare('INSERT OR IGNORE INTO idx_edges (from_id, to_id, type) VALUES (?, ?, ?)');
      for (const e of bundle.relations) {
        insertEdge.run(e.fromId, e.toId, e.type);
      }

      const upsertSource = this.db.prepare(`
        INSERT INTO idx_sources (id, title, url, kind, license_status, upstream_version, verified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          url = excluded.url,
          kind = excluded.kind,
          license_status = excluded.license_status,
          upstream_version = excluded.upstream_version,
          verified_at = excluded.verified_at
      `);
      for (const s of bundle.sources) {
        upsertSource.run(s.id, s.title, s.url, s.kind, s.licenseStatus, s.upstreamVersion, s.verifiedAt);
      }
      if (bundle.sources.length > 0) {
        const placeholders = bundle.sources.map(() => '?').join(', ');
        this.db.prepare(`DELETE FROM idx_sources WHERE id NOT IN (${placeholders})`).run(...bundle.sources.map((s) => s.id));
      }

      const insertGlossary = this.db.prepare(`
        INSERT INTO idx_glossary (id, term, zh_term, aliases_json, domain, definition, node_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const g of bundle.glossary) {
        insertGlossary.run(g.id, g.term, g.zhTerm, JSON.stringify(g.aliases), g.domain, g.definition, g.nodeId ?? null);
      }

      this.db.exec('COMMIT');
      this.glossaryCache = null;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private expandSynonyms(query: string): string[] {
    const trimmed = query.trim().toLowerCase();
    if (trimmed.length < 2) return [];
    if (!this.glossaryCache) {
      const rows = this.db.prepare('SELECT term, zh_term, aliases_json FROM idx_glossary').all() as Array<{
        term: string;
        zh_term: string;
        aliases_json: string;
      }>;
      this.glossaryCache = rows.map((row) => {
        const aliases = JSON.parse(row.aliases_json) as string[];
        return {
          term: row.term,
          zhTerm: row.zh_term,
          lowerCandidates: [row.term, row.zh_term, ...aliases].map((c) => c.toLowerCase()),
        };
      });
    }
    const isPureAscii = /^[a-z0-9._-]+$/i.test(trimmed);
    const extras: string[] = [];
    for (const item of this.glossaryCache) {
      const matched = item.lowerCandidates.some((c) => {
        if (c === trimmed) return true;
        if (isPureAscii) {
          if (trimmed.length < 3) return false;
          return c.split(/[\s/()_-]+/).some((tok) => tok === trimmed || tok.startsWith(trimmed));
        }
        return c.includes(trimmed);
      });
      if (matched) {
        extras.push(item.term, item.zhTerm);
      }
    }
    return [...new Set(extras)];
  }

  public searchNodes(options: SearchQueryOptions): SearchResultItem[] {
    const q = (options.q ?? '').trim();
    const rawLimit = Number.isFinite(options.limit) ? (options.limit as number) : 40;
    const limit = Math.min(500, Math.max(1, Math.trunc(rawLimit)));

    const filters: string[] = [];
    const filterParams: Array<string | number> = [];

    if (options.domain) {
      filters.push('n.domain = ?');
      filterParams.push(options.domain);
    }
    if (options.type) {
      filters.push('n.type = ?');
      filterParams.push(options.type);
    }
    if (options.level) {
      filters.push('n.level = ?');
      filterParams.push(options.level);
    }
    if (options.tag) {
      const escapedTag = options.tag.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      filters.push("n.tags_json LIKE ? ESCAPE '\\'");
      filterParams.push(`%"${escapedTag}"%`);
    }
    if (options.status) {
      if (options.status === 'not_started') {
        filters.push('(p.status IS NULL OR p.status = ?)');
        filterParams.push('not_started');
      } else {
        filters.push('p.status = ?');
        filterParams.push(options.status);
      }
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    if (!q) {
      const sql = `
        SELECT n.id, n.slug, n.title, n.en_title, n.domain, n.type, n.level, n.summary, n.tags_json,
               COALESCE(p.status, 'not_started') AS status
        FROM idx_nodes n
        LEFT JOIN user_progress p ON p.node_id = n.id
        ${whereClause}
        ORDER BY n.domain ASC, n.title ASC
        LIMIT ?
      `;
      const rows = this.db.prepare(sql).all(...filterParams, limit) as Array<Record<string, string>>;
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        enTitle: r.en_title,
        domain: r.domain,
        type: r.type,
        level: r.level,
        summary: r.summary,
        tags: JSON.parse(r.tags_json) as string[],
        status: r.status as ProgressStatus,
        snippet: r.summary,
        score: 0,
      }));
    }

    // Build hybrid FTS5 query combining Latin terms, CJK n-grams, and synonym alternatives
    const buildClause = (text: string, joiner: 'AND' | 'OR' = 'AND'): string => {
      const cleaned =
        joiner === 'OR'
          ? text.replace(/怎么选|为什么|怎么样|怎么|如何|什么|可以|是否|请问|哪些|区别|和|与|的|吗|呢/g, ' ')
          : text;
      const latin = (cleaned.match(/[a-zA-Z0-9._-]+/g) || []).map((t) => escapeFtsTerm(t));
      const cjk = tokenizeCJK(cleaned)
        .split(' ')
        .filter((t) => Boolean(t) && (joiner === 'AND' || t.length === 2))
        .map((t) => escapeFtsTerm(t));
      const parts = [...latin, ...cjk];
      if (parts.length === 0) return '';
      return `(${parts.join(` ${joiner} `)})`;
    };

    const runFts = (matchExpr: string) => {
      const ftsFilters = ['idx_docs_fts MATCH ?', ...filters];
      const ftsParams: Array<string | number> = [matchExpr, ...filterParams, limit];
      const sql = `
        SELECT n.id, n.slug, n.title, n.en_title, n.domain, n.type, n.level, n.summary, n.tags_json,
               COALESCE(p.status, 'not_started') AS status,
               snippet(idx_docs_fts, 6, '<mark>', '</mark>', '...', 24) AS snippet,
               bm25(idx_docs_fts, 0.0, 10.0, 8.0, 9.0, 4.0, 3.0, 1.0, 2.0) AS rank
        FROM idx_docs_fts
        JOIN idx_nodes n ON n.id = idx_docs_fts.id
        LEFT JOIN user_progress p ON p.node_id = n.id
        WHERE ${ftsFilters.join(' AND ')}
        ORDER BY rank ASC
        LIMIT ?
      `;
      return this.db.prepare(sql).all(...ftsParams) as Array<Record<string, unknown>>;
    };

    const primaryClause = buildClause(q, 'AND');
    const synonymClauses = this.expandSynonyms(q)
      .slice(0, 3)
      .map((s) => buildClause(s, 'AND'))
      .filter(Boolean);
    const fullMatch = [primaryClause, ...synonymClauses].filter(Boolean).join(' OR ');

    if (!fullMatch) return [];

    let rows = runFts(fullMatch);
    if (rows.length === 0) {
      const relaxed = buildClause(q, 'OR');
      if (relaxed) {
        rows = runFts(relaxed);
      }
    }
    return rows.map((r) => ({
      id: String(r.id),
      slug: String(r.slug),
      title: String(r.title),
      enTitle: String(r.en_title),
      domain: String(r.domain),
      type: String(r.type),
      level: String(r.level),
      summary: String(r.summary),
      tags: JSON.parse(String(r.tags_json)) as string[],
      status: String(r.status) as ProgressStatus,
      snippet: String(r.snippet || r.summary),
      score: Number(r.rank ?? 0),
    }));
  }

  public getAllProgress(): Map<string, UserProgressRecord> {
    const rows = this.db.prepare('SELECT node_id, status, last_read_at, read_revision, updated_at FROM user_progress').all() as Array<Record<string, unknown>>;
    const map = new Map<string, UserProgressRecord>();
    for (const r of rows) {
      map.set(String(r.node_id), {
        nodeId: String(r.node_id),
        status: String(r.status) as ProgressStatus,
        lastReadAt: r.last_read_at ? String(r.last_read_at) : null,
        readRevision: Number(r.read_revision ?? 1),
        updatedAt: String(r.updated_at),
      });
    }
    return map;
  }

  public setProgress(nodeId: string, status: ProgressStatus, revision: number, reason = 'manual'): UserProgressRecord {
    const now = new Date().toISOString();
    const prev = this.db.prepare('SELECT status, last_read_at FROM user_progress WHERE node_id = ?').get(nodeId) as
      | { status: string; last_read_at: string | null }
      | undefined;

    const lastReadAt = status === 'read' || status === 'assessed' || status === 'in_progress' ? now : (prev?.last_read_at ?? null);
    this.db
      .prepare(
        `INSERT INTO user_progress (node_id, status, last_read_at, read_revision, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(node_id) DO UPDATE SET
           status = excluded.status,
           last_read_at = COALESCE(excluded.last_read_at, user_progress.last_read_at),
           read_revision = excluded.read_revision,
           updated_at = excluded.updated_at`,
      )
      .run(nodeId, status, lastReadAt, revision, now);

    this.db
      .prepare('INSERT INTO progress_history (node_id, previous_status, new_status, reason, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(nodeId, prev?.status ?? null, status, reason, now);

    return { nodeId, status, lastReadAt, readRevision: revision, updatedAt: now };
  }

  public markMajorUpdatesForReview(updatedNodeIds: Array<{ nodeId: string; newRevision: number }>) {
    const now = new Date().toISOString();
    for (const item of updatedNodeIds) {
      const existing = this.db.prepare('SELECT status FROM user_progress WHERE node_id = ?').get(item.nodeId) as { status: string } | undefined;
      if (existing && (existing.status === 'read' || existing.status === 'assessed')) {
        this.db
          .prepare('UPDATE user_progress SET status = ?, updated_at = ? WHERE node_id = ?')
          .run('needs_review', now, item.nodeId);
        this.db
          .prepare('INSERT INTO progress_history (node_id, previous_status, new_status, reason, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(item.nodeId, existing.status, 'needs_review', `content_major_update_rev_${item.newRevision}`, now);
      }
    }
  }

  public getProgressHistory(limit = 50) {
    return this.db
      .prepare('SELECT id, node_id AS nodeId, previous_status AS previousStatus, new_status AS newStatus, reason, created_at AS createdAt FROM progress_history ORDER BY id DESC LIMIT ?')
      .all(limit);
  }

  public recordReadingHistory(nodeId: string, scrollHeading: string | null = null) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO reading_history (node_id, visited_at, scroll_heading)
         VALUES (?, ?, ?)
         ON CONFLICT(node_id) DO UPDATE SET visited_at = excluded.visited_at, scroll_heading = COALESCE(excluded.scroll_heading, reading_history.scroll_heading)`,
      )
      .run(nodeId, now, scrollHeading);
  }

  public getReadingHistory(limit = 20): ReadingHistoryRecord[] {
    return this.db
      .prepare('SELECT node_id AS nodeId, visited_at AS visitedAt, scroll_heading AS scrollHeading FROM reading_history ORDER BY visited_at DESC LIMIT ?')
      .all(limit) as unknown as ReadingHistoryRecord[];
  }

  public recordAssessmentAttempt(input: {
    id: string;
    assessmentId: string;
    nodeId: string;
    selectedOptionId: string;
    isCorrect: boolean;
  }) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO assessment_attempts (id, assessment_id, node_id, selected_option_id, is_correct, needs_review, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(input.id, input.assessmentId, input.nodeId, input.selectedOptionId, input.isCorrect ? 1 : 0, input.isCorrect ? 0 : 1, now);
    return { ...input, needsReview: !input.isCorrect, createdAt: now };
  }

  public getAssessmentAttempts(nodeId?: string) {
    const rows = nodeId
      ? this.db
          .prepare(
            'SELECT id, assessment_id AS assessmentId, node_id AS nodeId, selected_option_id AS selectedOptionId, is_correct AS isCorrect, needs_review AS needsReview, created_at AS createdAt FROM assessment_attempts WHERE node_id = ? ORDER BY created_at DESC',
          )
          .all(nodeId)
      : this.db
          .prepare(
            'SELECT id, assessment_id AS assessmentId, node_id AS nodeId, selected_option_id AS selectedOptionId, is_correct AS isCorrect, needs_review AS needsReview, created_at AS createdAt FROM assessment_attempts ORDER BY created_at DESC LIMIT 200',
          )
          .all();
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      assessmentId: String(r.assessmentId),
      nodeId: String(r.nodeId),
      selectedOptionId: String(r.selectedOptionId),
      isCorrect: Boolean(r.isCorrect),
      needsReview: Boolean(r.needsReview),
      createdAt: String(r.createdAt),
    }));
  }

  public resolveWrongAttempt(attemptId: string) {
    this.db.prepare('UPDATE assessment_attempts SET needs_review = 0 WHERE id = ?').run(attemptId);
  }

  public resolveWrongAttemptsForAssessment(assessmentId: string) {
    this.db
      .prepare('UPDATE assessment_attempts SET needs_review = 0 WHERE assessment_id = ? AND is_correct = 0')
      .run(assessmentId);
  }

  public listNotes(nodeId?: string): NoteRecord[] {
    const sql = nodeId
      ? 'SELECT id, node_id AS nodeId, body, anchor, created_at AS createdAt, updated_at AS updatedAt FROM user_notes WHERE node_id = ? ORDER BY updated_at DESC'
      : 'SELECT id, node_id AS nodeId, body, anchor, created_at AS createdAt, updated_at AS updatedAt FROM user_notes ORDER BY updated_at DESC';
    return (nodeId ? this.db.prepare(sql).all(nodeId) : this.db.prepare(sql).all()) as unknown as NoteRecord[];
  }

  public upsertNote(note: { id: string; nodeId: string; body: string; anchor?: string | null }): NoteRecord {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT created_at FROM user_notes WHERE id = ?').get(note.id) as { created_at: string } | undefined;
    const createdAt = existing?.created_at ?? now;
    this.db
      .prepare(
        `INSERT INTO user_notes (id, node_id, body, anchor, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET body = excluded.body, anchor = excluded.anchor, updated_at = excluded.updated_at`,
      )
      .run(note.id, note.nodeId, note.body, note.anchor ?? null, createdAt, now);
    return { id: note.id, nodeId: note.nodeId, body: note.body, anchor: note.anchor ?? null, createdAt, updatedAt: now };
  }

  public deleteNote(id: string) {
    this.db.prepare('DELETE FROM user_notes WHERE id = ?').run(id);
  }

  public listBookmarks(): BookmarkRecord[] {
    return this.db.prepare('SELECT node_id AS nodeId, created_at AS createdAt FROM bookmarks ORDER BY created_at DESC').all() as unknown as BookmarkRecord[];
  }

  public toggleBookmark(nodeId: string, active: boolean) {
    if (active) {
      this.db.prepare('INSERT OR IGNORE INTO bookmarks (node_id, created_at) VALUES (?, ?)').run(nodeId, new Date().toISOString());
    } else {
      this.db.prepare('DELETE FROM bookmarks WHERE node_id = ?').run(nodeId);
    }
  }

  public listCustomPaths(): CustomPathRecord[] {
    const rows = this.db.prepare('SELECT id, title, goal, stages_json, created_at, updated_at FROM custom_paths ORDER BY updated_at DESC').all() as Array<
      Record<string, string>
    >;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      goal: r.goal,
      stages: JSON.parse(r.stages_json),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public upsertCustomPath(input: { id: string; title: string; goal: string; stages: Array<{ id: string; title: string; nodeIds: string[] }> }): CustomPathRecord {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT created_at FROM custom_paths WHERE id = ?').get(input.id) as { created_at: string } | undefined;
    const createdAt = existing?.created_at ?? now;
    this.db
      .prepare(
        `INSERT INTO custom_paths (id, title, goal, stages_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, goal = excluded.goal, stages_json = excluded.stages_json, updated_at = excluded.updated_at`,
      )
      .run(input.id, input.title, input.goal, JSON.stringify(input.stages), createdAt, now);
    return { ...input, createdAt, updatedAt: now };
  }

  public deleteCustomPath(id: string) {
    this.db.prepare('DELETE FROM custom_paths WHERE id = ?').run(id);
  }

  public listDrafts(): ContentDraftRecord[] {
    const rows = this.db
      .prepare('SELECT id, node_id, title, domain, markdown, source_note, verified, created_at, updated_at FROM content_drafts ORDER BY updated_at DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      nodeId: String(r.node_id),
      title: String(r.title),
      domain: String(r.domain),
      markdown: String(r.markdown),
      sourceNote: String(r.source_note),
      verified: Boolean(r.verified),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
  }

  public upsertDraft(draft: {
    id: string;
    nodeId: string;
    title: string;
    domain: string;
    markdown: string;
    sourceNote: string;
    verified?: boolean;
  }): ContentDraftRecord {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT created_at FROM content_drafts WHERE id = ?').get(draft.id) as { created_at: string } | undefined;
    const createdAt = existing?.created_at ?? now;
    this.db
      .prepare(
        `INSERT INTO content_drafts (id, node_id, title, domain, markdown, source_note, verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, domain = excluded.domain, markdown = excluded.markdown, source_note = excluded.source_note, verified = excluded.verified, updated_at = excluded.updated_at`,
      )
      .run(draft.id, draft.nodeId, draft.title, draft.domain, draft.markdown, draft.sourceNote, draft.verified ? 1 : 0, createdAt, now);
    return {
      id: draft.id,
      nodeId: draft.nodeId,
      title: draft.title,
      domain: draft.domain,
      markdown: draft.markdown,
      sourceNote: draft.sourceNote,
      verified: Boolean(draft.verified),
      createdAt,
      updatedAt: now,
    };
  }

  public deleteDraft(id: string) {
    this.db.prepare('DELETE FROM content_drafts WHERE id = ?').run(id);
  }

  public addSnapshot(record: SnapshotRecord) {
    this.db
      .prepare('INSERT INTO content_snapshots (id, reason, summary, created_at, snapshot_path) VALUES (?, ?, ?, ?, ?)')
      .run(record.id, record.reason, record.summary, record.createdAt, record.snapshotPath);
  }

  public listSnapshots(): SnapshotRecord[] {
    return this.db
      .prepare('SELECT id, reason, summary, created_at AS createdAt, snapshot_path AS snapshotPath FROM content_snapshots ORDER BY created_at DESC')
      .all() as unknown as SnapshotRecord[];
  }

  public getSnapshot(id: string): SnapshotRecord | undefined {
    return this.db
      .prepare('SELECT id, reason, summary, created_at AS createdAt, snapshot_path AS snapshotPath FROM content_snapshots WHERE id = ?')
      .get(id) as unknown as SnapshotRecord | undefined;
  }

  public getSetting<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key) as { value_json: string } | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(row.value_json) as T;
    } catch {
      return fallback;
    }
  }

  public setSetting(key: string, value: unknown) {
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), new Date().toISOString());
  }

  public updateSourceCheck(sourceId: string, status: string) {
    this.db
      .prepare('UPDATE idx_sources SET last_checked_at = ?, last_check_status = ? WHERE id = ?')
      .run(new Date().toISOString(), status, sourceId);
  }

  public getSourceChecks(): Record<string, { lastCheckedAt: string | null; lastCheckStatus: string | null }> {
    const rows = this.db.prepare('SELECT id, last_checked_at, last_check_status FROM idx_sources').all() as Array<Record<string, string | null>>;
    const out: Record<string, { lastCheckedAt: string | null; lastCheckStatus: string | null }> = {};
    for (const r of rows) {
      if (r.id) out[r.id] = { lastCheckedAt: r.last_checked_at, lastCheckStatus: r.last_check_status };
    }
    return out;
  }
}

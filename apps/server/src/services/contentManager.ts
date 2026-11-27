import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertSafeRelativePath,
  compileContentDirectory,
  diffContentBundles,
  exportNodeToObsidianMarkdown,
  parseKnowledgeMarkdown,
  previewObsidianImport,
  validateContentBundle,
} from '@agent-atlas/content';
import {
  AssessmentQuestion,
  ContentBundle,
  KnowledgeNode,
  SourceEntry,
  ValidationReport,
  getKnowledgeFolderForDomain,
} from '@agent-atlas/shared';
import { AtlasDatabase } from '../db/database.js';
import { replaceDirectoryAtomically } from './fsSwap.js';

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

export class ContentManager {
  public bundle: ContentBundle;
  public validation: ValidationReport;
  public nodeById = new Map<string, KnowledgeNode>();
  public nodeBySlug = new Map<string, KnowledgeNode>();
  public sourceById = new Map<string, SourceEntry>();
  public assessmentsByNodeId = new Map<string, AssessmentQuestion[]>();

  constructor(
    private readonly contentDir: string,
    private readonly snapshotsDir: string,
    private readonly db: AtlasDatabase,
  ) {
    fs.mkdirSync(this.snapshotsDir, { recursive: true });
    const compiled = this.compileAndIndex();
    this.bundle = compiled.bundle;
    this.validation = compiled.validation;
  }

  private refreshLookupCaches(bundle: ContentBundle) {
    this.nodeById = new Map(bundle.nodes.map((n) => [n.id, n]));
    this.nodeBySlug = new Map(bundle.nodes.map((n) => [n.slug, n]));
    this.sourceById = new Map(bundle.sources.map((s) => [s.id, s]));
    const byNode = new Map<string, AssessmentQuestion[]>();
    for (const q of bundle.assessments) {
      const list = byNode.get(q.nodeId) ?? [];
      list.push(q);
      byNode.set(q.nodeId, list);
    }
    this.assessmentsByNodeId = byNode;
  }

  public compileAndIndex(): { bundle: ContentBundle; validation: ValidationReport } {
    const bundle = compileContentDirectory(this.contentDir);
    const validation = validateContentBundle(bundle);
    this.db.rebuildIndex(bundle);
    this.bundle = bundle;
    this.validation = validation;
    this.refreshLookupCaches(bundle);
    return { bundle, validation };
  }

  public createSnapshot(reason: string, summary: string) {
    const id = `snap-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(2).toString('hex')}`;
    const snapDir = assertSafeRelativePath(this.snapshotsDir, id);
    copyDir(this.contentDir, snapDir);
    const record = {
      id,
      reason,
      summary,
      createdAt: new Date().toISOString(),
      snapshotPath: id,
    };
    this.db.addSnapshot(record);
    return record;
  }

  private resolveSnapshotDir(snap: { id: string; snapshotPath: string }): string {
    const byId = assertSafeRelativePath(this.snapshotsDir, snap.id);
    if (fs.existsSync(byId)) return byId;

    if (!path.isAbsolute(snap.snapshotPath)) {
      const byRel = assertSafeRelativePath(this.snapshotsDir, snap.snapshotPath);
      if (fs.existsSync(byRel)) return byRel;
    } else {
      const base = path.resolve(this.snapshotsDir);
      const resolved = path.resolve(snap.snapshotPath);
      const rel = path.relative(base, resolved);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel) && fs.existsSync(resolved)) {
        return resolved;
      }
    }
    return byId;
  }

  public commitImport(files: Array<{ filename: string; content: string }>) {
    const preview = previewObsidianImport(files, this.bundle);
    if (!preview.valid) {
      const reasons = preview.items.flatMap((i) => i.errors);
      throw new Error(`Import rejected: ${reasons.join('; ')}`);
    }

    const prevBundle = this.bundle;
    const resolvedContentDir = path.resolve(this.contentDir);
    const stageDir = path.join(
      path.dirname(resolvedContentDir),
      `.${path.basename(resolvedContentDir)}.import-stage-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
    );

    let snapshot: ReturnType<ContentManager['createSnapshot']> | null = null;
    try {
      copyDir(this.contentDir, stageDir);
      for (const item of preview.items) {
        if (!item.parsedNode) continue;
        const node = item.parsedNode;
        const existing = prevBundle.nodes.find((n) => n.id === node.id);
        const relTarget = existing
          ? existing.bodyPath
          : `knowledge/${getKnowledgeFolderForDomain(node.domain)}/${node.slug}.md`;
        const fullTarget = assertSafeRelativePath(stageDir, relTarget);
        fs.mkdirSync(path.dirname(fullTarget), { recursive: true });
        fs.writeFileSync(fullTarget, exportNodeToObsidianMarkdown(node), 'utf8');
      }

      const nextBundle = compileContentDirectory(stageDir);
      const nextValidation = validateContentBundle(nextBundle);
      if (!nextValidation.valid) {
        throw new Error(
          `Post-import validation failed: ${nextValidation.issues
            .filter((i) => i.severity === 'error')
            .map((i) => i.message)
            .join('; ')}`,
        );
      }

      snapshot = this.createSnapshot('import', `Import ${files.length} markdown file(s)`);
      replaceDirectoryAtomically(stageDir, this.contentDir, copyDir);

      const diff = diffContentBundles(prevBundle, nextBundle);
      this.db.rebuildIndex(nextBundle);
      this.db.markMajorUpdatesForReview(
        diff.updatedNodes.filter((u) => u.majorUpdate).map((u) => ({ nodeId: u.nodeId, newRevision: u.newRevision })),
      );

      this.bundle = nextBundle;
      this.validation = nextValidation;
      this.refreshLookupCaches(nextBundle);
      return { snapshot, diff, validation: nextValidation };
    } catch (err) {
      if (snapshot) {
        try {
          this.restoreSnapshotFiles(this.resolveSnapshotDir(snapshot));
          this.compileAndIndex();
        } catch {
          // Best-effort rollback if failure occurred after swap
        }
      }
      throw err;
    } finally {
      if (fs.existsSync(stageDir)) {
        fs.rmSync(stageDir, { recursive: true, force: true });
      }
    }
  }

  public publishDraft(draftId: string, verified: boolean) {
    if (!verified) {
      throw new Error('Draft must pass manual fact verification before publishing to official knowledge base');
    }
    const drafts = this.db.listDrafts();
    const draft = drafts.find((d) => d.id === draftId);
    if (!draft) throw new Error(`Draft '${draftId}' not found`);

    // Validate markdown safely before committing
    parseKnowledgeMarkdown(draft.markdown, `knowledge/${draft.domain}/${draft.nodeId}.md`);
    const result = this.commitImport([{ filename: `${draft.nodeId}.md`, content: draft.markdown }]);
    this.db.deleteDraft(draftId);
    return result;
  }

  public rollbackToSnapshot(snapshotId: string) {
    const snap = this.db.getSnapshot(snapshotId);
    if (!snap) {
      throw new Error(`Snapshot '${snapshotId}' not found`);
    }
    const snapDir = this.resolveSnapshotDir(snap);
    if (!fs.existsSync(snapDir)) {
      throw new Error(`Snapshot '${snapshotId}' directory not found`);
    }
    const safety = this.createSnapshot('pre-rollback', `Before rollback to ${snapshotId}`);
    this.restoreSnapshotFiles(snapDir);
    const compiled = this.compileAndIndex();
    return { rolledBackTo: snap, safetySnapshot: safety, validation: compiled.validation };
  }

  private restoreSnapshotFiles(snapshotDir: string) {
    replaceDirectoryAtomically(snapshotDir, this.contentDir, copyDir);
  }
}

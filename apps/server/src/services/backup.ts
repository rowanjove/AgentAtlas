import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertSafeRelativePath } from '@agent-atlas/content';
import { AtlasDatabase } from '../db/database.js';
import { replaceDirectoryAtomically } from './fsSwap.js';

export interface BackupManifest {
  version: string;
  backupId: string;
  createdAt: string;
  files: Array<{
    relativePath: string;
    sha256: string;
    size: number;
  }>;
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function copyDirRecursive(srcDir: string, destDir: string) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.secrets')) continue;
    const src = path.join(srcDir, entry.name);
    const dst = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(src, dst);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dst);
    }
  }
}

function collectFiles(rootDir: string, baseForManifest: string): BackupManifest['files'] {
  const out: BackupManifest['files'] = [];
  if (!fs.existsSync(rootDir)) return out;
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.name === 'manifest.json' || entry.name.startsWith('.secrets')) continue;
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, baseForManifest));
    } else if (entry.isFile()) {
      const rel = path.relative(baseForManifest, full).replace(/\\/g, '/');
      const st = fs.statSync(full);
      out.push({ relativePath: rel, sha256: sha256File(full), size: st.size });
    }
  }
  return out;
}

export class BackupService {
  constructor(
    private readonly contentDir: string,
    private readonly backupsDir: string,
    private readonly db: AtlasDatabase,
  ) {
    fs.mkdirSync(this.backupsDir, { recursive: true });
  }

  public createBackup(label = 'manual'): BackupManifest {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupId = `backup-${stamp}-${crypto.randomBytes(2).toString('hex')}-${label}`;
    const targetDir = assertSafeRelativePath(this.backupsDir, backupId);
    fs.mkdirSync(targetDir, { recursive: true });

    const contentCopy = path.join(targetDir, 'content');
    copyDirRecursive(this.contentDir, contentCopy);

    const dbSnapshotPath = path.join(targetDir, 'atlas.sqlite');
    this.db.vacuumBackupTo(dbSnapshotPath);

    const manifest: BackupManifest = {
      version: '1.0.0',
      backupId,
      createdAt: new Date().toISOString(),
      files: collectFiles(targetDir, targetDir),
    };
    fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    return manifest;
  }

  public listBackups(): BackupManifest[] {
    if (!fs.existsSync(this.backupsDir)) return [];
    const dirs = fs.readdirSync(this.backupsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    const manifests: BackupManifest[] = [];
    for (const d of dirs) {
      const mp = path.join(this.backupsDir, d.name, 'manifest.json');
      if (fs.existsSync(mp)) {
        try {
          manifests.push(JSON.parse(fs.readFileSync(mp, 'utf8')) as BackupManifest);
        } catch {
          // ignore malformed folder
        }
      }
    }
    return manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public verifyBackup(backupId: string): { valid: boolean; errors: string[]; manifest?: BackupManifest; backupDir?: string } {
    let backupDir: string;
    try {
      backupDir = assertSafeRelativePath(this.backupsDir, backupId);
    } catch (err) {
      return { valid: false, errors: [err instanceof Error ? err.message : 'Invalid backup path'] };
    }
    const manifestPath = path.join(backupDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return { valid: false, errors: ['Missing manifest.json'] };
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;
    const errors: string[] = [];
    if (manifest.version !== '1.0.0') {
      errors.push(`Unsupported backup version: ${manifest.version}`);
    }
    for (const f of manifest.files) {
      let full: string;
      try {
        full = assertSafeRelativePath(backupDir, f.relativePath);
      } catch (err) {
        errors.push(`Unsafe path in manifest: ${f.relativePath}`);
        continue;
      }
      if (!fs.existsSync(full)) {
        errors.push(`Missing file in backup: ${f.relativePath}`);
        continue;
      }
      const actualHash = sha256File(full);
      if (actualHash !== f.sha256) {
        errors.push(`Checksum mismatch for ${f.relativePath}`);
      }
    }
    return { valid: errors.length === 0, errors, manifest, backupDir };
  }

  public restoreBackup(backupId: string): { restored: BackupManifest; safetyBackup: BackupManifest } {
    const check = this.verifyBackup(backupId);
    if (!check.valid || !check.backupDir || !check.manifest) {
      throw new Error(`Backup verification failed: ${check.errors.join('; ')}`);
    }

    // Preserve pre-restore state
    const safetyBackup = this.createBackup('pre-restore');

    const backupContent = path.join(check.backupDir, 'content');
    const backupDb = path.join(check.backupDir, 'atlas.sqlite');
    const safetyContent = path.join(this.backupsDir, safetyBackup.backupId, 'content');
    const safetyDb = path.join(this.backupsDir, safetyBackup.backupId, 'atlas.sqlite');

    // Replace content atomically within the same filesystem
    replaceDirectoryAtomically(backupContent, this.contentDir, copyDirRecursive);

    // Replace sqlite database safely with full rollback (DB + content) on failure
    this.db.close();
    try {
      for (const suffix of ['', '-wal', '-shm']) {
        const p = this.db.dbPath + suffix;
        if (fs.existsSync(p)) fs.rmSync(p, { force: true });
      }
      fs.copyFileSync(backupDb, this.db.dbPath);
    } catch (err) {
      try {
        for (const suffix of ['', '-wal', '-shm']) {
          const p = this.db.dbPath + suffix;
          if (fs.existsSync(p)) fs.rmSync(p, { force: true });
        }
        if (fs.existsSync(safetyDb)) {
          fs.copyFileSync(safetyDb, this.db.dbPath);
        }
      } catch {
        // Best-effort restore of safety DB
      }
      try {
        if (fs.existsSync(safetyContent)) {
          replaceDirectoryAtomically(safetyContent, this.contentDir, copyDirRecursive);
        }
      } catch {
        // Best-effort restore of safety content
      }
      throw err;
    } finally {
      this.db.reopen();
    }

    return { restored: check.manifest, safetyBackup };
  }
}

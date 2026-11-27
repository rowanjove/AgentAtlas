import fs from 'node:fs';
import path from 'node:path';

const RETRYABLE_FS_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(from: string, to: string, maxAttempts = 5) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (attempt < maxAttempts - 1 && code && RETRYABLE_FS_CODES.has(code)) {
        sleepSync(35 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Atomically replaces `targetDir` with a copy of `sourceDir` by staging inside
 * `path.dirname(targetDir)` (same filesystem) and preserving a rollback backup
 * until the swap succeeds.
 */
export function replaceDirectoryAtomically(
  sourceDir: string,
  targetDir: string,
  copyFn: (src: string, dst: string) => void,
): void {
  const resolvedTarget = path.resolve(targetDir);
  const parentDir = path.dirname(resolvedTarget);
  const baseName = path.basename(resolvedTarget);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const stageDir = path.join(parentDir, `.${baseName}.stage-${stamp}`);
  const backupDir = path.join(parentDir, `.${baseName}.bak-${stamp}`);

  fs.mkdirSync(parentDir, { recursive: true });
  copyFn(sourceDir, stageDir);

  const hadTarget = fs.existsSync(resolvedTarget);
  try {
    if (hadTarget) {
      renameWithRetry(resolvedTarget, backupDir);
    }
    renameWithRetry(stageDir, resolvedTarget);
  } catch (err) {
    if (hadTarget && fs.existsSync(backupDir) && !fs.existsSync(resolvedTarget)) {
      try {
        renameWithRetry(backupDir, resolvedTarget);
      } catch {
        // Best effort rollback
      }
    }
    if (fs.existsSync(stageDir)) {
      fs.rmSync(stageDir, { recursive: true, force: true });
    }
    throw err;
  }

  if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

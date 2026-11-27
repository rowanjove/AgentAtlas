import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAtlasServer } from './app.js';

const repoRoot = (() => {
  if (typeof import.meta?.url === 'string' && import.meta.url.length > 0) {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  }
  const runtimeDir = typeof __dirname === 'string' ? __dirname : process.cwd();
  const portableRoot = path.resolve(runtimeDir, '..');
  if (fs.existsSync(path.join(portableRoot, 'web'))) {
    return portableRoot;
  }
  return path.resolve(runtimeDir, '../../..');
})();

const contentDir = process.env.AGENT_ATLAS_CONTENT_DIR || path.join(repoRoot, 'content');
const dataDir = process.env.AGENT_ATLAS_DATA_DIR || path.join(repoRoot, 'data');
const webDistDir = process.env.AGENT_ATLAS_WEB_DIST || path.join(repoRoot, 'apps', 'web', 'dist');
const port = Number(process.env.AGENT_ATLAS_PORT || 4317);
const host = '127.0.0.1';

async function main() {
  const ctx = await createAtlasServer({
    contentDir,
    dataDir,
    webDistDir,
    logger: process.env.AGENT_ATLAS_LOG === '1',
  });

  await ctx.app.listen({ port, host });
  console.log(`AgentAtlas local server listening at http://${host}:${port}`);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await ctx.app.close();
    } catch (err) {
      console.error('Error closing HTTP server:', err);
    }
    try {
      ctx.db.close();
    } catch (err) {
      console.error('Error closing database:', err);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
  if (process.env.AGENT_ATLAS_PARENT_PIPE === '1') {
    process.stdin.resume();
    process.stdin.once('end', () => {
      void shutdown();
    });
    process.stdin.once('close', () => {
      void shutdown();
    });
  }
}

main().catch((err) => {
  console.error('Failed to start AgentAtlas server:', err);
  process.exit(1);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { AtlasDatabase, tokenizeCJK } from '../apps/server/src/db/database.js';
import { createAtlasServer } from '../apps/server/src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Number(sorted[idx].toFixed(2));
}

function runSearchBenchmark(docCount: number) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `atlas-bench-${docCount}-`));
  const db = new AtlasDatabase(path.join(tmpDir, 'bench.sqlite'));

  const terms = [
    ['Agent 执行循环', 'Agent Loop', '模型决策、工具调用、环境观测与停止条件'],
    ['上下文工程', 'Context Engineering', '注意力预算、Context Rot 与结构化 Compaction'],
    ['混合检索与重排', 'Hybrid Search Rerank', 'FTS5 中文分词、BM25 与交叉重排'],
    ['持久检查点', 'Durable Checkpoint', '状态机中断、HITL 人工审批与幂等重试'],
    ['提示注入防御', 'Prompt Injection', '最小权限、沙箱边界与可信数据源隔离'],
  ];

  const tInsertStart = performance.now();
  db.db.exec('BEGIN IMMEDIATE');
  const insNode = db.db.prepare(`
    INSERT INTO idx_nodes (id, slug, title, en_title, aliases_json, type, domain, level, revision, estimated_minutes, summary, tags_json, source_ids_json, verified_at)
    VALUES (?, ?, ?, ?, ?, 'concept', 'agent-core', 'intermediate', 1, 15, ?, '["bench"]', '["anthropic.effective-agents"]', '2026-11-26')
  `);
  const insFts = db.db.prepare(`
    INSERT INTO idx_docs_fts (id, title, en_title, aliases, summary, tags, body, cjk_tokens)
    VALUES (?, ?, ?, ?, ?, 'bench', ?, ?)
  `);
  for (let i = 0; i < docCount; i++) {
    const [zh, en, bodyCore] = terms[i % terms.length];
    const id = `bench.node-${i}`;
    const title = `${zh} #${i}`;
    const enTitle = `${en} #${i}`;
    const body = `${bodyCore}。样本编号 ${i}，探讨 MCP 协议、循环收敛、检查点恢复与评估门禁。`;
    insNode.run(id, `bench-${i}`, title, enTitle, `["${en}","${zh}"]`, bodyCore);
    insFts.run(id, title, enTitle, `${en} ${zh}`, bodyCore, body, tokenizeCJK(`${title} ${enTitle} ${body}`));
  }
  db.db.exec('COMMIT');
  const insertMs = Number((performance.now() - tInsertStart).toFixed(1));

  const queries = ['Agent Loop', '循环', '上下文', '检查点', 'MCP', '提示注入', 'Rerank', '审批'];
  const latencies: number[] = [];
  for (let round = 0; round < 5; round++) {
    for (const q of queries) {
      const t0 = performance.now();
      const hits = db.searchNodes({ q, limit: 20 });
      const dt = performance.now() - t0;
      latencies.push(dt);
      if (hits.length === 0) throw new Error(`Benchmark query '${q}' returned 0 hits at scale=${docCount}`);
    }
  }
  latencies.sort((a, b) => a - b);

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  return {
    docCount,
    insertMs,
    queriesRun: latencies.length,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    maxMs: percentile(latencies, 100),
  };
}

async function main() {
  const tBoot0 = performance.now();
  const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-srv-bench-'));
  const ctx = await createAtlasServer({
    contentDir: path.join(repoRoot, 'content'),
    dataDir: tempData,
    webDistDir: path.join(repoRoot, 'apps', 'web', 'dist'),
  });
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const bootMs = Number((performance.now() - tBoot0).toFixed(1));
  const addr = ctx.app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 4317;

  const tReq0 = performance.now();
  const overviewRes = await fetch(`http://127.0.0.1:${port}/api/overview`);
  await overviewRes.json();
  const overviewApiMs = Number((performance.now() - tReq0).toFixed(2));
  const idleRssMb = Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1));

  await ctx.app.close();
  ctx.db.close();
  fs.rmSync(tempData, { recursive: true, force: true });

  const bench1k = runSearchBenchmark(1000);
  const bench10k = runSearchBenchmark(10000);

  const report = {
    measuredAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
    },
    server: {
      bootAndIndexMs: bootMs,
      overviewApiColdMs: overviewApiMs,
      rssMb: idleRssMb,
    },
    fts5Search1k: bench1k,
    fts5Search10k: bench10k,
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

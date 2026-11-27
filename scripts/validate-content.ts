import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContentDirectory, validateContentBundle } from '../packages/content/src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentDir = path.resolve(__dirname, '../content');

const bundle = compileContentDirectory(contentDir);
const report = validateContentBundle(bundle);

console.log('=== AgentAtlas Content Validation Report ===');
console.log('Stats:', JSON.stringify(report.stats));
console.log('Valid:', report.valid);

if (report.issues.length > 0) {
  for (const issue of report.issues) {
    console.log(`[${issue.severity.toUpperCase()}] ${issue.code} (${issue.file ?? issue.field ?? '-'}): ${issue.message}`);
  }
}

if (!report.valid) {
  process.exit(1);
}

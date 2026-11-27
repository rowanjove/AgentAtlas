import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

function findLocalBrowser(): string | undefined {
  const candidates = [
    process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1254', 'chrome-win64', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean) as string[];
  return candidates.find((p) => fs.existsSync(p));
}

const executablePath = findLocalBrowser();

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4399',
    viewport: { width: 1366, height: 768 },
    colorScheme: 'light',
    trace: 'retain-on-failure',
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  webServer: {
    command: 'node apps/server/dist/index.js',
    url: 'http://127.0.0.1:4399/api/health',
    reuseExistingServer: false,
    timeout: 20_000,
    env: {
      AGENT_ATLAS_PORT: '4399',
      AGENT_ATLAS_DATA_DIR: './data/e2e-test',
    },
  },
});

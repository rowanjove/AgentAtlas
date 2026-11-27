import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SCREENSHOT_DIR = path.resolve('docs/screenshots');
const AFTER_DIR = path.resolve('docs/screenshots/after');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(AFTER_DIR, { recursive: true });

async function saveShot(page: import('@playwright/test').Page, filename: string) {
  const mainPath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: mainPath });
  fs.copyFileSync(mainPath, path.join(AFTER_DIR, filename));
}

test.describe('AgentAtlas End-to-End Acceptance (AC01-AC14 + Visual Inspection)', () => {
  test('AC01-AC07 & UI Inspection: Full offline study loop, cross-path sync, search, labs & screenshots', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // 1. Cold load Overview (AC01 & AC12) + verify CSP & security headers
    const t0 = Date.now();
    const homeResp = await page.goto('/');
    expect(homeResp?.headers()['x-content-type-options']).toBe('nosniff');
    expect(homeResp?.headers()['x-frame-options']).toBe('DENY');
    expect(homeResp?.headers()['content-security-policy']).toContain("default-src 'self'");
    await expect(page.getByText('AI Agent Engineering 研究与学习工作台')).toBeVisible();
    const coldLoadMs = Date.now() - t0;
    expect(coldLoadMs).toBeLessThan(3500);
    const brandIconLoaded = await page.evaluate(() => {
      const img = document.querySelector('img[src="/brand-icon.png"]') as HTMLImageElement | null;
      return Boolean(img && img.complete && img.naturalWidth > 0);
    });
    expect(brandIconLoaded).toBe(true);
    await saveShot(page, '01-overview-light-1366x768.png');

    // Verify Light Theme background (#F7F8FA -> rgb(247, 248, 250)) and zero horizontal overflow at 1366x768
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(lightBg).toBe('rgb(247, 248, 250)');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);

    // Sidebar should default expanded (>=180px)
    const navLocator = page.locator('nav[aria-label="主导航"]');
    const homeNavBox = await navLocator.boundingBox();
    expect(homeNavBox?.width ?? 0).toBeGreaterThanOrEqual(180);

    // AC11: Security check via live HTTP requests (reject missing CSRF token & bad Origin)
    const unauthRes = await page.request.put('/api/progress/agent.loop', {
      data: { status: 'read' },
    });
    expect(unauthRes.status()).toBe(403);
    const sessionRes = await page.request.get('/api/session');
    const { csrfToken } = await sessionRes.json();
    const badOriginRes = await page.request.put('/api/progress/agent.loop', {
      headers: { Origin: 'https://evil.example.com', 'X-Atlas-Token': csrfToken },
      data: { status: 'read' },
    });
    expect(badOriginRes.status()).toBe(403);

    // 2. Bilingual Ctrl+K Search (AC04)
    await page.keyboard.press('Control+k');
    const searchBox = page.getByPlaceholder(/搜索知识节点/);
    await expect(searchBox).toBeVisible();
    await searchBox.fill('循环');
    await expect(page.getByText('Agent 执行循环').first()).toBeVisible();
    await page.keyboard.press('Escape');

    // 3. Learning Path Curriculum List (default) + Dependency Graph & Drawer (AC02, AC05)
    await page.goto('/learn/agent-foundations');
    await expect(page.getByText('Agent 执行循环').first()).toBeVisible({ timeout: 10000 });
    expect((await navLocator.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(180);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await saveShot(page, '02-learning-roadmap-light.png');

    await page.getByRole('tab', { name: '依赖关系图' }).click();
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('tab', { name: '课程清单' }).click();

    // 3b. Verify fixed sidebar persistence & Mermaid native SVG rendering on llm.tokens-context
    await page.goto('/library/llm.tokens-context');
    await expect(page.getByRole('heading', { name: /Token/ })).toBeVisible();
    expect((await navLocator.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(180);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

    const tokenSvg = page.locator('svg[id^="mmd_"]').first();
    await expect(tokenSvg).toBeVisible({ timeout: 10000 });
    const mermaidMetrics = await tokenSvg.evaluate((svg) => {
      const foreignCount = svg.querySelectorAll('foreignObject').length;
      const svgRect = svg.getBoundingClientRect();
      const outerRect = svg.closest('.atlas-mermaid')!.getBoundingClientRect();
      const nodeBoxes = [...svg.querySelectorAll('.node')].map((n) => {
        const r = n.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
      });
      return {
        foreignCount,
        w: svgRect.width,
        h: svgRect.height,
        outer: { left: outerRect.left, top: outerRect.top, right: outerRect.right, bottom: outerRect.bottom },
        nodeBoxes,
      };
    });
    expect(mermaidMetrics.foreignCount).toBe(0);
    expect(mermaidMetrics.w).toBeGreaterThanOrEqual(500);
    expect(mermaidMetrics.h).toBeGreaterThanOrEqual(120);
    expect(mermaidMetrics.nodeBoxes.length).toBeGreaterThan(0);
    for (const nb of mermaidMetrics.nodeBoxes) {
      expect(nb.w).toBeGreaterThanOrEqual(55);
      expect(nb.h).toBeGreaterThanOrEqual(24);
      expect(nb.x).toBeGreaterThanOrEqual(mermaidMetrics.outer.left - 1);
      expect(nb.right).toBeLessThanOrEqual(mermaidMetrics.outer.right + 1);
      expect(nb.bottom).toBeLessThanOrEqual(mermaidMetrics.outer.bottom + 1);
    }

    // Clicking Zoom In must actually scale internal SVG nodes, not just the outer box
    const initialNodeBox = mermaidMetrics.nodeBoxes[0];
    await page.getByRole('button', { name: '放大图表' }).first().click();
    await page.getByRole('button', { name: '放大图表' }).first().click();
    const zoomedNodeBox = await tokenSvg.locator('.node').first().boundingBox();
    expect(zoomedNodeBox).not.toBeNull();
    expect(zoomedNodeBox!.width).toBeGreaterThan(initialNodeBox.w * 1.2);
    expect(zoomedNodeBox!.height).toBeGreaterThan(initialNodeBox.h * 1.2);
    await page.getByRole('button', { name: '适配' }).first().click();

    // Verify right-click contextmenu is globally blocked
    const ctxMenuResults = await page.evaluate(() => {
      const ev1 = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
      const resBody = document.body.dispatchEvent(ev1);
      const svgEl = document.querySelector('svg[id^="mmd_"]');
      const ev2 = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
      const resSvg = svgEl ? svgEl.dispatchEvent(ev2) : false;
      return { resBody, resSvg, def1: ev1.defaultPrevented, def2: ev2.defaultPrevented };
    });
    expect(ctxMenuResults.resBody).toBe(false);
    expect(ctxMenuResults.resSvg).toBe(false);
    expect(ctxMenuResults.def1).toBe(true);
    expect(ctxMenuResults.def2).toBe(true);

    // Verify manual sidebar toggle sticks across SPA route navigation and restores to expanded
    await page.locator('button[aria-label="收起侧栏"]').click();
    await expect(async () => {
      expect((await navLocator.boundingBox())?.width ?? 999).toBeLessThanOrEqual(64);
    }).toPass();
    await navLocator.getByRole('link', { name: '首页' }).click();
    await expect(page.getByText('AI Agent Engineering 研究与学习工作台')).toBeVisible();
    await expect(async () => {
      expect((await navLocator.boundingBox())?.width ?? 999).toBeLessThanOrEqual(64);
    }).toPass();
    await page.locator('button[aria-label="展开侧栏"]').click();
    await expect(async () => {
      expect((await navLocator.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(180);
    }).toPass();

    // 4. Library clean editorial reader, Mermaid diagram SVG, syntax highlight, inline glossary, collapsible drawer, status update, quiz, note, bookmark & persistence across reload (AC02, AC03, AC07)
    await page.goto('/library/agent.loop');
    await expect(page.getByRole('heading', { name: 'Agent 执行循环' })).toBeVisible();
    await expect(page.locator('svg[id^="mmd_"]').first()).toBeVisible({ timeout: 10000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await expect(page.locator('.hljs-keyword').first()).toBeVisible();
    await expect(page.locator('article math').first()).toBeVisible();
    await expect(page.locator('article a[href="/library/agent.stop-conditions"]').first()).toBeVisible();
    await expect(page.getByText('本篇核心术语速查')).toBeVisible();
    await expect(page.getByLabel('上下篇导航')).toBeVisible();

    const missingAssetRes = await page.request.get('/assets/nonexistent-chunk.js');
    expect(missingAssetRes.status()).toBe(404);

    // Verify 来源与关联 drawer opens without duplicate node links, then close for clean default screenshot
    await page.getByRole('button', { name: /^来源与关联/ }).click();
    await expect(page.getByText('关联知识（已去重）')).toBeVisible();
    const relatedHrefs = await page
      .locator('aside[aria-label="参考来源与关联知识"]')
      .locator('a[href^="/library/"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('href')));
    expect(relatedHrefs.length).toBeGreaterThan(0);
    expect(new Set(relatedHrefs).size).toBe(relatedHrefs.length);
    await page.getByRole('button', { name: /^来源与关联/ }).click();

    await page.getByRole('button', { name: '标记已阅读' }).click();
    await page.getByRole('button', { name: '收藏' }).click();
    await page.getByPlaceholder(/记录工程判断/).fill('E2E 持久化测试笔记：必须设置 maxSteps');
    await page.getByRole('button', { name: '保存笔记到本地' }).click();
    await expect(page.getByText('E2E 持久化测试笔记：必须设置 maxSteps')).toBeVisible();
    await saveShot(page, '03-library-reader-light.png');

    // Answer cognitive quiz on agent.loop
    await page.getByText('实际执行文件读写/HTTP 请求、记录真实异常并把结果写回消息历史').click();
    await page.getByRole('button', { name: '提交判断' }).click();
    await expect(page.getByText(/节点已更新为「已自测」/)).toBeVisible();

    // Reload to verify SQLite persistence (AC03)
    await page.reload();
    await expect(page.locator('article').getByText('已自测').first()).toBeVisible();
    await expect(page.getByText('E2E 持久化测试笔记：必须设置 maxSteps')).toBeVisible();

    // Verify shared progress in another learning path (AC02)
    await page.goto('/learn/agent-foundations');
    await expect(page.locator('main').getByText('已自测').first()).toBeVisible();

    // 5. Global Knowledge Graph
    await page.goto('/library/graph');
    await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 10000 });
    await saveShot(page, '04-global-graph-light.png');

    // 6. Playground Deterministic Simulation + Fault Injection + State Diff + Zero Overlap (AC06)
    await page.goto('/lab/agent-loop');
    await expect(page.getByText(/确定性教学模拟/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await page.getByRole('button', { name: /工具执行超时 \(ETIMEDOUT\)/ }).click();
    await expect(page.getByText(/ETIMEDOUT|执行超时/).first()).toBeVisible();
    await page.getByRole('button', { name: '单步' }).click();
    await expect(page.getByText('本步 State 变更 (Diff)')).toBeVisible();
    await expect(page.getByText('tool_calls').first()).toBeVisible();

    const controlsBox = await page.locator('.react-flow__controls').boundingBox();
    const timelineHeaderBox = await page.getByText('执行步骤过程').boundingBox();
    expect(controlsBox).not.toBeNull();
    expect(timelineHeaderBox).not.toBeNull();
    if (controlsBox && timelineHeaderBox) {
      expect(controlsBox.y + controlsBox.height).toBeLessThanOrEqual(timelineHeaderBox.y);
    }

    await saveShot(page, '05-playground-lab-light.png');

    // 7. Ecosystem Comparison Matrix
    await page.goto('/ecosystem');
    await expect(page.getByText(/并列技术对比矩阵/)).toBeVisible();
    await saveShot(page, '06-ecosystem-light.png');

    // 8. Casebook + Mermaid Fullscreen containment & zero-clipping verification
    await page.goto('/casebook/case.local-knowledge-assistant');
    await expect(page.getByText('采用架构方案')).toBeVisible();
    const caseSvg = page.locator('svg[id^="mmd_"]').first();
    await expect(caseSvg).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: '全屏大图查看' }).first().click();
    const fsDialog = page.locator('dialog[aria-label="Mermaid 图解全屏查看"]');
    await expect(fsDialog).toBeVisible();
    const fsSvg = fsDialog.locator('svg[id^="mmd_"]').first();
    await expect(fsSvg).toBeVisible();
    await expect(async () => {
      const metrics = await fsSvg.evaluate((svg) => {
        const vp = svg.closest('.atlas-mermaid')!.getBoundingClientRect();
        const nodes = [...svg.querySelectorAll('.node')].map((n) => {
          const r = n.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        });
        return { vp: { left: vp.left, right: vp.right, top: vp.top, bottom: vp.bottom }, nodes };
      });
      expect(metrics.nodes.length).toBeGreaterThanOrEqual(5);
      for (const n of metrics.nodes) {
        expect(n.left).toBeGreaterThanOrEqual(metrics.vp.left - 1);
        expect(n.right).toBeLessThanOrEqual(metrics.vp.right + 1);
        expect(n.top).toBeGreaterThanOrEqual(metrics.vp.top - 1);
        expect(n.bottom).toBeLessThanOrEqual(metrics.vp.bottom + 1);
      }
    }).toPass();
    await saveShot(page, '14-mermaid-fullscreen-light.png');
    await page.getByRole('button', { name: '退出全屏' }).click();
    await saveShot(page, '07-casebook-light.png');

    // Verify sharp minimum font size on navigation items (>= 14px)
    const navFontPx = await navLocator
      .getByRole('link', { name: '首页' })
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(navFontPx).toBeGreaterThanOrEqual(14);

    // 9. My Learning
    await page.goto('/my-learning');
    await expect(page.getByText('个人学习中心 My Learning')).toBeVisible();
    await saveShot(page, '08-my-learning-light.png');

    // 10. Content Management & Import Security Blocking (AC09)
    await page.goto('/content');
    await expect(page.getByText(/内容库全部校验通过/)).toBeVisible();
    await page.getByRole('tab', { name: '导入与安全预览' }).click();
    await page
      .getByPlaceholder(/粘贴带 YAML frontmatter/)
      .fill(
        '---\nid: evil\nslug: evil\ntitle: Evil\nenTitle: Evil\ntype: concept\ndomain: llm\nlevel: beginner\nsummary: x\nobjectives: [x]\nsourceIds: [anthropic.effective-agents]\nverifiedAt: "2026-11-26"\n---\n<script>alert(1)</script>',
      );
    await page.getByRole('button', { name: '运行安全与差异预览' }).click();
    await expect(page.getByText(/UNSAFE_SCRIPT_TAG/)).toBeVisible();
    await saveShot(page, '09-content-mgmt-light.png');

    // Verify Obsidian ZIP archive download endpoint (P2)
    const zipRes = await page.request.get('/api/content/export/obsidian.zip');
    expect(zipRes.status()).toBe(200);
    expect(zipRes.headers()['content-type']).toBe('application/zip');

    // 11. AI Tutor Offline Fallback Mode + disclosed nodes (AC14)
    await page.goto('/tutor');
    await page.getByPlaceholder(/输入架构疑问/).fill('Workflow 与 Agent 怎么选？');
    await page.getByRole('button', { name: '发送' }).click();
    await expect(page.getByText(/本地知识库检索综述/)).toBeVisible();
    await expect(page.getByText(/本地检索参考节点/)).toBeVisible();
    await saveShot(page, '10-tutor-offline-light.png');

    // 12. Settings + Dark Mode Screenshot + Backup creation (AC10, AC12)
    await page.goto('/settings');
    await page.getByLabel('配色主题').selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: '创建全量备份' }).click();
    await expect(page.getByText(/已创建一致性备份/).first()).toBeVisible();
    await saveShot(page, '11-settings-dark-1366x768.png');

    // Capture Dark Mode Overview and verify new dark canvas (#111317 -> rgb(17, 19, 23)) and zero overflow
    await page.goto('/');
    await expect(page.getByText('AI Agent Engineering 研究与学习工作台')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(darkBg).toBe('rgb(17, 19, 23)');
    const darkOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(darkOverflow).toBe(false);
    await saveShot(page, '12-overview-dark-1366x768.png');

    expect(pageErrors).toEqual([]);
  });

  test('Responsive & High-DPI Layout Audit (1920x1080, 2560x1440, 125% & 150% DPI)', async ({ browser }) => {
    const viewports = [
      { name: '1920x1080-1x', width: 1920, height: 1080, dpr: 1, shot: '13-overview-light-1920x1080.png' },
      { name: '2560x1440-1x', width: 2560, height: 1440, dpr: 1, shot: null },
      { name: '1366x768-1.25x', width: 1366, height: 768, dpr: 1.25, shot: null },
      { name: '1536x864-1.5x', width: 1536, height: 864, dpr: 1.5, shot: null },
    ];

    for (const vp of viewports) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.dpr,
      });
      const p = await ctx.newPage();
      const errs: string[] = [];
      p.on('pageerror', (e) => errs.push(e.message));

      for (const route of ['/', '/learn/agent-foundations', '/library/agent.loop', '/lab/agent-loop', '/ecosystem', '/settings']) {
        await p.goto(route);
        await p.waitForLoadState('networkidle');
        const hasOverflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        expect(hasOverflow, `${vp.name} overflow on ${route}`).toBe(false);
      }

      if (vp.shot) {
        await p.goto('/');
        await p.waitForLoadState('networkidle');
        await saveShot(p, vp.shot);
      }

      expect(errs, `pageerrors on ${vp.name}`).toEqual([]);
      await ctx.close();
    }
  });
});

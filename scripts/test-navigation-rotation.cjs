const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  try {
    for (const hasTouch of [true, false]) {
      const context = await browser.newContext({ hasTouch });
      const page = await context.newPage();
      const css = ['globals', 'ui-refinement', 'mobile-ui', 'account-menu', 'planner-resize', 'wide-ui', 'navigation-viewport'].map(name => fs.readFileSync(path.join(__dirname, '../app', name + '.css'), 'utf8')).join('\n');
      await page.setContent(`<style>${css}</style><div class="workspace managed-workspace"><aside class="sidebar"><div class="logo">Logo</div><nav><div class="sidebar-nav-group open"><button class="sidebar-nav-group-title">Grupo</button><div class="sidebar-nav-items">${Array.from({length: 8}, (_, i) => `<div class="sidebar-nav-item-wrap tooltip-trigger" style="width:100%"><button><svg></svg><span>Seção ${i}</span></button><span class="tooltip-bubble" role="tooltip">Seção ${i}</span></div>`).join('')}</div></div></nav></aside><main class="dashboard"><h1>Conteúdo</h1><div style="height:1200px">Último conteúdo</div><button id="last">Última ação</button></main></div>`);
      for (const collapsed of [false, true]) {
        await page.locator('.workspace').evaluate((el, value) => el.classList.toggle('sidebar-collapsed', value), collapsed);
        for (const [width, height] of [[390,844],[844,390],[932,430],[1024,600],[390,844],[1440,900]]) {
          await page.setViewportSize({width, height});
          await page.waitForTimeout(250);
          const compact = width <= 860 || (hasTouch && width <= 1024 && height <= 600);
          const sidebar = await page.locator('.sidebar').boundingBox();
          assert(sidebar);
          if (compact) {
            assert(sidebar.height <= 69, `Menu covers screen at ${width}x${height}`);
            assert(Math.abs(sidebar.y + sidebar.height - height) < 1, 'Menu must stay at bottom');
            await page.locator('#last').scrollIntoViewIfNeeded();
            const last = await page.locator('#last').boundingBox();
            assert(last.y + last.height <= sidebar.y, 'Last action hidden behind menu');
            const nav = page.locator('.sidebar nav');
            await nav.evaluate(el => el.scrollLeft = el.scrollWidth + 10000);
            const bounds = await nav.evaluate(el => ({ left: el.scrollLeft, max: el.scrollWidth - el.clientWidth, overscroll: getComputedStyle(el).overscrollBehaviorX }));
            assert(bounds.left <= bounds.max && bounds.left >= 0, 'Scroll exceeds navigation bounds');
            assert.equal(bounds.overscroll, 'none', 'Elastic overscroll must be disabled');
            assert.equal(await page.locator('.tooltip-bubble').first().isVisible(), false, 'No duplicate tooltip on mobile');
            const end = await page.locator('.sidebar-nav-items button').last().boundingBox();
            assert(end.x >= 0 && end.x + end.width <= width, 'Last section inaccessible');
            await nav.evaluate(el => el.scrollLeft = -10000);
            assert.equal(await nav.evaluate(el => el.scrollLeft), 0, 'Scroll exceeds first section');
            const first = await page.locator('.sidebar-nav-items button').first().boundingBox();
            assert(first.x >= 0 && first.x + first.width <= width, 'First section inaccessible');
          } else {
            assert(sidebar.width < width / 2, 'Desktop sidebar covers content');
          }
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page overflows');
        }
      }
      await context.close();
    }
    console.log('PASS: 24 rotation/collapse/touch scenarios; content and all menu sections accessible.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

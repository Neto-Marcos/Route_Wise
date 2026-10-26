const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    await page.route('http://print.local/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<div id="report" class="planner-print-sheet"><h1>Romaneio</h1><p>Pedido 123 — 1,234 m³</p></div><button id="print">Imprimir</button>' }));
    await page.goto('http://print.local/');
    const code = ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../lib/print-document.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 } }).outputText.replace('export async function', 'async function');
    await page.addScriptTag({ content: code });
    await page.evaluate(() => {
      window.printCalls = 0;
      window.openCalled = false;
      window.open = () => { window.openCalled = true; return null; };
      window.print = () => { window.printCalls = (window.printCalls || 0) + 1; };
      document.querySelector('#print').onclick = () => { window.done = printElement('report', 'Romaneio'); };
    });
    await page.click('#print');
    await page.evaluate(() => window.done);
    assert.equal(await page.evaluate(() => window.openCalled), false, 'Must not call window.open on mobile');
    assert.equal(await page.evaluate(() => window.printCalls), 1, 'Must invoke native window.print()');
    assert.equal(await page.evaluate(() => document.title), 'Romaneio', 'Must update title for PDF naming');
    assert.equal(await page.evaluate(() => document.body.classList.contains('routewise-portal-active')), true);
    assert.equal(await page.locator('#routewise-print-portal #report').textContent(), 'RomaneioPedido 123 — 1,234 m³');
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    assert.equal(await page.evaluate(() => document.body.classList.contains('routewise-portal-active')), false);
    assert.equal(await page.locator('#routewise-print-portal').count(), 0);
    const missing = await page.evaluate(() => printElement('missing', 'Teste').catch(e => e.message));
    assert.match(missing, /não encontrado/);
    console.log('PASS: native mobile print portal, zero popups, title update, and clean afterprint recovery.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

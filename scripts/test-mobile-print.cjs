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
      const open = window.open.bind(window);
      window.open = (...args) => {
        const win = open(...args);
        if (win) win.print = () => { win.printCalls = (win.printCalls || 0) + 1; };
        return win;
      };
      document.querySelector('#print').onclick = () => { window.done = printElement('report', 'Romaneio'); };
    });
    const pendingPopup = page.waitForEvent('popup');
    await page.click('#print');
    const popup = await pendingPopup;
    await page.evaluate(() => window.done);
    assert.equal(await popup.locator('#report').textContent(), 'RomaneioPedido 123 — 1,234 m³');
    assert.equal(await popup.evaluate(() => window.printCalls), 1);
    await popup.click('#print-preview-button');
    assert.equal(await popup.evaluate(() => window.printCalls), 2);
    await popup.emulateMedia({ media: 'print' });
    assert.equal(await popup.locator('.print-preview-toolbar').isVisible(), false);
    assert.equal(await popup.locator('#report').isVisible(), true);
    await popup.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    assert.equal(popup.isClosed(), false);
    await page.evaluate(() => { window.open = () => null; });
    const error = await page.evaluate(() => printElement('report', 'Teste').catch(e => e.message));
    assert.match(error, /Permita abrir novas abas/);
    const missing = await page.evaluate(() => printElement('missing', 'Teste').catch(e => e.message));
    assert.match(missing, /não encontrado/);
    console.log('PASS: visible mobile document, automatic print call, retry, print CSS, retained preview, blocked popup and missing document. Native printer dialog requires a physical device.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

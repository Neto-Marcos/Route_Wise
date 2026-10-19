// Real compiled UI, synthetic read-only API fixtures. Never use against production.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const version = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../package.json'))).version;
const base = process.env.RELEASE_TEST_URL || 'http://127.0.0.1:3136';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error('Local server required');
const route = { id: 'test-route', name: 'Rota de teste 1.0.0', route_date: '2026-10-19', status: 'draft', deliveries: 1, delivered: 0, stops: [
  { id: 'base', position: 0, name: 'Base', address: 'Campina Grande/PB', lat: -7.23, lng: -35.88, is_origin: true },
  { id: 'stop', position: 1, name: 'Cliente teste', address: 'João Pessoa/PB', lat: -7.12, lng: -34.84, is_origin: false, boxes: 10, volume_m3: 1.234, order_ids: ['12345'] },
] };
(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
    await context.route('**/*', async request => {
      const url = new URL(request.request().url());
      if (url.origin !== base) return request.abort();
      if (!url.pathname.startsWith('/api/')) return request.continue();
      if(url.pathname === '/api/telemetry/client-error') return request.fulfill({status:204,body:''});
      assert.equal(request.request().method(), 'GET', 'Smoke test must not write data');
      let data = [];
      if (url.pathname === '/api/session/me') data = { authenticated: true, role: 'dispatcher', userRole: 'admin', companyId: 'demo', companyName: 'Empresa teste', companyCode: '281', userName: 'Teste' };
      if (url.pathname === '/api/routes') data = [route];
      if (url.pathname === '/api/routes/test-route') data = route;
      if (url.pathname.startsWith('/api/osrm/')) data = { code: 'Ok', routes: [{ distance: 120000, duration: 7200, geometry: { coordinates: [[-35.88,-7.23],[-34.84,-7.12]] } }] };
      if (url.pathname === '/api/notifications/subscribe') data = { enabled: false, publicKey: null };
      if (/analytics|dashboard/.test(url.pathname)) return request.fulfill({ status: 503, json: { error: 'Fixture sem dados' } });
      return request.fulfill({ json: data });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let navigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    await page.goto(base);
    const nav = page.locator('.sidebar nav');
    await nav.waitFor();
    await page.getByRole('button', { name: 'Rotas', exact: true }).click();
    await page.locator('button[title="Adicionar, remover ou reorganizar cidades"]').first().click();
    await page.locator('#planner-print-document').waitFor({ state: 'attached' });
    const stopsBefore = await page.locator('.stop-item-name').allTextContents();
    assert(stopsBefore.length >= 2);
    const navigationBefore = navigations;
    await page.evaluate(() => {
      for (const type of ['touchstart', 'touchmove', 'touchend']) {
        const y = type === 'touchstart' ? 100 : 450;
        const touch = new Touch({ identifier: 1, target: document.body, clientX: 120, clientY: y });
        window.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [touch], changedTouches: [touch] }));
      }
    });
    await page.waitForTimeout(1000);
    assert.equal(navigations, navigationBefore, 'Pull gesture unexpectedly reloaded the app');
    for (const [width,height] of [[390,844],[932,430],[844,390],[390,844]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(300);
      const box = await page.locator('.sidebar').boundingBox();
      assert(box.height <= 69 && Math.abs(box.y + box.height - height) < 1, 'Navigation covers content');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal page overflow');
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY), 'none');
      assert.equal(await page.locator('.sidebar-nav-items button[title]').count(), 0);
      await nav.evaluate(el => el.scrollLeft = 100000);
      const last = await page.locator('.sidebar-nav-items button').last().boundingBox();
      assert(last.x >= 0 && last.x + last.width <= width + 1, 'Cannot reach last section');
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.sidebar nav')).overscrollBehaviorX), 'none');
    }
    assert.deepEqual(await page.locator('.stop-item-name').allTextContents(), stopsBefore);
    await page.locator('.account-menu > summary').click();
    assert(await page.getByText('Criar Rota · versão '+version).isVisible());
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const original = window.open.bind(window);
      window.open = (...args) => { const win = original(...args); if (win) win.print = () => { win.printCalls = (win.printCalls || 0) + 1; }; return win; };
    });
    const popupPending = page.waitForEvent('popup');
    await page.locator('button.btn-print').click();
    const popup = await popupPending;
    await popup.getByRole('button', { name: 'Imprimir / Salvar PDF' }).waitFor();
    assert((await popup.locator('#planner-print-document').textContent()).includes('12345'));
    await popup.waitForFunction(() => window.printCalls >= 1);
    await popup.getByRole('button', { name: 'Imprimir / Salvar PDF' }).click();
    assert.equal(await popup.evaluate(() => window.printCalls), 2);
    await popup.emulateMedia({ media: 'print' });
    assert(await popup.locator('#planner-print-document').isVisible());
    assert(!(await popup.locator('.print-preview-toolbar').isVisible()));
    assert.deepEqual(errors, []);
    console.log('PASS: compiled planner route, retained stops after pull/rotation, bottom navigation bounds, no duplicate labels, account version and actual Print button opens printable order document. Native print is stubbed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

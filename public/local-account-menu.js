// Disclosure adapter for the recovered build. Existing React controls keep
// ownership of actions: we invoke them without moving/reparenting their DOM.
(() => {
  function setup() {
    const header = document.querySelector('.managed-workspace > .dashboard > header');
    if (!header || header.querySelector('.account-menu')) return;
    const buttons = [...header.querySelectorAll('button')];
    const theme = header.querySelector('.theme-toggle-btn');
    const exit = buttons.find(b => b.textContent.trim() === 'Sair');
    const toolbar = theme?.parentElement;
    const password = document.querySelector('.sidebar-footer-actions .sidebar-btn-action') || [...document.querySelectorAll('.sidebar-footer-actions button')].find(b => /senha/i.test(b.textContent));
    const company = header.querySelector('.company-switcher');
    if (toolbar && toolbar !== header) toolbar.setAttribute('data-account-toolbar', '');
    for (const element of [theme, exit, company]) element?.setAttribute('data-account-original', '');
    const details = document.createElement('details');
    details.className = 'account-menu';
    details.innerHTML = `<summary aria-label="Abrir conta e configurações" title="Minha conta e configurações"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg><span>Minha conta</span></summary><div class="account-menu-panel"><h2>Minha conta</h2><p class="account-identity"><strong>Usuário conectado</strong><span></span></p><button type="button" data-action="password">Alterar senha</button><h2>Configurações</h2><div class="account-theme-row"><span>Aparência</span><button type="button" data-action="theme"></button></div><button type="button" data-action="notifications">Notificações e alertas</button><div class="account-company-settings"></div><button type="button" class="account-signout" data-action="exit">Sair da conta</button></div>`;
    if (!password) details.querySelector('[data-action="password"]').remove();
    const notifications = [...document.querySelectorAll('.sidebar nav button')].find(b => b.textContent.trim() === 'Central operacional');
    if (!notifications) details.querySelector('[data-action="notifications"]').remove();
    const maps = [...document.querySelectorAll('.sidebar nav button')].find(b => b.textContent.trim() === 'Mapa de rastreio') || [...document.querySelectorAll('.sidebar nav button')].find(b => b.textContent.trim() === 'Planejar rota');
    if (maps) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.action = 'maps'; button.textContent = 'Mapas e localização';
      details.querySelector('.account-company-settings').before(button);
    }
    const permissionDetails = document.createElement('details'); permissionDetails.className = 'account-permissions';
    permissionDetails.innerHTML = '<summary>Permissões do navegador</summary><p data-permission-status>Consultando permissões…</p><p>Para alterar, use as permissões do site na barra de endereço.</p>';
    details.querySelector('.account-company-settings').before(permissionDetails);
    permissionDetails.addEventListener('toggle', async () => {
      if (!permissionDetails.open) return;
      const labels = { granted: 'permitida', denied: 'bloqueada', prompt: 'solicitar ao usar', default: 'solicitar ao usar' };
      let location = 'consulte o navegador';
      try { location = labels[(await navigator.permissions.query({ name: 'geolocation' })).state]; } catch {}
      const notification = typeof Notification === 'undefined' ? 'indisponíveis' : labels[Notification.permission];
      permissionDetails.querySelector('[data-permission-status]').textContent = `Localização: ${location}. Notificações: ${notification}.`;
    });
    const summary = details.querySelector('summary');
    const close = () => { details.open = false; summary.focus(); };
    details.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
    document.addEventListener('pointerdown', e => { if (!details.contains(e.target)) details.open = false; });
    details.addEventListener('click', e => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      if (action === 'theme') { theme?.click(); updateTheme(); return; }
      close();
      if (action === 'password') password?.click();
      if (action === 'exit') exit?.click();
      if (action === 'notifications') notifications?.click();
      if (action === 'maps') maps?.click();
    });
    function updateTheme() {
      const dark = document.documentElement.dataset.theme === 'dark';
      const target = details.querySelector('[data-action="theme"]');
      const label = dark ? 'Usar modo claro' : 'Usar modo escuro';
      if (target.textContent !== label) target.textContent = label;
    }
    details.addEventListener('toggle', async () => {
      if (!details.open) return;
      updateTheme();
      try {
        const response = await fetch('/api/session/me');
        if (response.ok) {
          const session = await response.json();
          details.querySelector('.account-identity strong').textContent = session.userName || 'Usuário conectado';
          details.querySelector('.account-identity span').textContent = session.companyName || '';
        }
      } catch { /* The menu and logout remain available offline. */ }
      const settings = details.querySelector('.account-company-settings');
      settings.replaceChildren();
      // Only expose company actions already authorized and rendered by the app.
      const originalSelect = company?.querySelector('select');
      if (originalSelect) {
        const select = originalSelect.cloneNode(true);
        select.setAttribute('aria-label', 'Empresa atual');
        select.value = originalSelect.value;
        select.addEventListener('change', () => {
          originalSelect.value = select.value;
          originalSelect.dispatchEvent(new Event('change', { bubbles: true }));
          close();
        });
        settings.append(select);
      }
      const companies = company?.querySelector('button');
      if (companies) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Gerenciar empresas';
        button.addEventListener('click', () => { close(); companies.click(); }); settings.append(button);
      }
    });
    updateTheme();
    header.append(details);
  }
  const start = () => {
    setup();
    new MutationObserver(setup).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();

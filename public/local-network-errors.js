// Friendly network failures in the recovered local build; never retry a POST.
(() => {
  let theme = 'dark';
  try {
    if (!localStorage.getItem('rw_theme_restored_20261018')) {
      localStorage.setItem('rw_theme', 'dark');
      localStorage.setItem('rw_theme_restored_20261018', '1');
    }
    theme = localStorage.getItem('rw_theme') === 'light' ? 'light' : 'dark';
  } catch {}
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    try { return await originalFetch(...args); }
    catch (error) {
      if (error instanceof TypeError) {
        throw new Error(navigator.onLine
          ? 'Não foi possível conectar ao sistema. Aguarde alguns instantes e tente novamente.'
          : 'Você está sem conexão. Conecte-se à internet e tente entrar novamente.');
      }
      throw error;
    }
  };
})();

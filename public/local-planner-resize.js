/** Resize a side-by-side planner without changing route data. */
function attachPlannerResize(root, divider) {
  let ratio = .47;
  try { const saved = Number(localStorage.getItem('rw_planner_split')); if (saved > .15 && saved < .85) ratio = saved; } catch {}
  let active = false;
  let frame = 0;
  const bounds = () => {
    const width = root.getBoundingClientRect().width;
    const min = Math.min(260, width * .4);
    return { width, min, max: Math.max(min, width - 12 - 240) };
  };
  const setWidth = value => {
    const { width, min, max } = bounds();
    const left = Math.round(Math.max(min, Math.min(max, value)));
    ratio = left / Math.max(1, width);
    const css = `${left}px`;
    if (root.style.getPropertyValue('--planner-panel-width') !== css) {
      root.style.setProperty('--planner-panel-width', css);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
    divider.setAttribute('aria-valuemin', String(Math.round(min)));
    divider.setAttribute('aria-valuemax', String(Math.round(max)));
    divider.setAttribute('aria-valuenow', String(left));
    divider.setAttribute('aria-valuetext', `Painel da rota com ${left} pixels de largura`);
  };
  const layout = () => {
    if (!root.isConnected) return;
    const nav = document.querySelector('.managed-workspace > .sidebar');
    const navHeight = nav && getComputedStyle(nav).position === 'fixed' ? nav.getBoundingClientRect().height : 0;
    const height = Math.max(120, window.innerHeight - root.getBoundingClientRect().top - navHeight - 16);
    root.style.setProperty('--planner-available-height', `${Math.floor(height)}px`);
    if (matchMedia('(min-width: 701px)').matches) setWidth(bounds().width * ratio);
  };
  const save = () => { try { localStorage.setItem('rw_planner_split', String(ratio)); } catch {} };
  const down = event => {
    if (event.button !== 0) return;
    active = true;
    divider.setPointerCapture(event.pointerId);
    divider.classList.add('dragging');
    event.preventDefault();
  };
  const move = event => { if (active) setWidth(event.clientX - root.getBoundingClientRect().left - 6); };
  const up = () => { if (active) { active = false; divider.classList.remove('dragging'); save(); } };
  const keys = event => {
    const current = Number(divider.getAttribute('aria-valuenow')) || bounds().width * ratio;
    let next;
    if (event.key === 'ArrowLeft') next = current - 24;
    if (event.key === 'ArrowRight') next = current + 24;
    if (event.key === 'Home') next = bounds().min;
    if (event.key === 'End') next = bounds().max;
    if (next !== undefined) { event.preventDefault(); setWidth(next); save(); }
  };
  const reset = () => { ratio = .47; layout(); save(); };
  divider.addEventListener('pointerdown', down);
  divider.addEventListener('pointermove', move);
  divider.addEventListener('pointerup', up);
  divider.addEventListener('pointercancel', up);
  divider.addEventListener('lostpointercapture', up);
  divider.addEventListener('keydown', keys);
  divider.addEventListener('dblclick', reset);
  const observer = new ResizeObserver(layout);
  observer.observe(root);
  const header = root.closest('.dashboard')?.querySelector(':scope > header');
  if (header) observer.observe(header);
  window.addEventListener('resize', layout);
  layout();
  return () => {
    observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', layout);
    divider.removeEventListener('pointerdown', down); divider.removeEventListener('pointermove', move);
    divider.removeEventListener('pointerup', up); divider.removeEventListener('pointercancel', up);
    divider.removeEventListener('lostpointercapture', up); divider.removeEventListener('keydown', keys); divider.removeEventListener('dblclick', reset);
  };
}

(() => {
  const mounted = new Map();
  const scan = () => {
    for (const [root, cleanup] of mounted) if (!root.isConnected) { cleanup(); mounted.delete(root); }
    for (const root of document.querySelectorAll('.planner-fullscreen')) {
      if (mounted.has(root)) continue;
      const map = root.querySelector(':scope > .planner-map');
      if (!map) continue;
      const divider = document.createElement('div');
      divider.className = 'planner-divider'; divider.tabIndex = 0;
      divider.setAttribute('role', 'separator'); divider.setAttribute('aria-orientation', 'vertical');
      divider.setAttribute('aria-label', 'Ajustar largura do painel da rota e do mapa');
      root.insertBefore(divider, map);
      mounted.set(root, attachPlannerResize(root, divider));
    }
  };
  const start = () => { scan(); new MutationObserver(scan).observe(document.body, { childList: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
// Tema do Argos (escuro por padrão; claro / escuro / automático), compartilhado por todas as páginas.
// Mesma origem => mesma chave no localStorage, então a escolha vale para o site todo.
const KEY = 'argos.theme';
const ORDER = ['auto', 'light', 'dark'];
export const DEFAULT = 'dark';
const META = { dark: '#101316', light: '#F4F2EC' };
const LABEL = { auto: 'automático', light: 'claro', dark: 'escuro' };
const ICONS = {
  auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
  light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
};

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    if (ORDER.includes(t)) return t;
    // migra a escolha antiga, guardada nas configurações dos ônibus
    const old = JSON.parse(localStorage.getItem('argos.v1') || 'null')?.settings?.theme;
    if (ORDER.includes(old)) return old;
  } catch (e) {}
  return DEFAULT;
}

export function setTheme(t) {
  if (!ORDER.includes(t)) t = DEFAULT;
  try { localStorage.setItem(KEY, t); } catch (e) {}
  applyTheme(t);
}

export function applyTheme(t = getTheme()) {
  const root = document.documentElement;
  root.dataset.theme = t;   // 'auto' segue o sistema via argos.css
  const light = t === 'light' || (t === 'auto' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches);
  document.querySelectorAll('meta[name=theme-color]').forEach((m) => { m.removeAttribute('media'); m.content = light ? META.light : META.dark; });
  document.querySelectorAll('[data-theme-btn]').forEach((b) => {
    b.innerHTML = ICONS[t];
    b.setAttribute('aria-label', `Tema: ${LABEL[t]}. Toque para mudar.`);
    b.title = `Tema: ${LABEL[t]}`;
  });
}

// Liga todo botão [data-theme-btn] da página.
export function initTheme() {
  document.querySelectorAll('[data-theme-btn]').forEach((b) => {
    b.onclick = () => setTheme(ORDER[(ORDER.indexOf(getTheme()) + 1) % ORDER.length]);
  });
  applyTheme();
}

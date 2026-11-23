// Menu do Argos: abas no topo (desktop) e barra inferior (celular), via lib/argos.css.
// Uso: <nav class="nav" data-nav aria-label="Principal"></nav> no HTML + initNav().
export const TABS = [
  { href: 'index.html', label: 'Início', pages: ['index.html', ''] },
  { href: 'onibus.html', label: 'Ônibus', pages: ['onibus.html'] },
  { href: 'carro.html', label: 'Carro', pages: ['carro.html'] },
  { href: 'gastos.html', label: 'Gastos', pages: ['gastos.html', 'cartao.html', 'faturas.html'] },
  { href: 'saude.html', label: 'Saúde', pages: ['saude.html'] },
];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Caminho da URL -> aba ativa (null se nenhuma).
export function currentTab(pathname) {
  const file = String(pathname || '').split('?')[0].split('#')[0].split('/').pop();
  return TABS.find((t) => t.pages.includes(file)) || null;
}

export function navHtml(pathname) {
  const cur = currentTab(pathname);
  const links = TABS.map((t) => `<a href="${esc(t.href)}"${t === cur ? ' aria-current="page"' : ''}>${esc(t.label)}</a>`).join('');
  return `<a class="nav-brand" href="index.html">Argos</a><div class="nav-links">${links}</div>`;
}

export function initNav(root = document) {
  const el = root.querySelector('[data-nav]');
  if (el) el.innerHTML = navHtml(location.pathname);
  return el;
}

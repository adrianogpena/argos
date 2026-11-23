// Tema e menu (dados fictícios, sem navegador).
import assert from 'node:assert/strict';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
const metas = [{ content: '#000', media: 'x', removeAttribute(a) { delete this[a]; } }];
globalThis.document = { documentElement: { dataset: {} }, querySelectorAll: (q) => (q.includes('meta') ? metas : []) };
globalThis.matchMedia = () => ({ matches: false });
const { getTheme, setTheme, applyTheme, DEFAULT } = await import('../lib/theme.js');
const { currentTab, navHtml, TABS } = await import('../lib/nav.js');

assert.equal(DEFAULT, 'dark');
assert.equal(getTheme(), 'dark', 'sem escolha: escuro');
store.set('argos.theme', 'auto'); assert.equal(getTheme(), 'auto', 'escolha salva é respeitada');
store.set('argos.theme', 'light'); assert.equal(getTheme(), 'light');
store.set('argos.theme', 'lixo'); assert.equal(getTheme(), 'dark');
store.clear(); store.set('argos.v1', JSON.stringify({ settings: { theme: 'light' } })); assert.equal(getTheme(), 'light', 'migra escolha antiga');
store.clear();
setTheme('light'); assert.equal(document.documentElement.dataset.theme, 'light'); assert.equal(metas[0].content, '#F4F2EC'); assert.equal(metas[0].media, undefined);
setTheme('auto'); assert.equal(document.documentElement.dataset.theme, 'auto'); assert.equal(metas[0].content, '#101316');
setTheme('xyz'); assert.equal(store.get('argos.theme'), 'dark');

assert.equal(TABS.length, 5);
for (const [p, tab] of [['/', 'Início'], ['/index.html', 'Início'], ['/onibus.html', 'Ônibus'], ['/carro.html', 'Carro'], ['/gastos.html', 'Gastos'], ['/cartao.html', 'Gastos'], ['/faturas.html?x=1', 'Gastos'], ['/saude.html', 'Saúde']])
  assert.equal(currentTab(p)?.label, tab, p);
assert.equal(currentTab('/outra.html'), null);
const h = navHtml('/cartao.html');
assert.equal((h.match(/aria-current="page"/g) || []).length, 1);
assert.match(h, /<a href="gastos.html" aria-current="page">Gastos<\/a>/);
console.log('theme/nav ok');

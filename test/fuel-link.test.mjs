// node test/fuel-link.test.mjs
import assert from 'node:assert/strict';
import { fuelLinks, fuelPending } from '../lib/fuel-link.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const X = (id, date, amount, category, label, extra = {}) => ({ id, date, amount, category, label, ...extra });

t('recategorizes the expense with the same amount within 5 days and drops auto', () => {
  const r = fuelLinks([{ date: '2026-05-10', total: 50 }], [X('a', '2026-05-12', 50, 'Mercado', 'Supermercado', { auto: true, key: 'k' }), X('b', '2026-05-12', 49, 'Mercado')]);
  assert.equal(r.updates.length, 1);
  assert.deepEqual([r.updates[0].id, r.updates[0].category, r.updates[0].label, r.updates[0].need, 'auto' in r.updates[0], r.updates[0].key], ['a', 'Transporte', 'Combustível', 'essential', false, 'k']);
});
t('skips what is already fuel and reports unmatched entries', () => {
  const r = fuelLinks([{ date: '2026-05-10', total: 30 }, { date: '2026-06-01', total: 40 }], [X('a', '2026-05-10', 30, 'Transporte', 'Combustível')]);
  assert.deepEqual([r.updates.length, r.already, r.missing.length], [0, 1, 1]);
});
t('two fuel entries with the same amount do not claim the same expense', () => {
  const r = fuelLinks([{ date: '2026-05-10', total: 40 }, { date: '2026-05-12', total: 40 }], [X('a', '2026-05-10', 40, 'Mercado'), X('b', '2026-05-12', 40, 'Mercado')]);
  assert.deepEqual(r.updates.map(u => u.id).sort(), ['a', 'b']);
});
t('outside the window nothing matches', () => {
  const r = fuelLinks([{ date: '2026-05-10', total: 40 }], [X('a', '2026-05-20', 40, 'Mercado')]);
  assert.deepEqual([r.updates.length, r.missing.length], [0, 1]);
});
t('fuelPending lists, for the month, entries to link and entries without an expense', () => {
  const fuels = [{ date: '2026-05-10', total: 50 }, { date: '2026-05-20', total: 30 }, { date: '2026-06-02', total: 40 }];
  const p = fuelPending(fuels, [X('a', '2026-05-11', 50, 'Mercado', 'Supermercado', { note: 'LOJA' })], '2026-05');
  assert.deepEqual(p.toLink.map(x => [x.date, x.category]), [['2026-05-11', 'Mercado']]);
  assert.deepEqual(p.missing.map(x => x.date), ['2026-05-20']);
});
console.log(n + ' ok');

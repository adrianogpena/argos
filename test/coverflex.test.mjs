// node test/coverflex.test.mjs
import assert from 'node:assert/strict';
import { coverflexRecords, linkCoverflex } from '../lib/coverflex.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const P = (date, amount, desc, extra = {}) => ({ date, amount, desc, kind: 'purchase', category: 'Mercado', need: 'essential', detail: 'Supermercado', ...extra });

t('purchases become coverflex expenses; top-ups are left out', () => {
  const { records, errors } = coverflexRecords([{ date: '2026-01-29', amount: 192, desc: 'Meal top-up', kind: 'topup' }, P('2026-01-03', 19.14, 'intermarche')]);
  assert.equal(errors.length, 0);
  assert.equal(records.length, 1);
  const r = records[0];
  assert.deepEqual([r.source, r.coverflex, r.category, r.need, r.label, r.amount, r.note, 'auto' in r], ['coverflex', true, 'Mercado', 'essential', 'Supermercado', 19.14, 'intermarche', false]);
});
t('ids are stable and identical same-day purchases do not collide', () => {
  const rows = [P('2026-10-06', 3.58, 'x'), P('2026-10-06', 3.58, 'x'), P('2026-10-06', 17.3, 'x')];
  const a = coverflexRecords(rows).records.map(r => r.id), b = coverflexRecords(rows).records.map(r => r.id);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 3);
  assert.ok(a.every(id => id.startsWith('v')));
});
t('invalid entry is reported, not dropped silently', () => {
  const { records, errors } = coverflexRecords([P('2026-01-03', 0, 'a'), P('2026-01-03', 5, 'b', { category: '' })]);
  assert.deepEqual([records.length, errors.length], [0, 2]);
});
const F = (id, date, total, extra = {}) => ({ id, nif: '1', name: 'Loja', tipo: 'Fatura', date, total, sit: 'Registado', ...extra });
t('link: unsent invoice gets expenseId in place, sent one goes to efatura+link, linked ones are untouched', () => {
  const cf = [{ id: 'va', date: '2026-01-03', amount: 10 }, { id: 'vb', date: '2026-01-05', amount: 20 }, { id: 'vc', date: '2026-01-07', amount: 30 }];
  const plan = { efatura: [F('f1', '2026-01-03', 10), F('f2', '2026-01-05', 20), F('f3', '2026-01-07', 30, { expenseId: 'bank1' })], expenses: cf };
  const r = linkCoverflex(plan, { sent: { efatura: ['f2'] } }, cf);
  assert.deepEqual(r.plan.efatura.map(x => x.expenseId), ['va', undefined, 'bank1']);
  assert.deepEqual(r.plan['efatura+link'].map(x => [x.id, x.expenseId]), [['f2', 'vb']]);
  assert.deepEqual(Object.keys(r.plan), ['efatura', 'expenses', 'efatura+link']);
});
t('link: running again changes nothing and the 45-day wide rule is not used', () => {
  const cf = [{ id: 'va', date: '2026-03-01', amount: 10, note: 'loja' }];
  const plan = { efatura: [F('f1', '2026-01-03', 10)], expenses: cf };
  assert.equal(linkCoverflex(plan, {}, cf).direct.length, 0);
  const cf2 = [{ id: 'vb', date: '2026-01-03', amount: 10 }];
  const once = linkCoverflex({ efatura: [F('f2', '2026-01-03', 10)] }, { sent: { efatura: ['f2'] } }, cf2).plan;
  assert.deepEqual(linkCoverflex(once, { sent: { efatura: ['f2'] } }, cf2).resend, []);
});
console.log(n + ' ok');

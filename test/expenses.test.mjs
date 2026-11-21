// node test/expenses.test.mjs
import assert from 'node:assert/strict';
import { expenseRecord, needSplit, monthly, byCategory, monthTotal, delta, categoriesIn, categoryOptions, canonicalCategory } from '../lib/expenses-core.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const E = (date, amount, category) => ({ id: date + amount, date, amount, category });

t('expenseRecord validates', () => {
  assert.ok(expenseRecord({ id: 'a', date: '2026-05-02', amount: '12,50', category: 'Mercado' }).ok);
  assert.equal(expenseRecord({ id: 'a', date: '2026-05-02', amount: '0', category: 'x' }).error, 'amount');
  assert.equal(expenseRecord({ id: 'a', date: '2026-05-02', amount: '5', category: ' ' }).error, 'category');
  assert.equal(expenseRecord({ id: 'a', date: 'hoje', amount: '5', category: 'x' }).error, 'date');
});
t('expenseRecord keeps the bank fields and rejects an unknown need', () => {
  const r = expenseRecord({ id: 'a', date: '2026-05-02', amount: '9', category: 'Mercado', need: 'essential', source: 'bank', auto: true, key: 'loja-exemplo' }).rec;
  assert.deepEqual([r.need, r.source, r.auto, r.key], ['essential', 'bank', true, 'loja-exemplo']);
  const m = expenseRecord({ id: 'b', date: '2026-05-02', amount: '9', category: 'Mercado', need: 'xyz' }).rec;
  assert.equal(m.need, ''); assert.ok(!('auto' in m) && !('source' in m));
});
t('needSplit separates essential, flexible and undefined in the month', () => {
  const items = [{ ...E('2026-05-01', 100, 'Moradia'), need: 'essential' }, { ...E('2026-05-02', 20, 'Lazer'), need: 'flexible' }, E('2026-05-03', 5, 'x'), { ...E('2026-04-03', 99, 'x'), need: 'essential' }];
  assert.deepEqual(needSplit(items, '2026-05'), { essential: 100, flexible: 20, none: 5 });
});
t('monthly fills empty months and keeps order', () => {
  const m = monthly([E('2026-03-10', 5, 'a'), E('2026-03-20', 7, 'a'), E('2026-05-01', 3, 'a')], 4, new Date(2026, 4, 15));
  assert.deepEqual(m, [{ month: '2026-02', total: 0 }, { month: '2026-03', total: 12 }, { month: '2026-04', total: 0 }, { month: '2026-05', total: 3 }]);
});
t('monthly crosses a year boundary', () => {
  assert.deepEqual(monthly([], 3, new Date(2026, 0, 31)).map(x => x.month), ['2025-11', '2025-12', '2026-01']);
});
t('byCategory sorts, shares add to 1, month filter works', () => {
  const items = [E('2026-05-01', 30, 'Mercado'), E('2026-05-09', 70, 'Moradia'), E('2026-04-09', 100, 'Lazer')];
  const c = byCategory(items, '2026-05');
  assert.deepEqual(c.map(x => x.category), ['Moradia', 'Mercado']); assert.equal(c[0].share, 0.7);
  assert.equal(byCategory(items, null).length, 3); assert.deepEqual(byCategory([], '2026-05'), []);
});
t('delta against previous month, including January', () => {
  const items = [E('2025-12-10', 100, 'a'), E('2026-01-10', 150, 'a')];
  assert.equal(delta(items, '2026-01'), 0.5); assert.equal(delta(items, '2025-12'), null);
  assert.equal(monthTotal(items, '2026-01'), 150);
});
t('categoriesIn keeps defaults and adds custom ones once', () => {
  const c = categoriesIn([E('2026-01-01', 1, 'Pets'), E('2026-01-02', 1, 'Mercado')]);
  assert.ok(c.includes('Pets')); assert.equal(c.filter(x => x === 'Mercado').length, 1);
});
t('categoryOptions: sem repetir por caixa/acento, sem "Sem categoria", Outros por último', () => {
  const o = categoryOptions([E('2026-01-01', 1, 'mercado'), E('2026-01-01', 1, 'Pets'), E('2026-01-01', 1, 'Sem categoria'), E('2026-01-01', 1, ' ')]);
  assert.equal(o.filter(x => x.toLowerCase() === 'mercado').length, 1); assert.ok(o.includes('Pets'));
  assert.ok(!o.includes('Sem categoria')); assert.equal(o.at(-1), 'Outros');
  assert.deepEqual(o.slice(0, -1), [...o.slice(0, -1)].sort((a, b) => a.localeCompare(b, 'pt')));
});
t('canonicalCategory: reaproveita a grafia existente, ignorando caixa e acento', () => {
  const o = ['Saúde', 'Mercado'];
  assert.equal(canonicalCategory('saude', o), 'Saúde'); assert.equal(canonicalCategory('  MERCADO ', o), 'Mercado');
  assert.equal(canonicalCategory('Pets  e   Bichos', o), 'Pets e Bichos');
});
console.log(`\n${n} passed`);

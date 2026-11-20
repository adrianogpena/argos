// node test/expenses.test.mjs
import assert from 'node:assert/strict';
import { expenseRecord, withCar, monthly, byCategory, monthTotal, delta, categoriesIn } from '../lib/expenses-core.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const E = (date, amount, category) => ({ id: date + amount, date, amount, category });

t('expenseRecord validates', () => {
  assert.ok(expenseRecord({ id: 'a', date: '2026-05-02', amount: '12,50', category: 'Mercado' }).ok);
  assert.equal(expenseRecord({ id: 'a', date: '2026-05-02', amount: '0', category: 'x' }).error, 'amount');
  assert.equal(expenseRecord({ id: 'a', date: '2026-05-02', amount: '5', category: ' ' }).error, 'category');
  assert.equal(expenseRecord({ id: 'a', date: 'hoje', amount: '5', category: 'x' }).error, 'date');
});
t('withCar adds fuel and services as category Carro, drops zero-cost rows', () => {
  const all = withCar([E('2026-05-01', 10, 'Mercado')], [{ id: 'a', date: '2026-05-02', total: 60 }], [{ id: 'b', date: '2026-05-03', cost: 0, kind: 'Lavagem' }, { id: 'c', date: '2026-05-04', cost: 90, kind: 'Óleo' }]);
  assert.deepEqual(all.map(x => [x.category, x.amount]), [['Mercado', 10], ['Carro', 60], ['Carro', 90]]);
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
console.log(`\n${n} passed`);

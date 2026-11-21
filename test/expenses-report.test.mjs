// node test/expenses-report.test.mjs
import assert from 'node:assert/strict';
import { salaryPlan, expectedIncome, recurring, forecast, projection, topMerchants, categoryVsAverage, needByMonth, addMonths } from '../lib/expenses-report.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const NOW = new Date(2026, 10, 21);   // 21/11/2026
const X = (date, amount, key, category = 'Outros', extra = {}) => ({ id: date + key + amount, date, amount, category, key, note: 'COMPRA ' + key.toUpperCase(), ...extra });
const pay = (date, amount) => ({ date, desc: 'TRANSFERENCIA - VENCIMENTO', amount });
const LINES = [pay('2026-05-26', 1000), pay('2026-06-30', 2000), pay('2026-07-29', 1000), pay('2026-08-28', 1000), pay('2026-09-29', 1000), pay('2026-10-28', 1000), { date: '2026-10-01', desc: 'TRF DE AMIGO', amount: 500 }];

t('salaryPlan: base ignores doubled payments and other credits; day is the median', () => {
  const p = salaryPlan(LINES);
  assert.equal(p.base, 1000); assert.equal(p.day, 29);
  assert.equal(salaryPlan([{ date: '2026-01-01', desc: 'TRF', amount: 5 }]), null);
});
t('expectedIncome doubles in June and November, caps the day at month end', () => {
  const p = salaryPlan(LINES);
  assert.deepEqual(expectedIncome(p, '2026-11'), { date: '2026-11-29', amount: 2000, double: true });
  assert.equal(expectedIncome(p, '2026-12').amount, 1000);
  assert.equal(expectedIncome(p, '2027-06').double, true);
  assert.equal(expectedIncome({ ...p, day: 31 }, '2027-02').date, '2027-02-28');
});
// Seis meses completos (mai-out): aluguel fixo, internet com pequena variação, mercado variável (3x/mês), assinatura que só apareceu 2 vezes.
const HIST = [];
for (let i = 1; i <= 6; i++) {
  const m = addMonths('2026-11', -i);
  HIST.push(X(m + '-07', 700, 'aluguel', 'Moradia'), X(m + '-13', 40 + (i % 2), 'internet', 'Contas'));
  HIST.push(X(m + '-03', 30 + i * 9, 'mercado', 'Mercado'), X(m + '-10', 80 - i * 7, 'mercado', 'Mercado'), X(m + '-20', 20 + i * 5, 'mercado', 'Mercado'));
}
HIST.push(X('2026-09-15', 10, 'streaming', 'Assinaturas'), X('2026-10-15', 10, 'streaming', 'Assinaturas'));
t('recurring keeps stable monthly items only', () => {
  const r = recurring(HIST, NOW);
  assert.deepEqual(r.map(x => x.key), ['aluguel', 'internet']);
  assert.equal(r[0].amount, 700); assert.equal(r[0].day, 7); assert.equal(r[0].months, 6);
});
t('forecast of the next month: income minus fixed, then minus typical variable', () => {
  const f = forecast(HIST, salaryPlan(LINES), '2026-12', NOW);
  assert.equal(f.income.amount, 1000); assert.ok(f.fixedTotal > 740 && f.fixedTotal < 742);
  assert.equal(f.fixedTotal, f.rows.reduce((s, r) => s + r.amount, 0));
  assert.equal(f.free, 1000 - f.fixedTotal);
  assert.ok(f.variable > 0 && f.afterVariable === Math.round((f.free - f.variable) * 100) / 100);
});
t('forecast of the current month only counts what is still missing', () => {
  const items = [...HIST, X('2026-11-07', 700, 'aluguel', 'Moradia')];
  const f = forecast(items, salaryPlan(LINES), '2026-11', NOW);
  assert.equal(f.rows.find(r => r.key === 'aluguel').done, true);
  assert.equal(f.rows.find(r => r.key === 'internet').done, false);
  assert.equal(f.income.amount, 2000); assert.equal(f.incomePending, 2000);
  assert.ok(f.fixedTotal > 39 && f.fixedTotal < 42);
  const got = forecast(items, salaryPlan([...LINES, pay('2026-11-21', 2000)]), '2026-11', NOW);
  assert.equal(got.incomePending, 0);
});
t('projection is null until the month has expenses, then extrapolates the variable part', () => {
  assert.equal(projection(HIST, NOW), null);
  const items = [...HIST, X('2026-11-07', 700, 'aluguel', 'Moradia'), X('2026-11-10', 150, 'mercado', 'Mercado')];
  const p = projection(items, NOW);
  assert.equal(p.day, 10); assert.equal(p.spent, 850); assert.equal(p.varSoFar, 150);
  assert.equal(p.projected, Math.round((p.fixedTotal + 150 / 10 * 30) * 100) / 100);
});
t('topMerchants ranks by amount inside the period and reports shares', () => {
  const r = topMerchants(HIST, '2026-10', '2026-10', 2);
  assert.equal(r.rows[0].key, 'aluguel'); assert.equal(r.rows.length, 2);
  assert.ok(r.rows[0].share > r.rows[1].share && r.total > 700);
  assert.equal(r.rows[0].name, 'ALUGUEL');
});
t('categoryVsAverage compares to the previous months and cuts the current month at the same day', () => {
  const items = [X('2026-08-05', 90, 'a', 'Lazer'), X('2026-09-05', 90, 'a', 'Lazer'), X('2026-10-05', 90, 'a', 'Lazer'), X('2026-10-25', 900, 'a', 'Lazer'), X('2026-11-05', 150, 'a', 'Lazer')];
  const c = categoryVsAverage(items, '2026-11', NOW)[0];
  assert.deepEqual([c.category, c.amount, c.avg, c.diff], ['Lazer', 150, 90, 60]);       // o gasto de 25/10 fica fora (hoje é dia 21)
  assert.equal(categoryVsAverage(items, '2026-10', NOW)[0].avg, 60);                      // mês fechado: ago/set/jul = 180/3
});
t('needByMonth fills empty months and splits by type', () => {
  const r = needByMonth([X('2026-10-01', 5, 'a', 'x', { need: 'essential' }), X('2026-10-02', 7, 'b', 'x', { need: 'flexible' }), X('2026-10-03', 1, 'c', 'x')], 3, '2026-11');
  assert.deepEqual(r.map(x => x.month), ['2026-09', '2026-10', '2026-11']);
  assert.deepEqual(r[1], { month: '2026-10', essential: 5, flexible: 7, none: 1 }); assert.equal(r[0].essential + r[2].flexible, 0);
});
console.log(n + ' tests passed');

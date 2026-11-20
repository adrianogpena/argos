// node test/car.test.mjs
import assert from 'node:assert/strict';
import { fuelRecord, consumption, summary, monthlySpend, reminders, serviceRecord, parseNum } from '../lib/car-core.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const F = (date, odometer, liters, total, full = true) => ({ id: date + odometer, date, odometer, liters, total, full });

t('parseNum accepts a decimal comma', () => { assert.equal(parseNum('45,5'), 45.5); assert.ok(Number.isNaN(parseNum('abc'))); });
t('fuelRecord validates and computes price per litre', () => {
  const r = fuelRecord({ id: 'x', date: '2026-05-01', odometer: '12000', liters: '40,0', total: '70' });
  assert.ok(r.ok); assert.equal(r.rec.pricePerL, 1.75);
  for (const bad of [{ date: 'x' }, { date: '2026-05-01', odometer: -1 }, { date: '2026-05-01', odometer: 1, liters: 0 }]) assert.equal(fuelRecord(bad).ok, false);
});
t('consumption: full to full', () => {
  const c = consumption([F('2026-01-01', 1000, 40, 70), F('2026-01-15', 1500, 30, 54), F('2026-02-01', 2100, 36, 65)]);
  assert.equal(c.length, 2); assert.equal(c[0].km, 500); assert.equal(Math.round(c[0].kmPerL * 100) / 100, 16.67);
  assert.equal(c[1].km, 600); assert.equal(c[1].litres, 36);
});
t('consumption: partial fills in between are added to the next full', () => {
  const c = consumption([F('2026-01-01', 1000, 40, 70), F('2026-01-10', 1300, 10, 18, false), F('2026-01-20', 1600, 20, 36)]);
  assert.equal(c.length, 1); assert.equal(c[0].litres, 30); assert.equal(c[0].km, 600); assert.equal(c[0].lPer100, 5);
});
t('consumption: input order does not matter, one fill gives none', () => {
  assert.equal(consumption([F('2026-01-01', 1000, 40, 70)]).length, 0);
  assert.equal(consumption([F('2026-02-01', 2100, 36, 65), F('2026-01-01', 1000, 40, 70)]).length, 1);
});
t('summary totals and averages', () => {
  const s = summary([F('2026-01-01', 1000, 40, 70), F('2026-01-15', 1500, 30, 54)]);
  assert.equal(s.count, 2); assert.equal(s.spent, 124); assert.equal(s.lastOdo, 1500); assert.equal(Math.round(s.avgCostPerKm * 1000) / 1000, 0.108);
  assert.equal(summary([]).avgKmPerL, null);
});
t('monthlySpend merges fuel and services', () => {
  const m = monthlySpend([F('2026-01-01', 1, 1, 50), F('2026-01-20', 2, 1, 25), F('2026-02-03', 3, 1, 10)], [{ date: '2026-02-10', cost: 100 }]);
  assert.deepEqual(m, [{ month: '2026-01', total: 75 }, { month: '2026-02', total: 110 }]);
});
t('reminders: newest record per kind, overdue first', () => {
  const sv = [
    { kind: 'Oil', date: '2025-01-01', nextKm: 10000 }, { kind: 'oil', date: '2026-01-01', nextKm: 20000 },
    { kind: 'Inspection', date: '2025-06-01', nextDate: '2026-06-01' }, { kind: 'Tyres', date: '2026-01-01', nextKm: 60000 }, { kind: 'Wash', date: '2026-01-01' },
  ];
  const r = reminders(sv, 19500, '2026-07-01');
  assert.deepEqual(r.map(x => [x.kind.toLowerCase(), x.state]), [['inspection', 'overdue'], ['oil', 'soon'], ['tyres', 'ok']]);
  assert.equal(r[1].kmLeft, 500);
});
t('serviceRecord needs a kind and a date', () => {
  assert.equal(serviceRecord({ date: '2026-01-01', kind: '' }).ok, false);
  const r = serviceRecord({ id: 'a', date: '2026-01-01', kind: 'Oil', cost: '80,5', nextKm: '', nextDate: '' });
  assert.ok(r.ok); assert.equal(r.rec.cost, 80.5); assert.ok(!('nextKm' in r.rec));
});
console.log(`\n${n} passed`);

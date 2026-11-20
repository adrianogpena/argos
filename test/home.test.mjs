// node test/home.test.mjs
import assert from 'node:assert/strict';
import { homeSummary } from '../lib/home-core.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('vazio não quebra', () => {
  const s = homeSummary({}, '2026-05-10');
  assert.equal(s.total, 0); assert.deepEqual(s.reminders, []);
});
t('soma o mês, incluindo o carro', () => {
  const s = homeSummary({
    expenses: [{ id: 'a', date: '2026-05-02', amount: 100, category: 'Mercado' }, { id: 'b', date: '2026-04-02', amount: 50, category: 'Mercado' }],
    fuels: [{ id: 'f', date: '2026-05-03', odometer: 1000, liters: 40, total: 60, full: true }],
  }, '2026-05-10');
  assert.equal(s.total, 160);
});
t('só lembretes vencidos ou próximos', () => {
  const s = homeSummary({ services: [
    { id: 's1', date: '2026-01-01', odometer: 500, kind: 'Óleo', cost: 0, nextKm: 900, nextDate: '' },
    { id: 's2', date: '2026-01-01', odometer: 500, kind: 'Pneus', cost: 0, nextKm: 90000, nextDate: '' },
  ] }, '2026-05-10');
  assert.deepEqual(s.reminders.map(r => r.kind), ['Óleo']);
  assert.equal(s.reminders[0].state, 'soon');
});
t('leitura de odômetro avança os lembretes', () => {
  const s = homeSummary({ services: [{ id: 's1', date: '2026-01-01', odometer: 500, kind: 'Óleo', cost: 0, nextKm: 900 }], statuses: [{ id: 'x', date: '2026-05-01', odometer: 950 }] }, '2026-05-10');
  assert.equal(s.reminders[0].state, 'overdue');
});
console.log(n + ' ok');

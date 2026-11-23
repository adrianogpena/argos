// node test/home-view.test.mjs
import assert from 'node:assert/strict';
import { gaugeDash, daysShown, dailyTotals, chartPoints, lastTank, pendingReview } from '../lib/home-view.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('mostrador: fração x 220, limitada', () => {
  assert.equal(gaugeDash(0.88), '193.6 220');
  assert.equal(gaugeDash(2), '220.0 220');
  assert.equal(gaugeDash(-1), '0.0 220');
  assert.equal(gaugeDash(NaN), '0.0 220');
});
t('dias mostrados: até hoje no mês corrente, mês inteiro no passado', () => {
  assert.equal(daysShown('2026-11', '2026-11-23'), 23);
  assert.equal(daysShown('2026-02', '2026-11-23'), 28);
});
t('total por dia soma o mesmo dia e ignora outros meses', () => {
  const v = dailyTotals([{ date: '2026-11-02', amount: 10 }, { date: '2026-11-02', amount: 5 }, { date: '2026-10-02', amount: 99 }, { date: '2026-11-30', amount: 7 }], '2026-11', 5);
  assert.deepEqual(v, [0, 15, 0, 0, 0]);
});
t('pontos do gráfico: máximo no topo, zero na base, dia do pico', () => {
  const c = chartPoints([0, 10, 5], 400, 100, 8);
  assert.equal(c.line, '0,92 200,8 400,50');
  assert.equal(c.maxDay, 2); assert.deepEqual(c.last, [400, 50]);
  assert.equal(chartPoints([0, 0]).maxDay, 0);
  assert.equal(chartPoints([]).line, '');
});
t('tanque: leitura mais recente, leitura do painel vence abastecimento do mesmo dia', () => {
  const r = lastTank([{ date: '2026-11-01', fuelLevel: 100 }], [{ date: '2026-11-10', fuelLevel: 40, dashRange: 200 }, { date: '2026-11-10', odometer: 5 }]);
  assert.equal(r.level, 40); assert.equal(r.range, 200); assert.equal(r.liters, 18);
  assert.equal(lastTank([], []), null);
});
t('conta os gastos com palpite pendente', () => {
  assert.equal(pendingReview([{ auto: true }, {}, { auto: true }]), 2);
});
console.log(n + ' ok');

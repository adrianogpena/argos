// node test/card-forecast.test.mjs  (dados fictícios)
import assert from 'node:assert/strict';
import { installment, simulate, paidMode, compare, stampRatio, monthsBetween, FLOOR } from '../lib/card-forecast.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const near = (a, b, e = 0.011) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);
const sum = a => a.reduce((s, x) => s + x, 0);

// Extrato fictício: saldo 1000, opção 15%, TAN 12% (1% ao mês). Total a pagar 150 (15%), mínimo 30 (20% disso).
const ST = (o = {}) => ({ id: '2030-01', stmt: '2030-01', balance: 1000, prevBalance: 900, debits: 150, credits: 50, optionPct: 15, tan: 12, payDate: '2030-02-11', minDue: 30,
  next: { total: { capital: 135, interest: 12, stamp: 3, fees: 0, total: 150 } }, ...o });

t('installment: 15% do saldo, mínimo 20% disso, piso de 10 e nunca acima do saldo', () => {
  assert.equal(installment(1000, 15), 150); assert.equal(installment(1000, 15, 'min'), 30);
  assert.equal(installment(40, 15), FLOOR); assert.equal(installment(40, 15, 'min'), FLOOR);
  assert.equal(installment(6, 15), 6);
});
t('simulate percent: 1ª parcela é a do extrato; juros = (saldo - parcela) x TAN/12; fecha em zero', () => {
  const s = simulate(ST());
  assert.equal(s.rows[0].payment, 150); assert.equal(s.rows[0].month, '2030-02'); assert.equal(s.rows[0].balanceAfter, 850);
  assert.equal(s.rows[0].charges, 15); assert.equal(s.rows[0].capital, 135);
  // 2ª: saldo = 850 + 850 x 1% x (1 + selo)
  const b2 = 850 + 8.5 * 1.1373; near(s.rows[1].payment, b2 * 0.15); near(s.rows[1].charges, 8.5 * 1.1373);
  assert.equal(s.capped, false); assert.equal(s.end, s.rows.at(-1).month); assert.equal(s.months, s.rows.length);
  near(s.rows.at(-1).balanceAfter, 0, 0.001);
});
t('simulate: o total pago é o saldo mais os juros e selo que ainda serão cobrados', () => {
  const s = simulate(ST());
  near(s.totalPaid, 1000 + sum(s.rows.slice(1).map(r => r.charges)), 0.05);
  near(s.futureCharges, sum(s.rows.slice(1).map(r => r.charges)), 0.05);
  assert.ok(s.futureCharges > 0);
});
t('simulate min: 1ª parcela é o mínimo do extrato, prazo bem maior e mais juros', () => {
  const p = simulate(ST()), m = simulate(ST(), { mode: 'min' });
  assert.equal(m.rows[0].payment, 30); assert.ok(m.months > p.months * 3); assert.ok(m.futureCharges > p.futureCharges * 2);
});
t('simulate: sem dívida devolve null; limite de meses marca capped', () => {
  assert.equal(simulate(ST({ balance: 0 })), null);
  const c = simulate(ST({ tan: 200 }), { mode: 'min', maxMonths: 24 });   // juros maiores que o mínimo: nunca acaba
  assert.equal(c.capped, true); assert.equal(c.end, null); assert.equal(c.months, 24);
});
t('simulate: sem "próximo pagamento" no extrato calcula pela opção; sem payDate usa o mês seguinte', () => {
  const s = simulate(ST({ next: null, payDate: null }));
  assert.equal(s.rows[0].payment, 150); assert.equal(s.rows[0].month, '2030-02'); assert.equal(s.rows[0].charges, 0);
});
t('paidMode: reconhece se pagou o mínimo ou a parcela do banco do extrato anterior', () => {
  const prev = ST({ stmt: '2029-12', id: '2029-12' }), cur = o => ST({ paid: { total: o }, paidFractioned: null });
  assert.equal(paidMode([prev, cur(30)]), 'min'); assert.equal(paidMode([prev, cur(150)]), 'percent'); assert.equal(paidMode([prev, cur(77)]), null);
  assert.equal(paidMode([prev]), null);
});
t('compare: acréscimo x baixa, parcela e prazo mudam quando a dívida cresce', () => {
  const a = ST({ stmt: '2029-12', id: '2029-12', balance: 800, prevBalance: 800, payDate: '2030-01-11', next: { total: { interest: 0, stamp: 0, fees: 0, total: 120 } }, minDue: 24 });
  const b = ST({ detail: 1 }), rows = compare([b, a], { detail: { '2030-01': { purchases: 135, charges: 15 } } });
  assert.deepEqual(rows.map(r => r.stmt), ['2029-12', '2030-01']);
  const r = rows[1]; assert.equal(r.net, 100); assert.equal(r.grew, true); assert.equal(r.purchases, 135); assert.equal(r.charges, 15);
  assert.equal(r.parcela, 150); assert.equal(r.parcelaDelta, 30); assert.ok(r.endDelta >= 1);
  assert.equal(rows[0].parcelaDelta, null); assert.equal(rows[0].purchases, null);
});
t('stampRatio e monthsBetween', () => {
  near(stampRatio([{ interest: 10, stamp: 1.4 }, { interest: 0, stamp: 0 }, { interest: 20, stamp: 2.6 }]), 4 / 30, 0.001);
  assert.equal(stampRatio([]), 0.1373); assert.equal(monthsBetween('2029-11', '2030-02'), 3);
});
t('plano: extra mensal e extra em jun/nov encurtam o prazo e cortam juros; auto + extra = parcela', () => {
  const base = simulate(ST(), { mode: 'min' });
  const mo = simulate(ST(), { mode: 'min', extra: 100 }), sp = simulate(ST(), { mode: 'min', special: 500 });
  assert.equal(mo.rows[0].payment, 130); assert.equal(mo.rows[0].auto, 30); assert.equal(mo.rows[0].extra, 100);
  assert.ok(mo.months < base.months && mo.futureCharges < base.futureCharges);
  // 2030-02 (1ª parcela) não é jun/nov: sem extra especial; o mês de junho e o de novembro levam +500
  assert.equal(sp.rows[0].extra, 0); const jun = sp.rows.find(r => r.month.endsWith('-06')); assert.equal(jun.extra, 500);
  assert.ok(sp.rows.filter(r => r.month.endsWith('-11')).every(r => r.extra === 500 || r.balanceAfter === 0));
  for (const r of mo.rows) near(r.payment, r.auto + r.extra, 0.011);
});
t('plano: compras novas aumentam saldo e prazo; se superam o pagamento a dívida nunca fecha', () => {
  const a = simulate(ST(), { mode: 'min', extra: 100 }), b = simulate(ST(), { mode: 'min', extra: 100, purchases: 50 });
  assert.ok(b.months > a.months); near(b.futureCharges, b.totalPaid - 1000 - b.bought);
  assert.equal(simulate(ST(), { mode: 'min', purchases: 400, maxMonths: 60 }).capped, true);
});
console.log(n + ' grupos ok');

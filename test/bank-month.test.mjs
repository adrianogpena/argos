// node test/bank-month.test.mjs  (dados fictícios)
import assert from 'node:assert/strict';
import { bankId } from '../lib/classify.js';
import { linkDebits, monthReport, isMonth } from '../lib/bank-month.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

const mk = (seq, date, desc, amount, balance, account = 'SIMPLES') => ({ account, stmt: '2026-03', file: 'Ex.pdf', seq, date, desc, amount, balance });
const L = [
  mk(0, '2026-03-02', 'SALARIO EXEMPLO', 1000, 1100),
  mk(1, '2026-03-03', 'COMPRA LOJA EXEMPLO', -20, 1080),
  mk(2, '2026-03-03', 'COMPRA LOJA EXEMPLO', -20, 1060),
  mk(3, '2026-03-05', 'CONSTIT DEP PRAZO 1', -500, 560),
  mk(4, '2026-03-06', 'TRF DE Poupanca', 50, 50, 'POUPEUP'),
];
const site = [
  { id: bankId('2026-03-03', 20, 'COMPRA LOJA EXEMPLO', new Map()), date: '2026-03-03', amount: 20, auto: true },
  { id: 'manual1', date: '2026-03-09', amount: 7, source: 'manual' },
];
t('isMonth', () => { assert.ok(isMonth('2026-03')); assert.ok(!isMonth('2026-13')); assert.ok(!isMonth('3_2026')); });
t('linkDebits: idênticos ganham ids distintos; só um está em Gastos', () => {
  const d = linkDebits(L, new Set(site.map(s => s.id)));
  assert.equal(d.length, 3); assert.equal(new Set(d.map(x => x.expenseId)).size, 3);
  assert.deepEqual(d.map(x => x.inExpenses), [true, false, false]);
});
t('monthReport: saldos, totais, fora de Gastos e manuais', () => {
  const r = monthReport('2026-03', L, site);
  const s = r.accounts.find(a => a.account === 'SIMPLES');
  assert.equal(s.opening, 100); assert.equal(s.closing, 560); assert.equal(s.credits, 1000); assert.equal(s.debits, 540); assert.ok(s.balanced);
  assert.equal(r.bankDebits, 540); assert.deepEqual(r.site, { n: 1, total: 20 }); assert.deepEqual(r.outside, { n: 2, total: 520 });
  assert.equal(r.pendingReview, 1); assert.deepEqual(r.siteNotInBank.map(x => x.id), ['manual1']);
  assert.equal(r.incomeGroups[0].total, 1000);
});
console.log(`\n${n} testes ok`);

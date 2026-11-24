// node test/income.test.mjs
import assert from 'node:assert/strict';
import { incomeRecords, incomeKind, fundingMonth, monthBalance, balanceByMonth, balanceSummary } from '../lib/income.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const L = (id, date, amount, desc, account = 'SIMPLES') => ({ id, date, amount, desc, account });

t('income comes from the checking account credits, minus own moves and non-income credits', () => {
  const lines = [
    L('b1', '2026-01-28', 1500, 'TRANSFERENCIA - VENCIMENTO'), L('b2', '2026-01-10', 80, 'TRF MB WAY DE JOAO SILVA'),
    L('b3', '2026-01-11', 500, 'TRF DE PoupeUp - Moneybox'), L('b4', '2026-01-12', 1000, 'VENCIMENTO DEP PRAZO 123'),
    L('b5', '2026-01-13', 300, 'EMPRESTIMO PESSOAL NR. 1'), L('b6', '2026-01-14', 40, 'CRED. 5061 LOJA X'),
    L('b7', '2026-01-15', 200, '>PAGAMENTO CARTAO DE CREDITO', 'VISA'), L('b8', '2026-01-16', -50, 'COMPRA'), L('b9', '2026-01-17', 90, 'Adriano Pena'),
  ];
  const r = incomeRecords(lines, new Set(['trf-poupeup-moneybox']));
  assert.deepEqual(r.map(x => [x.id, x.kind]), [['ib2', 'transfer'], ['ib6', 'refund'], ['ib1', 'salary']]);
});
t('coverflex top-ups become income; same-day top-ups keep distinct ids', () => {
  const r = incomeRecords([], new Set(), [{ date: '2026-01-29', amount: 192, kind: 'topup' }, { date: '2026-01-29', amount: 10, kind: 'topup' }, { date: '2026-01-03', amount: 5, kind: 'purchase' }]);
  assert.deepEqual(r.map(x => [x.id, x.kind, x.source]), [['ic20260129', 'coverflex', 'coverflex'], ['ic20260129-2', 'coverflex', 'coverflex']]);
});
t('skip marked by the owner survives a rebuild', () => {
  const r = incomeRecords([L('b2', '2026-01-10', 80, 'TRF MB WAY DE JOAO SILVA')], new Set(), [], new Map([['ib2', { id: 'ib2', skip: true }]]));
  assert.equal(r[0].skip, true);
});
t('kinds', () => {
  assert.equal(incomeKind('TRF. P/O REEMBOLSOS IRS AT - REEM'), 'tax');
  assert.equal(incomeKind('JUROS DEPOSITO PRAZO 1'), 'interest');
});
t('funding month: paid from day 6 on pays next month; paid up to day 5 pays its own month', () => {
  assert.deepEqual(['2026-10-28', '2026-12-30', '2026-04-01', '2026-03-05', '2026-03-06'].map(fundingMonth), ['2026-11', '2027-01', '2026-04', '2026-03', '2026-04']);
});
t('salary and coverflex carry ref = month they pay; other income keeps its own month', () => {
  const r = incomeRecords([L('b1', '2026-04-01', 3000, 'TRANSFERENCIA - VENCIMENTO'), L('b2', '2026-04-28', 3000, 'TRANSFERENCIA - VENCIMENTO'), L('b3', '2026-04-20', 50, 'TRF MB WAY DE JOAO SILVA')], new Set(), [{ date: '2026-04-30', amount: 190, kind: 'topup' }]);
  assert.deepEqual(r.map(x => [x.kind, x.ref]), [['salary', '2026-04'], ['transfer', '2026-04'], ['salary', '2026-05'], ['coverflex', '2026-05']]);
});
const inc = [{ date: '2025-12-29', ref: '2026-01', amount: 1500, kind: 'salary' }, { date: '2026-01-29', ref: '2026-02', amount: 200, kind: 'coverflex' }, { date: '2026-01-10', amount: 80, kind: 'transfer', skip: true }, { date: '2026-01-28', ref: '2026-02', amount: 1500, kind: 'salary' }];
const exp = [{ date: '2026-01-05', amount: 1200 }, { date: '2026-02-05', amount: 1700 }];
t('month balance: saved when income exceeds spending, over when it does not; skipped income ignored', () => {
  const j = monthBalance(inc, exp, '2026-01'), f = monthBalance(inc, exp, '2026-02');
  assert.deepEqual([j.earned, j.spent, j.balance], [1500, 1200, 300]);
  assert.equal(Math.round(j.saved * 100), 20);
  assert.deepEqual([f.earned, f.spent, f.balance], [1700, 1700, 0]);
  assert.deepEqual(f.kinds, [{ kind: 'salary', amount: 1500 }, { kind: 'coverflex', amount: 200 }]);
});
t('series and summary', () => {
  const rows = balanceByMonth(inc, exp, '2026-02', 3);
  assert.deepEqual(rows.map(r => r.month), ['2025-12', '2026-01', '2026-02']);
  assert.deepEqual(balanceSummary(rows), { earned: 3200, spent: 2900, balance: 300, saved: 2, over: 0 });
});
console.log(n + ' ok');

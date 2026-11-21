// Conferência de um mês do extrato: cruza `bank-lines` (arquivo morto, tudo o que o banco lançou) com `expenses` (o que aparece em Gastos).
// Lógica pura, sem rede. Quem lê/grava o cofre é tools/expenses.mjs.
import { bankId, descKey } from './classify.js';

export const MONTH_STATUS = { archived: 'arquivado', pending: 'pendente', validated: 'validado' };
export const isMonth = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s));
const r2 = n => Math.round(n * 100) / 100;

/**
 * Liga cada saída da conta à vista (SIMPLES) ao id que o lançamento teria em `expenses` (mesma conta de id do push).
 * Devolve as saídas com `expenseId` e `inExpenses` (true se esse id existe em Gastos).
 */
export function linkDebits(lines, expenseIds) {
  const seen = new Map();
  return [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq)
    .filter(l => l.account === 'SIMPLES' && l.amount < 0)
    .map(l => { const id = bankId(l.date, -l.amount, l.desc, seen); return { ...l, expenseId: id, inExpenses: expenseIds.has(id) }; });
}

/** Relatório de um mês (stmt = 'AAAA-MM'). `lines` = todas as bank-lines; `expenses` = todos os gastos do cofre. */
export function monthReport(stmt, lines, expenses) {
  const mine = lines.filter(l => l.stmt === stmt);
  const ids = new Set(expenses.map(e => e.id));
  const accounts = [...new Set(mine.map(l => l.account))].sort().map(acc => {
    const ls = mine.filter(l => l.account === acc).sort((a, b) => a.seq - b.seq);
    const credits = r2(ls.filter(l => l.amount > 0).reduce((s, l) => s + l.amount, 0));
    const debits = r2(-ls.filter(l => l.amount < 0).reduce((s, l) => s + l.amount, 0));
    const opening = r2(ls[0].balance - ls[0].amount), closing = ls[ls.length - 1].balance;
    return { account: acc, lines: ls.length, opening, closing, credits, debits, balanced: Math.abs(opening + credits - debits - closing) < 0.005 };
  });
  const debits = linkDebits(mine, ids);
  const inSite = debits.filter(d => d.inExpenses), outSite = debits.filter(d => !d.inExpenses);
  const siteTotal = r2(inSite.reduce((s, d) => s - d.amount, 0)), outTotal = r2(outSite.reduce((s, d) => s - d.amount, 0));
  const matched = new Set(inSite.map(d => d.expenseId));
  const month = expenses.filter(e => e.date && e.date.slice(0, 7) === stmt);
  const fora = new Map();
  for (const d of outSite) { const k = descKey(d.desc); const v = fora.get(k) || { key: k, n: 0, total: 0, example: d.desc }; v.n++; v.total = r2(v.total + -d.amount); fora.set(k, v); }
  const entradas = new Map();
  for (const l of mine.filter(l => l.account === 'SIMPLES' && l.amount > 0)) { const k = descKey(l.desc); const v = entradas.get(k) || { key: k, n: 0, total: 0, example: l.desc }; v.n++; v.total = r2(v.total + l.amount); entradas.set(k, v); }
  return {
    stmt, file: mine[0]?.file || '', accounts,
    bankDebits: r2(siteTotal + outTotal), site: { n: inSite.length, total: siteTotal }, outside: { n: outSite.length, total: outTotal },
    outsideGroups: [...fora.values()].sort((a, b) => b.total - a.total),
    incomeGroups: [...entradas.values()].sort((a, b) => b.total - a.total),
    pendingReview: month.filter(e => e.auto).length,
    siteNotInBank: month.filter(e => !matched.has(e.id)).map(e => ({ id: e.id, date: e.date, amount: e.amount, note: e.note, source: e.source || 'manual' })),
    debitLines: debits,
  };
}

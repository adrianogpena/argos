// Entradas de dinheiro (coleção `income`) e o saldo do mês: receita menos gasto. Puro, testado em test/income.test.mjs.
import { descKey } from './classify.js';

export const INCOME_KINDS = { salary: 'Salário', coverflex: 'Vale refeição', transfer: 'Transferência', refund: 'Devolução', tax: 'Reembolso de impostos', interest: 'Juros', other: 'Outros' };
const r2 = n => Math.round(n * 100) / 100;

/** Dia do mês até o qual um pagamento de salário ainda é do mês anterior (o salário cai nos últimos dias do mês trabalhado, às vezes nos primeiros do seguinte). */
export const PAY_SLIP_DAYS = 5;
/**
 * Mês que o salário (e a carga da Coverflex) PAGA: trabalha-se o mês M, recebe-se no fim de M (ou até o dia 5 de M+1) e gasta-se em M+1.
 * Recebido no dia 6 em diante → paga o mês seguinte; recebido até o dia 5 → paga o próprio mês (é o salário atrasado do mês anterior).
 */
export function fundingMonth(date) {
  const y = +date.slice(0, 4), m = +date.slice(5, 7), d = +date.slice(8, 10);
  if (d <= PAY_SLIP_DAYS) return date.slice(0, 7);
  const n = new Date(y, m, 1); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0');
}

/** Entradas da conta à vista que NÃO são dinheiro novo: capital de depósito a prazo, crédito/empréstimo concedido, abertura de conta e transferência entre contas do próprio dono. */
const NOT_INCOME = /^(vencimento-dep-prazo|emprestimo-pessoal|concess-credito|dev-com-abrt|trf-abertura-conta|adriano-guareschi-pena|adriano-pena)/;

export function incomeKind(desc, key = descKey(desc)) {
  if (/VENCIMENTO/i.test(desc) && !/DEP PRAZO/i.test(desc)) return 'salary';
  if (/REEMBOLSOS IRS|RESTITUICOES|\bAT - REEM/i.test(desc)) return 'tax';
  if (/^(CRED\.|DEVOL\.|REEMB |TRANSF .* DEVOL|CASHBACK|CRÉDITO CASHBACK)/i.test(desc) || /DEVOL/i.test(desc)) return 'refund';
  if (/^JUROS/i.test(desc)) return 'interest';
  if (/^TRF/i.test(desc)) return 'transfer';
  return 'other';
}

/**
 * Registros de `income` a partir das linhas do extrato (`bank-lines`), das regras "não é gasto" (`skipKeys` = chaves das expense-rules com skip: poupança, conta da esposa...) e das cargas da Coverflex.
 * Id estável (linha do banco / data da carga): reimportar sobrescreve o mesmo registro. `existing` (id → registro) preserva `skip` marcado pelo dono.
 */
export function incomeRecords(lines, skipKeys = new Set(), topups = [], existing = new Map()) {
  const out = [];
  for (const l of lines) {
    if (l.account !== 'SIMPLES' || !(l.amount > 0)) continue;
    const key = descKey(l.desc);
    if (skipKeys.has(key) || NOT_INCOME.test(key)) continue;
    out.push(keep({ id: 'i' + l.id, date: l.date, amount: r2(l.amount), kind: incomeKind(l.desc, key), key, ref: refOf(incomeKind(l.desc, key), l.date), note: String(l.desc).slice(0, 120), source: 'bank' }, existing));
  }
  const seen = new Map();
  for (const t of topups.filter(t => t.kind === 'topup' && t.amount > 0)) {
    const n = (seen.get(t.date) || 0) + 1; seen.set(t.date, n);
    out.push(keep({ id: 'ic' + t.date.replace(/-/g, '') + (n > 1 ? '-' + n : ''), date: t.date, amount: r2(t.amount), kind: 'coverflex', key: 'coverflex', ref: fundingMonth(t.date), note: 'Coverflex: carga do vale refeição', source: 'coverflex' }, existing));
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
/** Mês que a entrada paga: salário e carga do vale refeição pagam o mês seguinte; o resto (venda, devolução, reembolso) conta no mês em que caiu. */
const refOf = (kind, date) => kind === 'salary' ? fundingMonth(date) : date.slice(0, 7);
export const refMonth = x => x.ref || x.date.slice(0, 7);
const keep = (rec, existing) => existing.get(rec.id)?.skip ? { ...rec, skip: true } : rec;

const counted = income => income.filter(x => !x.skip);

/** Receita, gasto e saldo (positivo = guardou, negativo = gastou a mais) de um mês. */
export function monthBalance(income, expenses, month) {
  const inc = counted(income).filter(x => refMonth(x) === month), exp = expenses.filter(x => x.date.startsWith(month));
  const earned = r2(inc.reduce((s, x) => s + x.amount, 0)), spent = r2(exp.reduce((s, x) => s + x.amount, 0));
  const by = new Map(); for (const x of inc) by.set(x.kind, r2((by.get(x.kind) || 0) + x.amount));
  return { month, earned, spent, balance: r2(earned - spent), saved: earned > 0 ? (earned - spent) / earned : null, kinds: [...by].map(([kind, amount]) => ({ kind, amount })).sort((a, b) => b.amount - a.amount) };
}

/** Os `n` meses terminando em `end` (inclusive), do mais antigo ao mais novo. */
export function balanceByMonth(income, expenses, end, n = 12) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(+end.slice(0, 4), +end.slice(5) - 1 - i, 1); out.push(monthBalance(income, expenses, d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'))); }
  return out;
}

/** Total do período e quantos meses guardaram / gastaram a mais (só meses com alguma entrada ou gasto). */
export function balanceSummary(rows) {
  const used = rows.filter(r => r.earned || r.spent);
  return { earned: r2(used.reduce((s, r) => s + r.earned, 0)), spent: r2(used.reduce((s, r) => s + r.spent, 0)), balance: r2(used.reduce((s, r) => s + r.balance, 0)), saved: used.filter(r => r.balance >= 0).length, over: used.filter(r => r.balance < 0).length };
}

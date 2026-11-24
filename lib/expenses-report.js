// Relatórios da aba Gastos: lógica pura (sem DOM, sem rede). Testada por test/expenses-report.test.mjs.
// Entradas: `items` = gastos (coleção expenses), `lines` = linhas do extrato (bank-lines, só para achar o salário).
import { displayName } from './classify.js';
import { fundingMonth, PAY_SLIP_DAYS } from './income.js';

/** Meses em que entra o 13º/14º salário (pago junto ao salário normal). Confirmado no extrato: junho e novembro. */
export const DOUBLE_MONTHS = [6, 11];

export const monthKey = (y, m) => y + '-' + String(m).padStart(2, '0');
export const nowKey = now => monthKey(now.getFullYear(), now.getMonth() + 1);
export function addMonths(k, n) { const d = new Date(+k.slice(0, 4), +k.slice(5) - 1 + n, 1); return monthKey(d.getFullYear(), d.getMonth() + 1); }
export const daysIn = k => new Date(+k.slice(0, 4), +k.slice(5), 0).getDate();
const round2 = n => Math.round(n * 100) / 100;
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const sum = a => a.reduce((s, x) => s + x, 0);

/** Chave de agrupamento do comerciante; sem chave (lançamento manual) usa categoria + rótulo. */
const mkey = x => x.key || (x.label ? 'm:' + x.category + '|' + x.label : '');

// ───────────────────────── Salário ─────────────────────────

/** Acha o salário nas entradas do extrato ("... VENCIMENTO"). Base = mediana dos últimos 6 pagamentos, sem os dobrados. */
export function salaryPlan(lines, doubleMonths = DOUBLE_MONTHS) {
  const pays = lines.filter(l => l.amount > 0 && /VENCIMENTO/i.test(l.desc || '')).sort((a, b) => a.date.localeCompare(b.date));
  if (!pays.length) return null;
  const last = pays.slice(-6), med = median(last.map(p => p.amount));
  const singles = last.filter(p => p.amount <= med * 1.5);
  const base = median(singles.map(p => p.amount));
  const day = Math.round(median(last.map(p => +p.date.slice(8, 10)).filter(d => d > PAY_SLIP_DAYS)));
  return { base: round2(base), day, doubleMonths, pays };
}

/**
 * Salário que paga os gastos de `month`: o do mês anterior, recebido no fim dele (com o 13º/14º se o mês de pagamento for junho ou novembro).
 * `date` = dia esperado do pagamento (no mês anterior).
 */
export function expectedIncome(plan, month) {
  if (!plan) return null;
  const pm = addMonths(month, -1), double = plan.doubleMonths.includes(+pm.slice(5));
  const d = Math.min(plan.day, daysIn(pm));
  return { date: pm + '-' + String(d).padStart(2, '0'), amount: round2(plan.base * (double ? 2 : 1)), double };
}

/** Quanto do salário que paga `month` já caiu na conta (pagamentos do fim do mês anterior ou até o dia 5 deste mês). */
export const receivedIncome = (plan, month) => plan ? round2(sum(plan.pays.filter(p => fundingMonth(p.date) === month).map(p => p.amount))) : 0;

// ───────────────────────── Gastos fixos ─────────────────────────

/**
 * Gastos que se repetem todo mês: comerciantes presentes em pelo menos `minMonths` dos `window` meses completos antes de `now`.
 * Valor estimado = mediana dos últimos 3 meses em que apareceu (os fixos são parecidos); dia = mediana do dia do mês.
 */
export function recurring(items, now, { window = 6, minMonths = 4 } = {}) {
  const cur = nowKey(now), months = Array.from({ length: window }, (_, i) => addMonths(cur, -(i + 1)));
  const g = new Map();
  for (const x of items) {
    const k = mkey(x), m = x.date.slice(0, 7);
    if (!k || !months.includes(m)) continue;
    let r = g.get(k); if (!r) g.set(k, r = { key: k, byMonth: new Map(), days: [], last: x });
    r.byMonth.set(m, (r.byMonth.get(m) || 0) + x.amount); r.days.push(+x.date.slice(8, 10));
    if (x.date > r.last.date) r.last = x;
  }
  const out = [];
  for (const r of g.values()) {
    if (r.byMonth.size < minMonths) continue;
    // Fixo = valor estável: pelo menos 70% dos meses dentro de ±25% da mediana, e no máximo ~2 lançamentos por mês (mercado e café variam demais).
    const vals = [...r.byMonth.values()], med = median(vals);
    if (r.days.length / r.byMonth.size > 2.5 || vals.filter(v => Math.abs(v - med) <= med * 0.25).length < Math.ceil(r.byMonth.size * 0.7)) continue;
    const ms =[...r.byMonth.keys()].sort().slice(-3);
    out.push({ key: r.key, name: displayName(r.last.note) || r.last.label || r.key, category: r.last.category, label: r.last.label || '', need: r.last.need || '',
      amount: round2(median(ms.map(m => r.byMonth.get(m)))), months: r.byMonth.size, day: Math.round(median(r.days)) });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/** Média mensal do que NÃO é fixo, nos últimos `n` meses completos. */
export function variableAverage(items, fixed, now, n = 3) {
  const fk = new Set(fixed.map(f => f.key)), cur = nowKey(now), months = Array.from({ length: n }, (_, i) => addMonths(cur, -(i + 1)));
  const tot = sum(items.filter(x => months.includes(x.date.slice(0, 7)) && !fk.has(mkey(x))).map(x => x.amount));
  return round2(tot / n);
}

// ───────────────────────── Previsão ─────────────────────────

/**
 * Previsão de um mês. Para o mês corrente só conta o que falta (salário ainda não recebido, fixos ainda não pagos);
 * para um mês futuro conta tudo (`future: true` força isso, p.ex. quando o extrato ainda não chegou e `now` só ancora a janela de meses). `free` = receita - fixos; `afterVariable` = free - gasto variável típico.
 */
export function forecast(items, plan, month, now, { future = false } = {}) {
  const cur = nowKey(now), isCurrent = !future && month === cur, fixed = recurring(items, now);
  const inc = expectedIncome(plan, month);
  const paid = new Map(); for (const x of items) if (x.date.startsWith(month)) { const k = mkey(x); paid.set(k, (paid.get(k) || 0) + x.amount); }
  const rows = fixed.map(f => {
    const done = isCurrent && (paid.get(f.key) || 0) >= f.amount * 0.5;
    return { ...f, date: month + '-' + String(Math.min(f.day, daysIn(month))).padStart(2, '0'), done };
  }).sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
  const got = isCurrent ? receivedIncome(plan, month) : 0;
  const incomePending = inc ? (isCurrent ? Math.max(0, round2(inc.amount - got)) : inc.amount) : 0;
  const incomeDone = inc && isCurrent && incomePending < inc.amount * 0.1;
  const fixedTotal = round2(sum(rows.filter(r => !r.done).map(r => r.amount)));
  const variable = variableAverage(items, fixed, now);
  const free = round2(incomePending - fixedTotal);
  return { month, isCurrent, income: inc, received: got, incomePending: incomeDone ? 0 : incomePending, rows, fixedTotal, free, variable, afterVariable: round2(free - variable) };
}

// ───────────────────────── Projeção do mês corrente ─────────────────────────

/**
 * Ritmo do mês em andamento: gasto até o último lançamento, previsão de fechamento (fixos esperados + variável no ritmo atual) e o mesmo dia do mês anterior.
 * O extrato chega com atraso, então "até onde há dados" = data do último lançamento do mês; sem nenhum, devolve null.
 */
export function projection(items, now) {
  const cur = nowKey(now), last = items.reduce((m, x) => x.date.startsWith(cur) && x.date > m ? x.date : m, '');
  if (!last) return null;
  const day = Math.min(+last.slice(8, 10), now.getDate()), dim = daysIn(cur), prev = addMonths(cur, -1), fixed = recurring(items, now), fk = new Set(fixed.map(f => f.key));
  const inCur = items.filter(x => x.date.startsWith(cur) && +x.date.slice(8, 10) <= day);
  const spent = sum(inCur.map(x => x.amount));
  const varSoFar = sum(inCur.filter(x => !fk.has(mkey(x))).map(x => x.amount));
  const paidFixed = new Map(); for (const x of inCur) if (fk.has(mkey(x))) paidFixed.set(mkey(x), (paidFixed.get(mkey(x)) || 0) + x.amount);
  const fixedTotal = sum(fixed.map(f => Math.max(f.amount, paidFixed.get(f.key) || 0)));
  const projected = round2(fixedTotal + varSoFar / Math.max(day, 1) * dim);
  const prevItems = items.filter(x => x.date.startsWith(prev));
  return { month: cur, day, dim, spent: round2(spent), projected, fixedTotal: round2(fixedTotal), varSoFar: round2(varSoFar),
    prevSameDay: round2(sum(prevItems.filter(x => +x.date.slice(8, 10) <= day).map(x => x.amount))), prevTotal: round2(sum(prevItems.map(x => x.amount))) };
}

// ───────────────────────── Comerciantes, médias, essencial x flexível ─────────────────────────

/** Maiores comerciantes entre dois meses (inclusive), com total, número de compras e participação. */
export function topMerchants(items, from, to, n = 10) {
  const g = new Map(); let total = 0;
  for (const x of items) {
    const m = x.date.slice(0, 7); if (m < from || m > to) continue;
    total += x.amount;
    const k = mkey(x) || 'c:' + x.category; let r = g.get(k);
    if (!r) g.set(k, r = { key: k, name: '', category: x.category, amount: 0, count: 0, latest: '' });
    r.amount += x.amount; r.count++;
    if (x.date >= r.latest) { r.latest = x.date; r.name = displayName(x.note) || x.label || x.category; r.category = x.category; }
  }
  return { total: round2(total), rows: [...g.values()].sort((a, b) => b.amount - a.amount).slice(0, n).map(r => ({ ...r, amount: round2(r.amount), share: total ? r.amount / total : 0 })) };
}

/**
 * Cada categoria do mês contra a média dos `n` meses anteriores. Mês em andamento: compara só até o mesmo dia dos meses anteriores.
 */
export function categoryVsAverage(items, month, now, n = 3) {
  const upto = month === nowKey(now) ? now.getDate() : 31, prevs = Array.from({ length: n }, (_, i) => addMonths(month, -(i + 1)));
  const cur = new Map(), avg = new Map();
  for (const x of items) {
    const m = x.date.slice(0, 7);
    if (m === month) cur.set(x.category, (cur.get(x.category) || 0) + x.amount);
    else if (prevs.includes(m) && +x.date.slice(8, 10) <= upto) avg.set(x.category, (avg.get(x.category) || 0) + x.amount / n);
  }
  return [...new Set([...cur.keys(), ...avg.keys()])].map(category => {
    const c = cur.get(category) || 0, a = avg.get(category) || 0;
    return { category, amount: round2(c), avg: round2(a), diff: round2(c - a) };
  }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}

/** Essencial, flexível e sem tipo por mês, do mais antigo ao mais novo, com meses vazios preenchidos. */
export function needByMonth(items, months, endMonth) {
  const ks = Array.from({ length: months }, (_, i) => addMonths(endMonth, i - months + 1)), m = new Map(ks.map(k => [k, { month: k, essential: 0, flexible: 0, none: 0 }]));
  for (const x of items) { const r = m.get(x.date.slice(0, 7)); if (r) r[x.need === 'essential' || x.need === 'flexible' ? x.need : 'none'] += x.amount; }
  return ks.map(k => { const r = m.get(k); return { month: k, essential: round2(r.essential), flexible: round2(r.flexible), none: round2(r.none) }; });
}

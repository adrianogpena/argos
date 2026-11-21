// Previsão do cartão de crédito: se não houvesse nenhuma compra nova, quais seriam as parcelas e quando a dívida acaba.
// Lógica pura (sem DOM, sem rede). Entrada: registros de `card-statements`. Testada em test/card-forecast.test.mjs.
//
// Regras do banco, conferidas nos extratos reais (2025-11 a 2026-10):
//   parcela "percentual"  = optionPct % do saldo do extrato (já inclui os juros e o selo cobrados nele), mínimo FLOOR
//   parcela "mínimo"      = 20% da parcela percentual (3% do saldo com a opção de 15%), mínimo FLOOR
//   juros do extrato      = (saldo anterior − pagamento) × TAN ÷ 12      (compras do próprio período não rendem juros)
//   selo                  ≈ STAMP_RATIO × juros
// Pagou a parcela do dia 11, o saldo cai; no extrato seguinte entram juros + selo sobre o que sobrou.
import { addMonths } from './expenses-report.js';

export const FLOOR = 10;
export const STAMP_RATIO = 0.1373;
export const MODES = { percent: 'Parcela do banco', min: 'Só o mínimo' };
const r2 = n => Math.round(n * 100) / 100;
const sum = a => a.reduce((s, x) => s + x, 0);
const idx = k => +k.slice(0, 4) * 12 + +k.slice(5, 7);
/** Diferença em meses entre duas chaves AAAA-MM. */
export const monthsBetween = (a, b) => idx(b) - idx(a);

/** Parcela de um saldo B. `pct` = opção de pagamento (15). Nunca passa do saldo. */
export function installment(balance, pct, mode = 'percent') {
  const full = Math.max(FLOOR, balance * pct / 100), p = mode === 'min' ? Math.max(FLOOR, full * 0.2) : full;
  return r2(Math.min(balance, p));
}

/** Proporção selo ÷ juros nos últimos extratos com juros (vem das linhas do cartão: { stmt, interest, stamp }). */
export function stampRatio(charges, n = 6) {
  const rows = charges.filter(c => c.interest > 0).slice(-n), i = sum(rows.map(c => c.interest));
  return i > 0 ? sum(rows.map(c => c.stamp)) / i : STAMP_RATIO;
}

/**
 * Simula as parcelas a partir de um extrato, sem compras novas.
 * Devolve { rows:[{k, month, payment, capital, charges, balanceAfter}], months, end, totalPaid, futureCharges, capped }.
 *   charges = juros+selo+taxas que já estavam no saldo quando essa parcela foi calculada; capital = payment − charges
 *   balanceAfter = o que resta logo depois de pagar (antes dos juros do extrato seguinte)
 *   futureCharges = juros e selo que ainda serão cobrados até quitar (total pago − saldo atual)
 * Null se o extrato não tem dívida.
 */
export function simulate(st, { mode = 'percent', stamp = STAMP_RATIO, maxMonths = 480 } = {}) {
  if (!st || !(st.balance > 0.005)) return null;
  const pct = st.optionPct || 15, r = (st.tan || 0) / 1200, nx = st.next && st.next.total;
  const start = (st.payDate || '').slice(0, 7) || addMonths(st.stmt, 1);
  let bal = st.balance, charges = nx ? r2(nx.interest + nx.stamp + nx.fees) : 0;
  const rows = [];
  for (let k = 1; k <= maxMonths && bal > 0.005; k++) {
    // 1ª parcela: o valor que o próprio extrato informa (percentual = "Total a pagar", mínimo = "Mínimo a pagar").
    const given = k === 1 ? (mode === 'min' ? st.minDue : nx && nx.total) : null;
    const payment = r2(Math.min(bal, given > 0 ? given : installment(bal, pct, mode)));
    const after = r2(bal - payment), interest = after * r, stampAmt = interest * stamp;
    rows.push({ k, month: addMonths(start, k - 1), payment, capital: r2(Math.max(0, payment - charges)), charges: r2(Math.min(charges, payment)), balanceAfter: after });
    charges = r2(interest + stampAmt);
    bal = r2(after + charges);
  }
  const done = bal <= 0.005, totalPaid = r2(sum(rows.map(x => x.payment)));
  return { rows, months: rows.length, end: done ? rows[rows.length - 1].month : null, totalPaid, futureCharges: r2(totalPaid - st.balance), capped: !done, mode };
}

/** Qual parcela o dono pagou no último extrato: 'min', 'percent' ou null (outro valor). Compara com o que o extrato anterior pedia. */
export function paidMode(statements) {
  const s = [...statements].sort((a, b) => a.stmt.localeCompare(b.stmt)), last = s[s.length - 1], prev = s[s.length - 2];
  if (!last || !prev || !last.paid) return null;
  const paid = last.paid.total + (last.paidFractioned ? last.paidFractioned.total : 0), near = (a, b) => b != null && Math.abs(a - b) < 0.02;
  if (near(paid, prev.minDue) && !near(paid, prev.next && prev.next.total && prev.next.total.total)) return 'min';
  if (near(paid, prev.next && prev.next.total && prev.next.total.total)) return 'percent';
  return null;
}

/**
 * Por extrato: o que entrou na dívida (acréscimo = compras + juros + selo + taxas) contra o que saiu (baixa = pagamentos e estornos),
 * e o efeito na parcela e na data de quitação (previsão sem compras novas feita a partir de cada extrato).
 * `detail` = { 'AAAA-MM': { purchases, charges } } vindo de card-lines (opcional; sem ele só há os totais).
 */
export function compare(statements, { mode = 'percent', detail = {}, stamp = STAMP_RATIO } = {}) {
  const s = [...statements].sort((a, b) => a.stmt.localeCompare(b.stmt));
  const sims = s.map(x => simulate(x, { mode, stamp }));
  return s.map((x, i) => {
    const sim = sims[i], prev = i ? sims[i - 1] : null, d = detail[x.stmt] || null, net = r2(x.balance - x.prevBalance);
    return { stmt: x.stmt, prevBalance: x.prevBalance, balance: x.balance, debits: x.debits, credits: x.credits, net, grew: net > 0.005,
      purchases: d ? d.purchases : null, charges: d ? d.charges : null,
      parcela: sim ? sim.rows[0].payment : null, parcelaDelta: sim && prev ? r2(sim.rows[0].payment - prev.rows[0].payment) : null,
      end: sim ? sim.end : null, endDelta: sim && prev && sim.end && prev.end ? monthsBetween(prev.end, sim.end) : null };
  });
}

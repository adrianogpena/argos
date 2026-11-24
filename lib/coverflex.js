// Gastos pagos com o cartão de vale refeição Coverflex. Puro, testado em test/coverflex.test.mjs.
// Entrada: linhas lidas da tela Atividade da Coverflex ({date, amount, desc, kind, category, need, detail}); só as compras viram gasto.
// As cargas (kind 'topup') são o vale que a empresa deposita: não são gasto e não passam pelo banco.
import { bankId, descKey } from './classify.js';
import { expenseRecord } from './expenses-core.js';
import { matchInvoices } from './efatura.js';

/** Registros de `expenses` (source 'coverflex', coverflex: true; label = rótulo do comerciante). Id estável: reimportar sobrescreve o mesmo. */
export function coverflexRecords(rows) {
  const seen = new Map(), records = [], errors = [];
  for (const [i, e] of rows.filter(r => r.kind === 'purchase').entries()) {
    const amount = Math.round(Number(e.amount) * 100) / 100, desc = String(e.desc || '').replace(/\s+/g, ' ').trim();
    const r = expenseRecord({ id: 'v' + bankId(e.date, amount, desc, seen).slice(1), date: e.date, amount, category: e.category, need: e.need, label: e.detail, note: desc, source: 'coverflex', coverflex: true, key: descKey(desc) });
    if (r.ok) records.push(r.rec); else errors.push(`entrada ${i + 1} (${e.date} ${desc}): ${r.error}`);
  }
  return { records, errors };
}

/**
 * Última parte do plano: liga ao gasto da Coverflex as faturas do e-fatura que ainda não têm `expenseId`
 * (mesmo valor, 1 dia antes a 5 depois; só o passo curto, sem a regra larga de 45 dias).
 * Fatura ainda não enviada ganha o `expenseId` no próprio registro de `efatura`; fatura já enviada entra de novo, completa,
 * em `efatura+link` (mesma coleção `efatura`, controle de envio à parte; o envio posta em `efatura`). Idempotente.
 * plan = { colecao: itens[] }, state = { sent: { colecao: [ids] } }. Retorna { plan, direct, resend }.
 */
export function linkCoverflex(plan, state, cfRecords) {
  const sentEf = new Set(state.sent?.efatura || []);
  const already = new Set((plan['efatura+link'] || []).map(x => x.id));
  const open = (plan.efatura || []).filter(r => !r.expenseId && !already.has(r.id));
  const links = matchInvoices(open, cfRecords);
  const direct = [], resend = [];
  const efatura = plan.efatura.map(r => {
    const l = links.get(r.id);
    if (!l || l.tag !== 'p5') return r;
    const rec = { ...r, expenseId: l.xid };
    (sentEf.has(r.id) ? resend : direct).push(rec);
    return sentEf.has(r.id) ? r : rec;
  });
  const link = [...(plan['efatura+link'] || []), ...resend];
  const out = { ...plan, efatura };
  if (link.length) out['efatura+link'] = link;
  return { plan: out, direct, resend };
}

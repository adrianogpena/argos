// Parser do QR fiscal português (A:valor*B:valor*...). Sem DOM nem rede: testado por test/qr-invoice.test.mjs.
import { linkExpenses } from './receipt.js';
const KEY = /^(?:[A-H]|[I-K][1-8]|[L-S])$/;
const NUM = /^-?\d+(?:\.\d+)?$/;
const NUMERIC = k => /^[I-K][2-8]$/.test(k) || /^[LMNOP]$/.test(k);
const cents = v => Math.round(v * 100) / 100;

export class QrError extends Error {}

/** Texto bruto -> campos do QR (valores ainda como texto). Falha com mensagem clara. */
export function splitQr(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw new QrError('QR vazio');
  const fields = {};
  for (const part of text.split('*')) {
    const i = part.indexOf(':');
    if (i < 1) throw new QrError(`Não é um QR fiscal: "${part.slice(0, 20)}"`);
    const k = part.slice(0, i), v = part.slice(i + 1);
    if (!KEY.test(k)) throw new QrError(`Campo desconhecido no QR: ${k}`);
    if (k in fields) throw new QrError(`Campo repetido no QR: ${k}`);
    fields[k] = v;
  }
  return fields;
}

/**
 * Texto bruto -> registro para o cofre (coleção receipt-qr). Lança QrError se faltar A, F, G, H ou O
 * ou se um valor for inválido. totalNet e totalVat ficam null quando o QR não traz o total de IVA (N).
 */
export function parseQr(raw) {
  const f = splitQr(raw);
  for (const k of ['A', 'F', 'G', 'H', 'O']) if (!f[k]) throw new QrError(`Falta o campo obrigatório ${k}`);
  for (const k of Object.keys(f)) if (NUMERIC(k) && f[k] !== '' && !NUM.test(f[k])) throw new QrError(`Valor inválido em ${k}: ${f[k]}`);
  if (!/^\d{9}$/.test(f.A)) throw new QrError('NIF do emitente inválido (A)');
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(f.F);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new QrError(`Data inválida (F): ${f.F}`);
  const total = Number(f.O);
  // IVA: soma dos campos de IVA por taxa (I4, I6, I8; J e K nas regiões autónomas); alguns emitentes põem em N a soma das bases, não o IVA.
  const rate = Object.keys(f).filter(k => /^[I-K][468]$/.test(k) && f[k] !== '');
  const vat = rate.length ? cents(rate.reduce((t, k) => t + Number(f[k]), 0)) : f.N ? Number(f.N) : null;
  return {
    id: `${f.A}-${f.H}`,
    nif: f.A,
    date: `${m[1]}-${m[2]}-${m[3]}`,
    type: f.D || null,
    number: f.G,
    atcud: f.H,
    totalNet: vat == null ? null : cents(total - vat),
    totalVat: vat,
    total: cents(total),
    raw: String(raw).trim(),
  };
}

/**
 * Liga faturas do QR (id, date, total) a lançamentos de Gastos com o mesmo valor, de 0 a 5 dias (mesma regra das faturas com itens).
 * `taken` = ids de lançamentos já ligados a outra fatura (receipts ou receipt-qr); o vínculo existente (`expenseId`) é mantido.
 * Devolve Map id da fatura -> lançamento.
 */
export function linkQr(qrs, expenses, taken = []) {
  const used = new Set([...taken, ...qrs.map(q => q.expenseId).filter(Boolean)]);
  const byId = new Map(expenses.map(e => [e.id, e]));
  const out = new Map();
  for (const q of qrs) if (q.expenseId && byId.has(q.expenseId)) out.set(q.id, byId.get(q.expenseId));
  const open = qrs.filter(q => !q.expenseId || !byId.has(q.expenseId));
  const { pairs } = linkExpenses(open.map(q => ({ id: q.id, date: q.date, paid: q.total })), expenses.filter(e => !used.has(e.id)));
  for (const p of pairs) out.set(p.receiptId, byId.get(p.expenseId));
  return out;
}

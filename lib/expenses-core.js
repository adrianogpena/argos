// Pure logic for the expenses module. No DOM, no network: tested by test/expenses.test.mjs.
import { parseNum } from './car-core.js';

export const DEFAULT_CATEGORIES = ['Moradia', 'Contas', 'Mercado', 'Restaurantes', 'Transporte', 'Saúde', 'Seguros', 'Impostos', 'Lazer', 'Assinaturas', 'Educação', 'Outros'];

/** Rótulo livre e curto que detalha a categoria (Transporte → Combustível). Vazio = sem rótulo. */
export const cleanLabel = l => String(l ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);

export function expenseRecord(e) {
  const rec = { id: e.id, date: String(e.date || ''), amount: parseNum(e.amount), category: String(e.category || '').trim().slice(0, 40), note: String(e.note || '').trim().slice(0, 120) };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.date)) return { ok: false, error: 'date' };
  if (!(rec.amount > 0 && rec.amount < 1e7)) return { ok: false, error: 'amount' };
  if (!rec.category) return { ok: false, error: 'category' };
  // Campos do extrato: tipo (essencial/flexível), origem, "auto" (palpite ainda não confirmado) e a chave do comerciante.
  rec.need = e.need === 'essential' || e.need === 'flexible' ? e.need : '';
  if (e.source) rec.source = String(e.source).slice(0, 12);
  if (e.auto) rec.auto = true;
  if (e.key) rec.key = String(e.key).slice(0, 40);
  if (e.auto && e.motivo) rec.motivo = String(e.motivo).slice(0, 30);   // por que a dúvida (só enquanto pendente)
  const label = cleanLabel(e.label); if (label) rec.label = label;
  // Gasto do cartão de crédito (source 'card'): `inst` = parcelamento: n = parcela a que se refere (0 = a compra), of = total de parcelas,
  // left = quanto da compra ainda falta pagar depois dessa parcela, last = última cobrança desse tipo.
  if (e.card) rec.card = true;
  if (e.inst && typeof e.inst === 'object') {
    const of = Math.round(Number(e.inst.of)), n = Math.round(Number(e.inst.n)), left = Number(e.inst.left);
    if (of >= 1 && of <= 120 && n >= 0 && n <= of) rec.inst = { of, n, ...(Number.isFinite(left) && left >= 0 && { left: Math.round(left * 100) / 100 }), ...(e.inst.last && { last: true }) };
  }
  return { ok: true, rec };
}

/** Essencial, flexível e sem tipo definido, no mês. */
export function needSplit(items, month) {
  const out = { essential: 0, flexible: 0, none: 0 };
  for (const x of items) if (x.date.startsWith(month)) out[x.need === 'essential' || x.need === 'flexible' ? x.need : 'none'] += x.amount;
  return out;
}

/** Totals per month, oldest first, with empty months filled in between so the time axis is honest. */
export function monthly(items, months = 12, now = new Date()) {
  const totals = new Map();
  for (const x of items) { const k = x.date.slice(0, 7); totals.set(k, (totals.get(k) || 0) + x.amount); }
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    out.push({ month: k, total: totals.get(k) || 0 });
  }
  return out;
}

/** One month broken down by category, largest first. month = 'YYYY-MM', or null for everything. */
export function byCategory(items, month) {
  const m = new Map();
  for (const x of items) if (!month || x.date.startsWith(month)) m.set(x.category, (m.get(x.category) || 0) + x.amount);
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ category, amount, share: total ? amount / total : 0 }));
}

export const monthTotal = (items, month) => items.filter(x => x.date.startsWith(month)).reduce((s, x) => s + x.amount, 0);

/** Change against the previous month, as a fraction; null when there is nothing to compare. */
export function delta(items, month) {
  const [y, m] = month.split('-').map(Number);
  const pd = new Date(y, m - 2, 1), prev = pd.getFullYear() + '-' + String(pd.getMonth() + 1).padStart(2, '0');
  const p = monthTotal(items, prev), c = monthTotal(items, month);
  return p ? (c - p) / p : null;
}

export const categoriesIn = (items, extra = DEFAULT_CATEGORIES) => [...new Set([...extra, ...items.map(x => x.category)])];

const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Opções do dropdown de categoria: padrões + as já usadas, sem repetir por caixa/acento ("mercado" = "Mercado"),
 * sem "Sem categoria", em ordem alfabética. `Outros` vai por último.
 */
export function categoryOptions(items, extra = DEFAULT_CATEGORIES) {
  const seen = new Map();
  for (const c of [...extra, ...items.map(x => x.category)]) {
    const name = String(c ?? '').trim(), k = fold(name);
    if (name && k !== 'sem categoria' && !seen.has(k)) seen.set(k, name);
  }
  return [...seen.values()].sort((a, b) => (fold(a) === 'outros') - (fold(b) === 'outros') || a.localeCompare(b, 'pt'));
}

/** Nome digitado para uma categoria nova: se já existe (ignorando caixa/acento), devolve a grafia existente. */
export function canonicalCategory(name, options) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40), k = fold(n);
  return options.find(o => fold(o) === k) || n;
}

/** Categoria e, dentro dela, rótulo (sem rótulo = ""), no mês (ou tudo, com month=null). Maiores primeiro. */
export function byLabel(items, month) {
  const cats = new Map();
  for (const x of items) {
    if (month && !x.date.startsWith(month)) continue;
    const c = cats.get(x.category) || { category: x.category, amount: 0, labels: new Map() };
    c.amount += x.amount; const l = cleanLabel(x.label); c.labels.set(l, (c.labels.get(l) || 0) + x.amount); cats.set(x.category, c);
  }
  return [...cats.values()].sort((a, b) => b.amount - a.amount)
    .map(c => ({ category: c.category, amount: c.amount, labels: [...c.labels].sort((a, b) => b[1] - a[1]).map(([label, amount]) => ({ label, amount })) }));
}

/** Rótulos já usados, para sugerir no formulário (os da categoria dada primeiro). */
export function labelOptions(items, category) {
  const seen = new Map();
  for (const x of items) { const l = cleanLabel(x.label); if (!l) continue; const v = seen.get(l) || { n: 0, cat: false }; v.n++; if (x.category === category) v.cat = true; seen.set(l, v); }
  return [...seen].sort((a, b) => (b[1].cat - a[1].cat) || (b[1].n - a[1].n) || a[0].localeCompare(b[0], 'pt')).map(([l]) => l);
}

/** Texto curto do parcelamento de um gasto do cartão: "Parcela 2/6 · faltam 133,56 €", "Última parcela" ou "Compra em 6x". */
export function instText(inst, fmt = n => n.toFixed(2).replace('.', ',') + ' €') {
  if (!inst) return '';
  if (inst.last) return `Última parcela (${inst.n}/${inst.of}) · quitado`;
  if (!inst.n) return `Compra em ${inst.of}x${inst.left != null ? ' · faltam ' + fmt(inst.left) : ''}`;
  return `Parcela ${inst.n}/${inst.of}${inst.left != null ? ' · faltam ' + fmt(inst.left) : ''}`;
}

// Pure logic for the expenses module. No DOM, no network: tested by test/expenses.test.mjs.
import { parseNum } from './car-core.js';

export const DEFAULT_CATEGORIES = ['Moradia', 'Contas', 'Mercado', 'Restaurantes', 'Transporte', 'Saúde', 'Seguros', 'Impostos', 'Lazer', 'Assinaturas', 'Educação', 'Outros'];

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

// Chave de comerciante e ids dos gastos vindos do extrato. Puro, testado em test/classify.test.mjs.
// Quem lê o extrato e classifica é o Claude (skill `importar-extrato`); aqui só ficam as regras determinísticas
// que a página (regras aprendidas) e o script tools/expenses.mjs compartilham.

import { cleanLabel } from './expenses-core.js';

export const UNCAT = 'Sem categoria';
export const NEEDS = { essential: 'Essencial', flexible: 'Flexível' };

const STOP = new Set(['compra', 'compras', 'pagamento', 'pag', 'pagto', 'pos', 'mbway', 'mb', 'way', 'transf', 'transferencia', 'cartao', 'card', 'purchase', 'sepa', 'dd', 'debito', 'direto', 'ref', 'referencia', 'de', 'da', 'do', 'dos', 'das', 'em', 'a', 'e', 'o', 'the', 'servicos', 'servico', 'sa', 'lda', 'unipessoal', 'portugal', 'pt']);

export const plain = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Chave estável de um comerciante: tira acentos, números, datas e palavras de banco; guarda as 3 primeiras palavras. */
export function descKey(desc) {
  const words = plain(desc).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w && !/\d/.test(w) && !STOP.has(w) && w.length > 1);
  return words.slice(0, 3).join('-').slice(0, 40) || 'sem-descricao';
}

// FNV-1a de 32 bits em base 36: curto e estável.
const hash = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };

/**
 * Id determinístico de um lançamento do extrato: data + valor + descrição (e a ordem, se houver idênticos no mesmo dia).
 * `seen` = Map que o chamador reaproveita ao longo do arquivo. Reimportar o mesmo lançamento gera o mesmo id.
 */
export function bankId(date, amount, desc, seen = new Map()) {
  const norm = plain(desc).replace(/\s+/g, ' ').trim();
  const base = `${date}|${Math.round(amount * 100) / 100}|${norm}`, n = (seen.get(base) || 0) + 1; seen.set(base, n);
  return `b${date.replace(/-/g, '')}-${hash(base)}${n}`;
}

/**
 * Entradas do Claude [{date, amount (positivo), desc, category, need?}] -> registros de `expenses`.
 * Regra aprendida (`learned`: Map chave -> {category, need}) vence o palpite; só o palpite fica `auto` (para revisar).
 * Regra com `skip` (não é gasto: poupança, transferência própria...) descarta o lançamento. Quem já existe (`existingIds`) é pulado, para nunca sobrescrever uma edição do dono.
 */
export function buildRecords(entries, existingIds = new Set(), learned = new Map()) {
  const seen = new Map(), records = [], errors = [];
  let duplicates = 0, skipped = 0;
  entries.forEach((e, i) => {
    const amount = Math.round(Number(e.amount) * 100) / 100, date = String(e.date || ''), desc = String(e.desc || '').replace(/\s+/g, ' ').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(amount > 0) || !desc) { errors.push(`entrada ${i + 1}: data, valor (positivo) e desc são obrigatórios`); return; }
    const id = bankId(date, amount, desc, seen);
    const l = learned.get(descKey(desc));
    if (l && l.skip) { skipped++; return; }
    if (existingIds.has(id)) { duplicates++; return; }
    const key = descKey(desc);
    const category = (l ? l.category : String(e.category || '').trim()) || UNCAT;
    const need = l ? (l.need || '') : (e.need === 'essential' || e.need === 'flexible' ? e.need : '');
    const label = cleanLabel(l ? l.tag : e.label);   // rótulo aprendido (regra.tag) vence o palpite
    records.push({ id, date, amount, category: category.slice(0, 40), note: desc.slice(0, 120), need, source: 'bank', auto: !l, key, ...(label && { label }) });
  });
  return { records, duplicates, skipped, errors };
}

// Chaves genéricas demais para virar regra (juntariam comerciantes diferentes): decidir lançamento a lançamento, na tela.
export const GENERIC_KEYS = new Set(['sem-descricao', 'trf']);

/** Gastos agrupados por chave de comerciante, maiores primeiro: [{key, n, total, category, need, label, example, from, to}]. onlyAuto = só os pendentes. */
export function merchantGroups(expenses, onlyAuto = false) {
  const g = new Map();
  for (const x of expenses) {
    if (onlyAuto && !x.auto) continue;
    const k = x.key || descKey(x.note), v = g.get(k) || { key: k, n: 0, total: 0, category: x.category, need: x.need || '', label: x.label || '', example: x.note, from: x.date, to: x.date };
    v.n++; v.total = Math.round((v.total + x.amount) * 100) / 100; if (x.date < v.from) v.from = x.date; if (x.date > v.to) v.to = x.date;
    g.set(k, v);
  }
  return [...g.values()].sort((a, b) => b.total - a.total);
}
/** Pendentes (auto) agrupados por chave de comerciante. */
export const pendingGroups = expenses => merchantGroups(expenses, true);

const tagOf = l => { const t = cleanLabel(l); return t ? { tag: t } : {}; };

/**
 * Aplica decisões do Claude sobre os gastos pendentes (auto). decisions = [{key, category, need?, label?, confirm}].
 * confirm:true  -> categoria/tipo definitivos: tira `auto` e vira regra aprendida (vale nas próximas importações).
 * confirm:false -> corrige o palpite mas continua "revisar" para o dono (dúvida), sem regra.
 * Só mexe em lançamentos ainda `auto`; o que o dono confirmou nunca é alterado. `canon(nome)` normaliza a grafia da categoria.
 * Devolve { updates (registros completos), rules, confirmed, doubtful, untouched, errors }.
 */
export function applyDecisions(expenses, decisions, canon = c => c) {
  const updates = [], rules = [], errors = []; let confirmed = 0, doubtful = 0;
  for (const d of decisions) {
    const key = String(d.key || ''), category = canon(String(d.category || '').trim());
    if (!key || !category || category === UNCAT) { errors.push(`${key || '?'}: falta chave ou categoria`); continue; }
    if (GENERIC_KEYS.has(key)) { errors.push(`${key}: chave genérica demais; o dono decide na tela`); continue; }
    const hit = expenses.filter(x => x.auto && (x.key || descKey(x.note)) === key);
    if (!hit.length) { errors.push(`${key}: nenhum lançamento pendente com essa chave`); continue; }
    const need = d.need === 'essential' || d.need === 'flexible' ? d.need : (d.need === '' ? '' : null);
    for (const x of hit) {
      const { auto, ...rest } = x;
      const r = { ...rest, category, need: need === null ? (x.need || '') : need, key };
      if (d.label !== undefined) { const l = cleanLabel(d.label); if (l) r.label = l; else delete r.label; }
      if (!d.confirm) r.auto = true;
      updates.push(r);
    }
    if (d.confirm) { confirmed += hit.length; rules.push({ id: key, category, need: need === null ? (hit[0].need || '') : need, label: String(hit[0].note).slice(0, 60), ...tagOf(d.label !== undefined ? d.label : hit[0].label) }); }
    else doubtful += hit.length;
  }
  return { updates, rules, confirmed, doubtful, errors };
}

/**
 * Rotula gastos já gravados (qualquer estado), sem mexer em categoria, tipo nem `auto`.
 * decisions = [{key, label}] (todos os lançamentos do comerciante) ou [{id, label}] (um só, p. ex. transferências); label '' remove.
 * `rules` = Map chave -> regra existente: a regra da chave ganha `tag` (vale nas próximas importações). Sem regra, só cria uma
 * se os lançamentos já foram confirmados pelo dono (palpite nunca vira regra por aqui).
 * Devolve { updates, rules, labeled, errors }.
 */
export function applyLabels(expenses, decisions, rules = new Map()) {
  const updates = [], ruleOut = new Map(), errors = []; let labeled = 0;
  for (const d of decisions) {
    if (d.label === undefined) { errors.push(`${d.key || d.id || '?'}: falta label`); continue; }
    const label = cleanLabel(d.label);
    const hit = d.id ? expenses.filter(x => x.id === d.id) : d.key ? expenses.filter(x => (x.key || descKey(x.note)) === d.key) : [];
    if (!hit.length) { errors.push(`${d.id || d.key || '?'}: nenhum lançamento encontrado`); continue; }
    for (const x of hit) { const r = { ...x }; if (label) r.label = label; else delete r.label; updates.push(r); labeled++; }
    if (d.key && !d.id && !GENERIC_KEYS.has(d.key)) {
      const ex = rules.get(d.key);
      if (ex && !ex.skip) { const { tag, ...rest } = ex; ruleOut.set(d.key, label ? { ...rest, tag: label } : rest); }
      else if (!ex && hit.every(x => !x.auto) && hit[0].category !== UNCAT) ruleOut.set(d.key, { id: d.key, category: hit[0].category, need: hit[0].need || '', label: String(hit[0].note).slice(0, 60), ...(label && { tag: label }) });
    }
  }
  return { updates, rules: [...ruleOut.values()], labeled, errors };
}

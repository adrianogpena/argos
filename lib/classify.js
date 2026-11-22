// Chave de comerciante e ids dos gastos vindos do extrato. Puro, testado em test/classify.test.mjs.
// Quem lê o extrato e classifica é o Claude (skill `importar-extrato`); aqui só ficam as regras determinísticas
// que a página (regras aprendidas) e o script tools/expenses.mjs compartilham.

import { cleanLabel } from './expenses-core.js';

export const UNCAT = 'Sem categoria';
export const NEEDS = { essential: 'Essencial', flexible: 'Flexível' };

const STOP = new Set(['compra', 'compras', 'pagamento', 'pag', 'pagto', 'pos', 'mbway', 'mb', 'way', 'transf', 'transferencia', 'cartao', 'card', 'purchase', 'sepa', 'dd', 'debito', 'direto', 'ref', 'referencia', 'de', 'da', 'do', 'dos', 'das', 'em', 'a', 'e', 'o', 'the', 'servicos', 'servico', 'sa', 'lda', 'unipessoal', 'portugal', 'pt']);

export const plain = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Textos do banco que são o mesmo comerciante com outro nome. "730-CARVALHOS 2238 -V N..." é o Pingo Doce de Carvalhos (loja 730, confirmado nas faturas).
const ALIAS = [[/\b730-carvalhos\b/, 'pingo-doce-nv']];

/** Chave estável de um comerciante: tira acentos, números, datas e palavras de banco; guarda as 3 primeiras palavras. */
export function descKey(desc) {
  const alias = ALIAS.find(([re]) => re.test(plain(desc)));
  if (alias) return alias[1];
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

// Motivos de dúvida (campo `motivo` do gasto pendente): por que a Claude não confirmou. Servem para filtrar o que sobra para o dono.
export const MOTIVOS = ['intermediário', 'pessoa', 'busca-sem-resultado', 'exterior', 'homónimos', 'ramo-ambíguo'];
const MOTIVO_BY_PLAIN = new Map(MOTIVOS.map(m => [plain(m), m]));
export const canonMotivo = m => MOTIVO_BY_PLAIN.get(plain(m).trim()) || '';

// Intermediários de pagamento: o nome não diz o que foi comprado. Nunca se confirma (política do dono).
const INTERMEDIARY = new Set(['hipay', 'ifthenpay', 'buyon', 'eupago', 'easypay', 'paypal', 'stripe', 'payshop']);
export const isIntermediary = key => String(key).split('-').some(w => INTERMEDIARY.has(w));

// Primeiras palavras que não identificam um comerciante sozinhas: não unificam chaves.
const NO_MERGE = new Set(['google', 'sumup', 'serv', 'trf', 'https', 'http', 'www', 'paypal', 'mbway', 'restaurante', 'pastelaria', 'supermercado', 'minimercado', 'quiosque', 'centro', 'padaria', 'farmacia', 'talho', 'snack', 'cafe', 'bar', 'loja', 'mercado', 'casa', 'grupo']);

/**
 * Unifica chaves do mesmo comerciante que `descKey` separa por localidade ou sufixo truncado (ex.: `expoente-pedros` e
 * `expoente-contactless`). NÃO muda `descKey`, ids nem regras: é só um agrupamento de leitura/decisão.
 * Une duas chaves quando: (a) a 1ª palavra é igual (>= 6 letras, fora de NO_MERGE) ou as 2 primeiras são iguais;
 * (b) a 1ª palavra de uma é prefixo da outra (>= 7 letras: nome truncado pelo banco). Devolve Map chave -> id do grupo
 * (a menor 1ª palavra do grupo; chave sozinha = ela mesma).
 */
export function keyGroups(keys) {
  const uniq = [...new Set(keys)].sort(), parent = new Map(uniq.map(k => [k, k]));
  const find = k => { while (parent.get(k) !== k) k = parent.get(k); return k; };
  for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) {
    const a = uniq[i].split('-'), b = uniq[j].split('-');
    if (NO_MERGE.has(a[0]) || NO_MERGE.has(b[0])) continue;
    const [s, l] = a[0].length <= b[0].length ? [a[0], b[0]] : [b[0], a[0]];
    const same = a[0] === b[0] ? (a[0].length >= 6 || (a[1] && a[1] === b[1])) : (s.length >= 7 && l.startsWith(s));
    if (same) parent.set(find(uniq[i]), find(uniq[j]));
  }
  const members = new Map(); for (const k of uniq) { const r = find(k); (members.get(r) || members.set(r, []).get(r)).push(k); }
  const out = new Map();
  for (const ks of members.values()) {
    const id = ks.length === 1 ? ks[0] : ks.map(k => k.split('-')[0]).sort((x, y) => x.length - y.length || (x < y ? -1 : 1))[0];
    for (const k of ks) out.set(k, id);
  }
  return out;
}

const rawKey = x => x.key || descKey(x.note);

/**
 * Gastos agrupados por comerciante, maiores primeiro: [{key, keys, n, total, avg, category, need, label, motivo, example, from, to, mixed}].
 * onlyAuto = só os pendentes. opts.merge = unifica chaves parecidas (keyGroups, calculado sobre TODOS os pendentes, para o id do
 * grupo não depender do filtro); opts.month = AAAA-MM, conta só os lançamentos do mês.
 */
export function merchantGroups(expenses, onlyAuto = false, { merge = false, month = '' } = {}) {
  const pool = onlyAuto ? expenses.filter(x => x.auto) : expenses;
  const gm = merge ? keyGroups(pool.map(rawKey)) : null;
  const g = new Map();
  for (const x of pool) {
    if (month && !x.date.startsWith(month)) continue;
    const raw = rawKey(x), k = gm ? gm.get(raw) : raw;
    const v = g.get(k) || { key: k, keys: new Set(), n: 0, total: 0, category: x.category, need: x.need || '', label: x.label || '', motivo: '', example: x.note, from: x.date, to: x.date, mixed: false };
    v.keys.add(raw); v.n++; v.total = Math.round((v.total + x.amount) * 100) / 100; if (x.date < v.from) v.from = x.date; if (x.date > v.to) v.to = x.date;
    if (x.category !== v.category) v.mixed = true;
    if (!v.motivo && x.motivo) v.motivo = x.motivo;
    g.set(k, v);
  }
  return [...g.values()].map(v => ({ ...v, keys: [...v.keys].sort(), avg: Math.round(v.total / v.n * 100) / 100 })).sort((a, b) => b.total - a.total);
}
/** Pendentes (auto) agrupados por comerciante (opts: merge, month). */
export const pendingGroups = (expenses, opts) => merchantGroups(expenses, true, opts);

/** Nome legível do comerciante a partir do texto do banco (sem "COMPRA 5061", "CONTACTLESS", números), para exibir e pesquisar. */
export function displayName(note) {
  return String(note ?? '').replace(/^\s*(COMPRA|PAG\s+SERV|PAGAMENTO|PAG|TRF\s*P\/|MB\s*WAY)\s+/i, '').replace(/\bCONTACTLESS\b/gi, ' ')
    .replace(/\d{4}-\d{1,3}/g, ' ').replace(/[\d/]+/g, ' ').replace(/[,;*]+/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Link de busca pronto para o dono pesquisar o estabelecimento (só o nome limpo; nunca valores nem datas). */
export const searchUrl = name => 'https://www.google.com/search?q=' + encodeURIComponent(name).replace(/%20/g, '+');

// Ramo que o PRÓPRIO texto do banco declara (alta confiança, sem busca). [regex, categoria, tipo, rótulo]
const BRANCH = [
  [/\b(restaurante|churrasqueira|pizzaria|tasca|tasquinha|marisqueira|taberna|cervejaria|bistro|sushi|grill)\b/, 'Restaurantes', 'flexible', 'Restaurante'],
  [/\b(cafe|cafetaria|pastelaria|padaria|gelataria|geladaria|snack[- ]?bar)\b/, 'Restaurantes', 'flexible', 'Café'],
  [/\b(supermercado|minimercado|mini[- ]mercado|hipermercado)\b/, 'Mercado', 'essential', 'Supermercado'],
  [/\b(farmacia|parafarmacia)\b/, 'Saúde', 'essential', 'Farmácia'],
  [/\b(talho|peixaria)\b/, 'Mercado', 'essential', 'Talho/Peixaria'],
  [/\b(taxa|imposto|direccao geral)\b/, 'Impostos', 'essential', 'Taxas'],
];
/** Ramo declarado no texto do banco: {category, need, label} ou null. Intermediários e transferências para pessoas nunca entram. */
export function inferBranch(note, key = descKey(note)) {
  if (isIntermediary(key) || GENERIC_KEYS.has(key)) return null;
  const t = plain(note);
  for (const [re, category, need, label] of BRANCH) if (re.test(t)) return { category, need, label };
  return null;
}

/** Sinal de recorrência (apoio, nunca critério único): mesmo comerciante, valor baixo e frequente => café/lanche. */
export const recurrenceHint = g => g.n >= 3 && g.avg <= 8 ? 'recorrente-baixo (café/lanche?)' : '';

const tagOf = l => { const t = cleanLabel(l); return t ? { tag: t } : {}; };

/**
 * Aplica decisões do Claude sobre os gastos pendentes (auto). decisions = [{key, keys?, category, need?, label?, confirm, motivo?}].
 * `key` = chave crua do comerciante OU id de grupo de `keyGroups` (aplica a todas as chaves do grupo); `keys` = lista explícita de
 * chaves cruas (para unir o que a heurística não uniu). Cada chave crua confirmada vira uma regra (as importações futuras usam descKey).
 * confirm:true  -> categoria/tipo definitivos: tira `auto` e `motivo` e vira regra aprendida.
 * confirm:false -> corrige o palpite mas continua "revisar" para o dono (dúvida), sem regra; `motivo` (MOTIVOS) diz por quê.
 * Política: intermediário de pagamento e chave genérica (transferência) só se confirmam como `Outros` (a genérica não vira regra); decisão com `motivo` nunca é confirmada (motivo = dúvida por definição).
 * Só mexe em lançamentos ainda `auto`; o que o dono confirmou nunca é alterado. `canon(nome)` normaliza a grafia da categoria.
 * Devolve { updates (registros completos), rules, confirmed, doubtful, byMotivo, errors, warnings }.
 */
export function applyDecisions(expenses, decisions, canon = c => c) {
  const updates = [], rules = [], errors = [], warnings = [], byMotivo = {}; let confirmed = 0, doubtful = 0;
  const gm = keyGroups(expenses.filter(x => x.auto).map(rawKey));
  for (const d of decisions) {
    const key = String(d.key || ''), category = canon(String(d.category || '').trim());
    if (!key || !category || category === UNCAT) { errors.push(`${key || '?'}: falta chave ou categoria`); continue; }
    const outros = d.confirm && category === 'Outros';   // "não dá para descobrir": Outros confirmado vale até para intermediário e chave genérica
    if (GENERIC_KEYS.has(key) && !outros) { errors.push(`${key}: chave genérica demais; só se resolve como Outros (confirm:true)`); continue; }
    const motivo = d.motivo === undefined || d.motivo === '' ? '' : canonMotivo(d.motivo);
    if (d.motivo && !motivo) { errors.push(`${key}: motivo inválido "${d.motivo}" (use ${MOTIVOS.join(' | ')})`); continue; }
    if (d.confirm && motivo) { errors.push(`${key}: motivo "${motivo}" significa dúvida; não pode vir com confirm:true`); continue; }
    const extra = Array.isArray(d.keys) ? d.keys.map(String) : [];
    const want = new Set([key, ...extra]);
    const hit = expenses.filter(x => { if (!x.auto) return false; const r = rawKey(x); return want.has(r) || want.has(gm.get(r)); });
    if (!hit.length) { errors.push(`${key}: nenhum lançamento pendente com essa chave`); continue; }
    const rawKeys = [...new Set(hit.map(rawKey))];
    if (d.confirm && !outros) { const bad = rawKeys.find(k => GENERIC_KEYS.has(k) || isIntermediary(k)); if (bad) { errors.push(`${bad}: intermediário/chave genérica só se confirma como Outros`); continue; } }
    if (!d.confirm && !motivo) warnings.push(`${key}: dúvida sem motivo (informe um de ${MOTIVOS.join(' | ')})`);
    const need = d.need === 'essential' || d.need === 'flexible' ? d.need : (d.need === '' ? '' : null);
    for (const x of hit) {
      const { auto, motivo: _m, ...rest } = x;
      const r = { ...rest, category, need: need === null ? (x.need || '') : need, key: rawKey(x) };
      if (d.label !== undefined) { const l = cleanLabel(d.label); if (l) r.label = l; else delete r.label; }
      if (!d.confirm) { r.auto = true; if (motivo) r.motivo = motivo; }
      updates.push(r);
    }
    if (d.confirm) {
      confirmed += hit.length;
      for (const k of rawKeys) { if (GENERIC_KEYS.has(k)) continue;   // chave genérica: confirma os lançamentos, mas não vira regra
        const first = hit.find(x => rawKey(x) === k); rules.push({ id: k, category, need: need === null ? (first.need || '') : need, label: String(first.note).slice(0, 60), ...tagOf(d.label !== undefined ? d.label : first.label) }); }
    } else { doubtful += hit.length; const m = motivo || '(sem motivo)'; byMotivo[m] = (byMotivo[m] || 0) + hit.length; }
  }
  return { updates, rules, confirmed, doubtful, byMotivo, errors, warnings };
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

// Faturas de supermercado (Pingo Doce e Intermarché), lidas do PDF com `pdftotext -raw`.
// Lógica pura: parser, categorias dos produtos, conferência, vínculo com Gastos e decomposição preço x quantidade.
// Gravação em `receipts` (1 por fatura) e `receipt-lines` (1 por item) via tools/receipts.mjs. Dados reais nunca entram no git.
import { plain, bankId } from './classify.js';

export const UNCAT = 'Sem categoria';
const r2 = n => Math.round(n * 100) / 100;
const num = s => parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
const lines = t => String(t || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

/* ---------- categorias dos produtos (palpite por nome; essencial = comida básica, higiene, limpeza e bicho) ---------- */
export const NEED_OF = {
  'Mercearia': 'essential', 'Pão': 'essential', 'Lácteos e ovos': 'essential', 'Carnes e charcutaria': 'essential',
  'Frutas e vegetais': 'essential', 'Água': 'essential', 'Higiene e limpeza': 'essential', 'Animais': 'essential',
  'Refrigerantes': 'flexible', 'Sumos e néctares': 'flexible', 'Doces e snacks': 'flexible', 'Pastelaria e salgados': 'flexible',
  'Refeições prontas': 'flexible', 'Refeições na loja': 'flexible', 'Lazer e brinquedos': 'flexible', 'Casa e bazar': 'flexible',
  'Depósitos e sacos': 'flexible', 'Bebidas': 'flexible',
};
// Ordem importa: a primeira regra que casa vence (regras sobre o nome sem acento e em minúsculas).
const RULES = [
  [/sandalia|phalaenopsis|bouquet|\bramo\b/, 'Casa e bazar'],
  [/abrilhantador|autoclismo|\bamb wc|det\.maq|esc\.dentes|dent\.pasta|gel b\.|deo roll|p\.hig/, 'Higiene e limpeza'],
  [/suspiro|queque|little bites|tuesti|cheesy|\blay'?s|sobremesa/, 'Doces e snacks'],
  [/ref\.c\//, 'Refrigerantes'],
  [/ficelle|\btosta|cacetinho/, 'Pão'],
  [/suculento|jardineira|sals\./, 'Carnes e charcutaria'],
  [/\bnata\b|queijinho/, 'Lácteos e ovos'],
  [/gengibre/, 'Frutas e vegetais'],
  [/noodles|\bmel\b|cereal/, 'Mercearia'],
  [/deposito|saco saida|saco plastico|\bsacos?\b/, 'Depósitos e sacos'],
  [/\bjogo\b|brinquedo|puzzle|\bbola\b/, 'Lazer e brinquedos'],
  [/esteri|activpet|\bpet\b|racao|areia gato|gato|\bcao\b/, 'Animais'],
  [/pasta col|champo|papel hig|pap hig|\bguard|guardanap|deterg|lixivia|bicarbonato|amaciador|esponja|sabonete|gel banho|fralda|lava loica|desinfet/, 'Higiene e limpeza'],
  [/vinagre|azeite|\boleo\b/, 'Mercearia'],
  [/cola|pepsi|fanta|sprite|ice tea|limonada|sumol|schweppes/, 'Refrigerantes'],
  [/compal|nectar|\bsumo\b|t\.fruit|\bt fruit/, 'Sumos e néctares'],
  [/\bagua\b|agua /, 'Água'],
  [/\bpiz|lasan|bolon|nuggets|hamburg/, 'Refeições prontas'],
  [/pao de queijo|chausson|brioche|dawnuts|extra fofos|pandorino|chapela|merenda|bolinha|almofadinha|coxinha|quiche|\bbite\b|salgado|croissant|pastel de/, 'Pastelaria e salgados'],
  [/chocolate|\bchoc\b|choc\.|milka|mousse|natas do ceu|serradura|cheetos|snack|aperitivo|3d.?s|\btuc\b|cracker|pavesi|bolacha|pipoca|\bdoce\b|gelado|rebucad|bombom|batatas fritas|\bbol\./, 'Doces e snacks'],
  [/\bpao\b|baguete|molete|\bbroa\b|gemeos|brasileiro/, 'Pão'],
  [/\blt\b|\blei\b|leite|manteiga|\bmant\b|queijo|\bqj\b|iogurte|\biog\b|natas|requeij|\bovos?\b/, 'Lácteos e ovos'],
  [/frango|bife|vitelao|novilho|salsicha|fiambre|chourico|presunto|carne|bacon|\bperu\b|porco|almondega|atum|peixe|bacalhau|camarao|polvo/, 'Carnes e charcutaria'],
  [/\buva|\bmaca\b|kiwi|limao|clementina|\btom\b|tomate|cebola|dentes de alho|\balho\b|batata|cenoura|\bsalsa\b|brocolo|alface|banana|laranja|\bpera\b|morango|couve|abobora|pepino|pimento|meloes?|ananas/, 'Frutas e vegetais'],
  [/mas |massa|spaghet|esparguete|arroz|feijao|milho|ketchup|\bmaio\b|maionese|molho|farinha|acucar|\bsal\b|\bcafe\b|caldo|corn fl|cereais|argolinhas|sopa|grao|lentilha|atum/, 'Mercearia'],
];
const SECTION = {
  'RESTAURAÇÃO': 'Refeições na loja', 'TAKE-AWAY': 'Refeições na loja',
  'LEITE': 'Lácteos e ovos', 'PRODUTOS LACTEOS': 'Lácteos e ovos', 'QUEIJOS': 'Lácteos e ovos', 'OVOS': 'Lácteos e ovos',
  'TALHO': 'Carnes e charcutaria', 'CHARCUTARIA': 'Carnes e charcutaria', 'PEIXARIA': 'Carnes e charcutaria',
  'FRUTAS E VEGETAIS': 'Frutas e vegetais', 'PADARIA/PASTELARIA': 'Pastelaria e salgados', 'MERCEARIA + PET FOOD': 'Mercearia',
  'BEBIDAS': 'Bebidas', 'PRONTO A COMER': 'Refeições prontas', 'CONGELADOS': 'Refeições prontas',
  'PRODUTOS PESSOAIS': 'Higiene e limpeza', 'DETERG. E PROD. LIMPEZA': 'Higiene e limpeza', 'BAZAR': 'Casa e bazar', 'SERVICOS': 'Lazer e brinquedos',
  'DEPÓSITO VOLTA': 'Depósitos e sacos',
};
/** Categoria e tipo (essential|flexible) de um item pelo nome e pela seção da loja. Sem palpite: UNCAT e tipo vazio. */
export function categorize(name, section = '') {
  const sec = SECTION[section];
  if (sec === 'Refeições na loja' || sec === 'Depósitos e sacos') return { category: sec, need: NEED_OF[sec] };
  const p = plain(name).replace(/[º*`]/g, ' ');
  for (const [re, category] of RULES) if (re.test(p)) return { category, need: NEED_OF[category] };
  if (sec) return { category: sec, need: NEED_OF[sec] || '' };
  return { category: UNCAT, need: '' };
}
/** Identidade do produto para comparar preços entre compras. */
export const productKey = name => plain(name).replace(/[º*`´']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/* ---------- parser ---------- */
const titleCase = s => String(s || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
function qtyOf(qtyText, unitText, gross) {
  if (qtyText == null) return { qty: 1, unit: gross };
  const q = num(qtyText), unit = num(unitText);
  if (Number.isInteger(q)) return { qty: q, unit };
  return { qty: 1, weightKg: q, unit };
}
function vatTable(ls) {
  const t = {};
  for (const l of ls) { const m = /^([A-Z]) (\d+)(?:,\d+)?%(?:\s|$)/.exec(l); if (m) t[m[1]] = +m[2]; }
  return t;
}
function finish(r) {
  const sum = r2(r.items.reduce((a, i) => a + i.net, 0));
  r.check = { ok: r.paid != null && Math.abs(sum - r.paid) < 0.015 && r.items.every(i => i.ok !== false), sum, diff: r.paid == null ? null : r2(sum - r.paid) };
  for (const i of r.items) { i.vat = r.vat[i.flag]; delete i.ok; }
  return r;
}

function parsePingo(text) {
  const ls = lines(text), a = ls.findIndex(l => /^Artigos$/.test(l)), b = ls.findIndex((l, i) => i > a && /^Resumo$/.test(l));
  if (a < 0 || b < 0) return null;
  const r = { store: 'Pingo Doce', items: [], warnings: [], vat: vatTable(ls) };
  let section = '', extra = false, last = null;
  for (const l of ls.slice(a + 1, b)) {
    if (/^-+$/.test(l) || /^º?Total Dep/i.test(l)) continue;
    if (/^Descontos Extra$/i.test(l)) { extra = true; continue; }
    let m = /^(?:Poupança Imediata|Exclusivo POUPA Shaker) \((\d+,\d\d)\)$/.exec(l);
    if (m) { if (last) { last.discount = r2(last.discount + num(m[1])); last.net = r2(last.gross - last.discount); } else r.warnings.push(l); continue; }
    if (extra && (m = /^(.+?) \((\d+,\d\d)\)$/.exec(l))) {
      const v = num(m[2]);
      r.items.push({ kind: 'discount', name: m[1], section, flag: '', qty: 1, unit: -v, gross: 0, discount: v, net: -v });
      continue;
    }
    m = /^([A-Z]) (.+?)(?: (\d+(?:,\d+)?) X (\d+,\d\d))? (\d+,\d\d)$/.exec(l);
    if (m) {
      const gross = num(m[5]), q = qtyOf(m[3], m[4], gross), name = m[2].replace(/^º/, '').trim();
      const it = { kind: section === 'DEPÓSITO VOLTA' || /^º?valor dep/i.test(m[2]) ? 'deposit' : 'item', name, section, flag: m[1], ...q, gross, discount: 0, net: gross };
      const exp = q.weightKg ? q.weightKg * q.unit : q.qty * q.unit;
      if (Math.abs(exp - gross) > 0.02) { it.ok = false; r.warnings.push(`quantidade x preço não bate: ${l}`); }
      r.items.push(it); last = it; continue;
    }
    if (/\d,\d\d$/.test(l)) { r.warnings.push('linha não reconhecida: ' + l); continue; }
    section = l; last = null;
  }
  const tot = re => { const f = ls.find(l => re.test(l)); const m = f && /(\d+,\d\d)\)?$/.exec(f); return m ? num(m[1]) : null; };
  r.paid = tot(/^TOTAL PAGO /); if (r.paid == null) r.paid = tot(/^TOTAL A PAGAR/); if (r.paid == null) r.paid = tot(/^TOTAL \d/);
  r.gross = tot(/^TOTAL \d/); r.savings = tot(/^TOTAL POUPANÇA/) ?? 0;
  const dt = ls.map(l => /(\d{4}-\d\d-\d\d) (\d\d:\d\d)/.exec(l)).find(Boolean); if (dt) { r.date = dt[1]; r.time = dt[2]; }
  const doc = ls.map(l => /\bFS (\S+)/.exec(l)).find(Boolean); r.doc = doc ? doc[1] : '';
  const bi = ls.findIndex(l => /^PINGO DOCE$/.test(l)), bm = bi >= 0 && /^\d+-(.+)$/.exec(ls[bi + 1] || '');
  r.branch = titleCase(bm ? bm[1] : ls[0]);
  const pay = ls.map(l => /^(Multibanco|Numerário|Dinheiro|MB WAY) (\d+,\d\d)$/i.exec(l)).find(Boolean); r.payment = pay ? pay[1] : '';
  const card = ls.map(l => /CARTAO: \*+(\d{4})/.exec(l)).find(Boolean); r.card = card ? card[1] : '';
  r.cardType = (ls.map(l => /Visa (Credit|Debit)/i.exec(l)).find(Boolean) || [])[1] || '';
  return finish(r);
}

function parseIntermarche(text) {
  const ls = lines(text), a = ls.findIndex(l => /^ARTIGO\(S\)/.test(l)), b = ls.findIndex((l, i) => i > a && /COM TOTAL DE/.test(l));
  if (a < 0 || b < 0) return null;
  const r = { store: 'Intermarché', items: [], warnings: [], vat: vatTable(ls) };
  let pending = '';
  for (const l of ls.slice(a + 1, b)) {
    if (/^ART#/.test(l)) continue;
    let m = /^(\d+,\d{3}) kg X (\d+,\d\d)EURO\/kg\s+Eur(\d+,\d\d) ([A-Z])$/.exec(l);
    if (m) {
      const gross = num(m[3]), w = num(m[1]), unit = num(m[2]);
      r.items.push({ kind: 'item', name: pending, section: '', flag: m[4], qty: 1, weightKg: w, unit, gross, discount: 0, net: gross, ...(Math.abs(w * unit - gross) > 0.02 && { ok: false }) });
      pending = ''; continue;
    }
    m = /^(.+?)\s+Eur(\d+,\d\d) ([A-Z])$/.exec(l);
    if (m) {
      const name = m[1].replace(/^\*/, '').trim(), gross = num(m[2]);
      r.items.push({ kind: /^deposito/i.test(plain(name)) ? 'deposit' : 'item', name, section: '', flag: m[3], qty: 1, unit: gross, gross, discount: 0, net: gross });
      pending = ''; continue;
    }
    if (/Eur\d/.test(l)) { r.warnings.push('linha não reconhecida: ' + l); continue; }
    pending = l.replace(/^\*/, '').trim();
  }
  const tot = /COM TOTAL DE Eur(\d+,\d\d)/.exec(ls[b]); r.paid = tot ? num(tot[1]) : null; r.gross = r.paid; r.savings = 0;
  // A impressora às vezes omite zeros ("9:11:06 2026-10- 1"): aceita 1 dígito e espaço; senão usa a linha do terminal (aa-mm-dd hh:mm:ss).
  const p2 = n => String(n).padStart(2, '0');
  const dt = ls.map(l => /(\d{1,2}):(\d\d):\d\d (\d{4})-(\d\d)-\s*(\d{1,2})$/.exec(l)).find(Boolean);
  if (dt) { r.date = `${dt[3]}-${dt[4]}-${p2(dt[5])}`; r.time = `${p2(dt[1])}:${dt[2]}`; }
  else { const tm = ls.map(l => /^(\d\d)-(\d\d)-(\d\d) (\d\d:\d\d):\d\d /.exec(l)).find(Boolean); if (tm) { r.date = `20${tm[1]}-${tm[2]}-${tm[3]}`; r.time = tm[4]; } }
  const doc = ls.map(l => /DOCUMENTO No:FS (\S+)/.exec(l)).find(Boolean); r.doc = doc ? doc[1] : '';
  const br = ls.map(l => /^INTERMARCHE (.+)$/.exec(l)).find(Boolean); r.branch = titleCase(br ? br[1] : '');
  const paid = ls.map(l => /^(MULTIBANCO|NUMERARIO)\s+Eur(\d+,\d\d)$/.exec(l)).filter(Boolean).find(m => num(m[2]) > 0);
  r.payment = paid ? (paid[1] === 'MULTIBANCO' ? 'Multibanco' : 'Numerário') : '';
  const card = ls.map(l => /CARTAO: \*+(\d{4})/.exec(l)).find(Boolean); r.card = card ? card[1] : '';
  r.cardType = (ls.map(l => /Visa (Credit|Debit)/i.exec(l)).find(Boolean) || [])[1] || '';
  return finish(r);
}

/** Texto de uma fatura (pdftotext -raw) -> fatura lida, ou null se não for Pingo Doce nem Intermarché / sem texto. */
export function parseReceipt(text) {
  const t = String(text || '');
  if (/^Artigos$/m.test(t) && /pingo doce/i.test(t)) return parsePingo(t);
  if (/^ARTIGO\(S\)/m.test(t) && /INTERMARCHE/.test(t)) return parseIntermarche(t);
  return null;
}

/* ---------- registros ---------- */
/** Fatura lida -> { receipt, lines } para `receipts` e `receipt-lines`. Ids determinísticos (loja + documento): reimportar não duplica. */
export function receiptRecords(r, extra = {}) {
  const rid = 'r' + bankId(r.date, r.paid, `${r.store}|${r.doc}`).slice(1), now = Date.now();
  const receipt = { id: rid, month: r.date.slice(0, 7), store: r.store, branch: r.branch, date: r.date, time: r.time, doc: r.doc, gross: r.gross, savings: r.savings, paid: r.paid, payment: r.payment, card: r.card, cardType: r.cardType, nLines: r.items.length, check: r.check, ...extra, updatedAt: now };
  const out = r.items.map((i, k) => {
    const c = i.kind === 'discount' ? { category: 'Refeições na loja', need: 'flexible' } : categorize(i.name, i.section);
    return { id: `${rid}-${String(k + 1).padStart(2, '0')}`, rid, month: receipt.month, store: r.store, branch: r.branch, date: r.date, time: r.time, seq: k + 1, kind: i.kind, name: i.name, pkey: productKey(i.name), section: i.section, flag: i.flag, ...(i.vat != null && { vat: i.vat }), qty: i.qty, ...(i.weightKg != null && { weightKg: i.weightKg }), unit: i.unit, gross: i.gross, discount: i.discount, net: i.net, category: c.category, need: c.need, auto: true, updatedAt: now };
  });
  return { receipt, lines: out };
}

/* ---------- vínculo com Gastos ---------- */
const days = (a, b) => (Date.parse(a) - Date.parse(b)) / 864e5;
/**
 * Liga cada fatura ao lançamento de Gastos com o mesmo valor pago, de 0 a 5 dias de diferença (compra no débito só aparece no extrato dias depois).
 * `receipts` com id/date/paid; `expenses` de Gastos (só lê). Um lançamento serve a uma fatura só. Devolve { pairs:[{receiptId, expenseId, date, expenseDate}], unmatched:[receipts] }.
 */
export function linkExpenses(receipts, expenses) {
  const used = new Set(), pairs = [], unmatched = [];
  for (const r of [...receipts].sort((a, b) => a.date.localeCompare(b.date))) {
    const c = expenses.filter(e => !used.has(e.id) && Math.abs(e.amount - r.paid) < 0.005 && Math.abs(days(e.date, r.date)) <= 5)
      .sort((a, b) => Math.abs(days(a.date, r.date)) - Math.abs(days(b.date, r.date)) || (/mercado/i.test(b.category) - /mercado/i.test(a.category)))[0];
    if (c) { used.add(c.id); pairs.push({ receiptId: r.id, expenseId: c.id, date: r.date, expenseDate: c.date, category: c.category }); } else unmatched.push(r);
  }
  return { pairs, unmatched };
}

/* ---------- relatórios ---------- */
/** Totais por categoria e por tipo (essential/flexible) das linhas de um conjunto de faturas. Depósitos entram; descontos extras abatem. */
export function summarize(lines) {
  const cat = new Map(), need = { essential: 0, flexible: 0, '': 0 };
  let total = 0;
  for (const l of lines) {
    const c = cat.get(l.category) || { category: l.category, need: l.need, net: 0, n: 0, discount: 0 };
    c.net = r2(c.net + l.net); c.n += l.kind === 'item' ? 1 : 0; c.discount = r2(c.discount + (l.kind === 'item' ? l.discount : 0)); cat.set(l.category, c);
    need[l.need || ''] = r2(need[l.need || ''] + l.net); total = r2(total + l.net);
  }
  return { total, need, categories: [...cat.values()].sort((a, b) => b.net - a.net) };
}

/** Quantidade comparável: peso em kg para itens pesados, unidades para os demais. */
const amount = l => l.weightKg != null ? l.weightKg : l.qty;
/**
 * Compara dois períodos separando o efeito do PREÇO do efeito da QUANTIDADE, nos produtos comprados nos dois (mesma loja e mesmo nome).
 * Preço unitário = valor pago / quantidade. Efeito preço = Σ (preçoB − preçoA) × qtdB; efeito quantidade = Σ (qtdB − qtdA) × preçoA.
 * Produtos só em B = novos; só em A = deixaram de ser comprados. total(B) − total(A) = preço + quantidade + novos − deixados.
 */
export function priceVolume(linesA, linesB) {
  const agg = ls => { const m = new Map(); for (const l of ls) { if (l.kind !== 'item') continue; const k = l.store + '|' + l.pkey, e = m.get(k) || { key: k, name: l.name, q: 0, net: 0 }; e.q += amount(l); e.net = r2(e.net + l.net); m.set(k, e); } return m; };
  const A = agg(linesA), B = agg(linesB);
  let price = 0, volume = 0, newSum = 0, droppedSum = 0; const common = [];
  for (const [k, b] of B) {
    const a = A.get(k);
    if (!a) { newSum += b.net; continue; }
    const pa = a.net / a.q, pb = b.net / b.q, dp = (pb - pa) * b.q, dv = (b.q - a.q) * pa;
    price += dp; volume += dv; common.push({ key: k, name: b.name, qA: a.q, qB: b.q, pA: r2(pa), pB: r2(pb), priceEffect: r2(dp), volumeEffect: r2(dv) });
  }
  for (const [k, a] of A) if (!B.has(k)) droppedSum += a.net;
  const totalA = r2([...A.values()].reduce((s, x) => s + x.net, 0)), totalB = r2([...B.values()].reduce((s, x) => s + x.net, 0));
  return { totalA, totalB, diff: r2(totalB - totalA), price: r2(price), volume: r2(volume), newProducts: r2(newSum), dropped: r2(-droppedSum), common: common.sort((x, y) => Math.abs(y.priceEffect) - Math.abs(x.priceEffect)) };
}

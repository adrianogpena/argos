// Classificação dos lançamentos do extrato: categoria e tipo (essencial / flexível). Puro, testado em test/classify.test.mjs.
// O banco só garante data e valor. Categoria e tipo são palpites: vêm de (1) regras aprendidas com as edições do dono,
// (2) regras embutidas por palavra-chave, (3) nada ("Sem categoria"). O que não é decisão do dono fica com auto = true, para revisar.

export const UNCAT = 'Sem categoria';
export const NEEDS = { essential: 'Essencial', flexible: 'Flexível' };

const STOP = new Set(['compra', 'compras', 'pagamento', 'pag', 'pagto', 'pos', 'mbway', 'mb', 'way', 'transf', 'transferencia', 'cartao', 'card', 'purchase', 'sepa', 'dd', 'debito', 'direto', 'ref', 'referencia', 'de', 'da', 'do', 'dos', 'das', 'em', 'a', 'e', 'o', 'the', 'servicos', 'servico', 'sa', 'lda', 'unipessoal', 'portugal', 'pt']);

export const plain = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Chave estável de um comerciante: tira acentos, números, datas e palavras de banco; guarda as 3 primeiras palavras. */
export function descKey(desc) {
  const words = plain(desc).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w && !/\d/.test(w) && !STOP.has(w) && w.length > 1);
  return words.slice(0, 3).join('-').slice(0, 40) || 'sem-descricao';
}

// [padrão sobre o texto sem acento, categoria, tipo]. A primeira que casar vale.
export const RULES = [
  [/\b(renda|arrendamento|condominio|senhorio|aluguer)\b/, 'Moradia', 'essential'],
  [/\b(edp|endesa|iberdrola|goldenergy|galp power|su eletricidade|epal|aguas|agua|saneamento|gas natural|nos|meo|vodafone|nowo|digi|altice|internet)\b/, 'Contas', 'essential'],
  [/\b(continente|pingo doce|lidl|aldi|minipreco|auchan|intermarche|mercadona|apolonia|supermercado)\b/, 'Mercado', 'essential'],
  [/\b(farmacia|hospital|clinica|medico|dentista|cuf|lusiadas|analises)\b/, 'Saúde', 'essential'],
  [/\b(stcp|andante|metro do porto|comboios|via verde|portagem|portagens|galp|repsol|bp|cepsa|prio|combustivel|estacionamento)\b/, 'Transporte', 'essential'],
  [/\b(uber|bolt)\b/, 'Transporte', 'flexible'],
  [/\b(seguro|seguros|fidelidade|tranquilidade|ageas|allianz|zurich)\b/, 'Seguros', 'essential'],
  [/\b(imi|iuc|financas|autoridade tributaria|seguranca social|irs)\b/, 'Impostos', 'essential'],
  [/\b(escola|colegio|universidade|faculdade|propinas|creche|infantario)\b/, 'Educação', 'essential'],
  [/\b(netflix|spotify|hbo|disney|prime video|amazon prime|apple com|icloud|youtube|dazn|audible)\b/, 'Assinaturas', 'flexible'],
  [/\b(restaurante|pizzaria|burger|mcdonald|mcdonalds|kfc|starbucks|cafe|pastelaria|uber eats|glovo|sushi|takeaway)\b/, 'Restaurantes', 'flexible'],
  [/\b(cinema|ginasio|fitness|holmes place|teatro|ticketline|steam|playstation|fnac|worten)\b/, 'Lazer', 'flexible'],
  [/\b(levantamento|atm)\b/, 'Outros', 'flexible'],
];

/** Palpite para uma descrição. `learned` = Map chave -> {category, need}. Devolve { category, need, source: 'learned'|'rule'|'none' }. */
export function classify(desc, learned = new Map()) {
  const key = descKey(desc), l = learned.get(key);
  if (l) return { category: l.category, need: l.need || '', source: 'learned' };
  const text = plain(desc).replace(/[^a-z0-9 ]+/g, ' ');
  for (const [re, category, need] of RULES) if (re.test(text)) return { category, need, source: 'rule' };
  return { category: UNCAT, need: '', source: 'none' };
}

// FNV-1a de 32 bits em base 36: curto e estável.
const hash = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };

/**
 * Transforma as linhas do extrato em registros de `expenses`. Só saídas (valor negativo) viram gasto.
 * O id depende de data + valor + descrição (e da ordem, se houver lançamentos idênticos no mesmo dia), então importar
 * o mesmo mês duas vezes não duplica. Quem já existe (`existingIds`) é pulado, para nunca sobrescrever uma edição.
 */
export function planImport(rows, existingIds = new Set(), learned = new Map()) {
  const seen = new Map(), records = [];
  let income = 0, duplicates = 0;
  for (const r of rows) {
    if (r.amount >= 0) { income++; continue; }
    const amount = Math.round(-r.amount * 100) / 100, norm = plain(r.desc).replace(/\s+/g, ' ').trim();
    const base = `${r.date}|${amount}|${norm}`, n = (seen.get(base) || 0) + 1; seen.set(base, n);
    const id = `b${r.date.replace(/-/g, '')}-${hash(base)}${n}`;
    if (existingIds.has(id)) { duplicates++; continue; }
    const c = classify(r.desc, learned);
    records.push({ id, date: r.date, amount, category: c.category, note: (r.desc || 'Sem descrição').slice(0, 120), need: c.need, source: 'bank', auto: c.source !== 'learned', key: descKey(r.desc) });
  }
  return { records, income, duplicates };
}

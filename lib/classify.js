// Chave de comerciante e ids dos gastos vindos do extrato. Puro, testado em test/classify.test.mjs.
// Quem lê o extrato e classifica é o Claude (skill `importar-extrato`); aqui só ficam as regras determinísticas
// que a página (regras aprendidas) e o script tools/expenses.mjs compartilham.

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
 * Quem já existe (`existingIds`) é pulado, para nunca sobrescrever uma edição do dono.
 */
export function buildRecords(entries, existingIds = new Set(), learned = new Map()) {
  const seen = new Map(), records = [], errors = [];
  let duplicates = 0;
  entries.forEach((e, i) => {
    const amount = Math.round(Number(e.amount) * 100) / 100, date = String(e.date || ''), desc = String(e.desc || '').replace(/\s+/g, ' ').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(amount > 0) || !desc) { errors.push(`entrada ${i + 1}: data, valor (positivo) e desc são obrigatórios`); return; }
    const id = bankId(date, amount, desc, seen);
    if (existingIds.has(id)) { duplicates++; return; }
    const key = descKey(desc), l = learned.get(key);
    const category = (l ? l.category : String(e.category || '').trim()) || UNCAT;
    const need = l ? (l.need || '') : (e.need === 'essential' || e.need === 'flexible' ? e.need : '');
    records.push({ id, date, amount, category: category.slice(0, 40), note: desc.slice(0, 120), need, source: 'bank', auto: !l, key });
  });
  return { records, duplicates, errors };
}

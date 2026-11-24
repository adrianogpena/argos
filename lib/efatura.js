// e-fatura (Portal das Finanças): linhas do CSV/tabela "Adquirente" -> faturas, vínculo com Gastos, sugestão de comerciante
// e plano de gravação diária no cofre. Lógica pura; os dados reais ficam fora do git.

const DAY = 864e5;
const day = s => Date.parse(s + 'T00:00:00Z') / DAY;
const same = (a, b) => Math.abs(a - b) < 0.015;
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const parseMoney = s => { const n = parseFloat(String(s).replace(/[^\d,-]/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

/** Linha de 11 colunas (Setor, Emitente "NIF - nome", "Nº / ATCUD", Tipo, Data, Total, IVA, Base, Situação, ...). null se inválida. */
export function parseRow(r) {
  if (!Array.isArray(r) || r.length < 9) return null;
  const [setor, emit, doc, tipo, date, total, vat, base, sit] = r.map(c => String(c ?? '').trim());
  const m = emit.match(/^(\d{9}) - (.+)$/), d = doc.split(' / ');
  if (!m || !doc || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = parseMoney(total);
  if (Number.isNaN(t)) return null;
  const nif = m[1], atcud = d.length > 1 ? d[d.length - 1].trim() : '', num = d.length > 1 ? d.slice(0, -1).join(' / ').trim() : doc;
  const id = (nif + '-' + (atcud || num.replace(/[^A-Za-z0-9]+/g, '_'))).slice(0, 40);   // sem ATCUD (faturas antigas): usa o número; o cofre aceita [A-Za-z0-9_-]{1,40}
  return { id, nif, name: m[2].trim(), setor, num, atcud, tipo, date, total: t, vat: parseMoney(vat) || 0, base: parseMoney(base) || 0, sit };
}

export const isVoid = inv => /anulad/i.test(inv.sit) || /^nota de cr[eé]dito$/i.test(inv.tipo);

const STOP = new Set(['compra', 'pag', 'pagserv', 'serv', 'trf', 'dd', 'mbway', 'levantamento', 'cartao', 'pagamento', 'servicos', 'transf', 'portugal', 'porto', 'gaia', 'vila', 'nova', 'coimbra', 'lisboa', 'lda', 'unipessoal', 'entidade']);
const tokens = s => norm(s).split(/[^a-z0-9]+/).filter(t => t.length >= 4 && !STOP.has(t) && !/^\d{1,4}$/.test(t));   // códigos de terminal do banco (5061, 7565) não identificam o emitente

/**
 * Liga cada fatura a um lançamento de Gastos de mesmo valor. 1 a 1, menor distância primeiro.
 * Passo 1: 0 a 5 dias depois da fatura (1 antes). Passo 2: 6 a 45 dias, só se o texto do banco citar o emitente
 * (débitos automáticos de água/luz/seguro demoram além de 5 dias; sem essa exigência valores pequenos casam por acaso).
 * Retorna Map(idFatura -> { xid, d, tag }).
 */
export function matchInvoices(invoices, expenses) {
  const exps = expenses.filter(x => x.amount > 0), used = new Set(), link = new Map();
  const inv = invoices.filter(i => !isVoid(i));
  const pass = (lo, hi, ok, tag) => {
    const c = [];
    for (const i of inv) {
      if (link.has(i.id)) continue;
      for (const x of exps) {
        if (used.has(x.id) || !same(x.amount, i.total)) continue;
        const d = day(x.date) - day(i.date);
        if (d < lo || d > hi || !ok(i, x)) continue;
        c.push({ i, x, d });
      }
    }
    c.sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
    for (const { i, x, d } of c) if (!link.has(i.id) && !used.has(x.id)) { link.set(i.id, { xid: x.id, d, tag }); used.add(x.id); }
  };
  pass(-1, 5, () => true, 'p5');
  const byId = new Map(exps.map(x => [x.id, x])), per = new Map(), sig = new Map();
  for (const [id, l] of link) { const i = inv.find(v => v.id === id); (per.get(i.nif) || per.set(i.nif, []).get(i.nif)).push(byId.get(l.xid)); }
  for (const i of inv) if (!sig.has(i.nif)) sig.set(i.nif, new Set(tokens(i.name)));
  for (const [nif, xs] of per) {
    if (xs.length < 2) continue;
    const cnt = {};
    for (const x of xs) for (const t of new Set(tokens((x.note || '') + ' ' + (x.key || '')))) cnt[t] = (cnt[t] || 0) + 1;
    for (const [t, c] of Object.entries(cnt)) if (c >= 2 && c / xs.length >= 0.4) sig.get(nif).add(t);
  }
  pass(6, 45, (i, x) => tokens((x.note || '') + ' ' + (x.key || '')).some(t => sig.get(i.nif).has(t)), 'wide');
  return link;
}

const genericCategory = (c, l) => !c || (c === 'Outros' && (!l || /n[aã]o identificado/i.test(l)));

/**
 * Sugestão de categoria por emitente (NIF) a partir dos lançamentos ligados.
 * alta = 85% ou mais na mesma categoria com 2+ ligações; media = 60% ou mais; o resto não é sugerido.
 */
export function merchantSuggestions(invoices, links, expenses) {
  const byX = new Map(expenses.map(x => [x.id, x])), by = new Map();
  for (const i of invoices) {
    if (isVoid(i)) continue;
    const m = by.get(i.nif) || by.set(i.nif, { nif: i.nif, name: i.name, n: 0, lk: 0, cats: new Map(), labels: new Map() }).get(i.nif);
    m.n++;
    const l = links.get(i.id), x = l && byX.get(l.xid);
    if (x) { m.lk++; m.cats.set(x.category, (m.cats.get(x.category) || 0) + 1); const k = x.category + '|' + (x.label || ''); m.labels.set(k, (m.labels.get(k) || 0) + 1); }
  }
  const out = [];
  for (const m of by.values()) {
    if (!m.lk) continue;
    const [category, c] = [...m.cats].sort((a, b) => b[1] - a[1])[0], share = c / m.lk;
    const lab = [...m.labels].filter(([k]) => k.split('|')[0] === category).sort((a, b) => b[1] - a[1])[0];
    const label = lab ? lab[0].split('|')[1] : '';
    const conf = share >= 0.85 && m.lk >= 2 ? 'alta' : share >= 0.6 ? 'media' : 'baixa';
    out.push({ nif: m.nif, name: m.name, n: m.n, lk: m.lk, category, label, share, conf, generic: genericCategory(category, label) });
  }
  return out.sort((a, b) => b.lk - a.lk);
}

/** Registro da coleção `efatura` (id = NIF-ATCUD). */
export function invoiceRecord(inv, link) {
  const r = { id: inv.id, nif: inv.nif, name: inv.name.slice(0, 60), setor: inv.setor.slice(0, 60), num: inv.num.slice(0, 40), tipo: inv.tipo, date: inv.date, total: inv.total, vat: inv.vat, base: inv.base, sit: inv.sit };
  if (link) r.expenseId = link.xid;
  return r;
}

/** Registros de `qr-merchants` para os emitentes de confiança alta/média, sem sobrescrever os que já existem. */
export function merchantRecords(suggestions, existingIds = []) {
  const have = new Set(existingIds);
  return suggestions.filter(s => s.conf !== 'baixa' && !s.generic && !have.has(s.nif))
    .map(s => ({ id: s.nif, name: s.name.replace(/\s+/g, ' ').slice(0, 40), category: s.category.slice(0, 40) }));
}

/**
 * Próximo lote de gravação respeitando a cota diária do KV. plan = { collection: items[] } na ordem de prioridade;
 * state = { days: {AAAA-MM-DD: n}, sent: {collection: [ids]} }. Retorna [{ collection, items }] (cada um com até 500).
 */
export function nextBatches(plan, state, today, perDay = 600, chunk = 500) {
  let room = Math.max(0, perDay - (state.days?.[today] || 0));
  const out = [];
  for (const [collection, items] of Object.entries(plan)) {
    const sent = new Set(state.sent?.[collection] || []);
    const todo = items.filter(x => !sent.has(x.id));
    for (let i = 0; i < todo.length && room > 0; i += chunk) {
      const part = todo.slice(i, i + Math.min(chunk, room));
      out.push({ collection, items: part }); room -= part.length;
    }
  }
  return out;
}

export const recordBatch = (state, today, collection, items) => {
  const days = { ...(state.days || {}), [today]: ((state.days || {})[today] || 0) + items.length };
  const sent = { ...(state.sent || {}), [collection]: [...(state.sent?.[collection] || []), ...items.map(x => x.id)] };
  return { days, sent };
};

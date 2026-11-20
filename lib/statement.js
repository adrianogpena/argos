// Leitura de extratos bancários em CSV. Puro: sem DOM, sem rede. Testado em test/statement.test.mjs.
// O extrato nunca sai do navegador: é lido aqui e só os lançamentos viram registros do cofre.

const plain = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Bancos portugueses costumam exportar em Windows-1252; tenta UTF-8 estrito antes. */
export function decodeText(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
}

function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 40);
  let best = ';', bestScore = 0;
  for (const d of [';', '\t', ',', '|']) {
    const counts = lines.map(l => l.split(d).length - 1).filter(c => c > 0);
    const freq = new Map(); for (const c of counts) freq.set(c, (freq.get(c) || 0) + 1);
    let score = 0; for (const [c, n] of freq) score = Math.max(score, c * n);
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

export function parseCSV(text, delim) {
  text = String(text).replace(/^﻿/, '');
  delim = delim || detectDelimiter(text);
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; if (row.some(x => x.trim())) rows.push(row); row = []; }
    else field += c;
  }
  row.push(field); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}

/** '1.234,56', '-12,50', '(12,50)', '12,50-', '€ 3.5' -> número; NaN se não der. */
export function parseAmount(s) {
  let t = String(s ?? '').replace(/[\s ]/g, '').replace(/eur|€/gi, '');
  if (!t) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t.endsWith('-')) { neg = true; t = t.slice(0, -1); }
  if (t.startsWith('-')) { neg = !neg; t = t.slice(1); } else if (t.startsWith('+')) t = t.slice(1);
  if (!/^[\d.,]+$/.test(t)) return NaN;
  const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) { const dec = lc > ld ? ',' : '.', th = dec === ',' ? '.' : ','; t = t.split(th).join('').replace(dec, '.'); }
  else if (lc >= 0) t = t.split(',').length > 2 ? t.split(',').join('') : t.replace(',', '.');
  else if (ld >= 0 && /^\d{1,3}(\.\d{3})+$/.test(t)) t = t.split('.').join('');
  const n = Number(t);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

/** 'DD-MM-AAAA', 'DD/MM/AAAA', 'DD.MM.AA', 'AAAA-MM-DD' (com hora ao final, se houver) -> 'AAAA-MM-DD' ou null. */
export function parseDate(s) {
  const t = String(s ?? '').trim().split(/[ T]/)[0];
  let y, m, d, g;
  if ((g = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) [y, m, d] = [g[1], g[2], g[3]];
  else if ((g = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/))) [d, m, y] = [g[1], g[2], g[3].length === 2 ? '20' + g[3] : g[3]];
  else return null;
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +m - 1 || dt.getUTCDate() !== +d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const FIND = {
  date: [/^data (de )?mov/, /^data (da )?(operacao|transacao|lancamento)/, /^data$/, /^date$/, /^data/],
  desc: [/^descri/, /^detalhe/, /^historico/, /^beneficiari/, /^memo/, /^narrati/, /^movimento$/, /^referencia$/],
  amount: [/^montante/, /^valor$/, /^importancia/, /^quantia/, /^amount/],
  debit: [/^debito/, /^debit/, /^saidas?$/],
  credit: [/^credito/, /^credit/, /^entradas?$/],
};

function findCol(cells, patterns) {
  for (const p of patterns) { const i = cells.findIndex(c => p.test(c)); if (i >= 0) return i; }
  return -1;
}

/** Procura a linha de cabeçalho (bancos põem texto antes dela) e as colunas de data, descrição e valor. */
export function detectColumns(rows) {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const cells = rows[i].map(plain);
    const cols = Object.fromEntries(Object.keys(FIND).map(k => [k, findCol(cells, FIND[k])]));
    if (cols.date >= 0 && (cols.amount >= 0 || cols.debit >= 0 || cols.credit >= 0)) return { headerIndex: i, ...cols };
  }
  return null;
}

/**
 * Lê o texto de um extrato. `override` = { headerIndex, date, desc, amount, debit, credit, invert } (índices de coluna)
 * para quando a detecção automática falha ou erra. Saída: { rows:[{date, amount, desc}], skipped, headers, cols, error }.
 * `amount` com sinal: negativo = saída. Linhas sem data válida (totais, rodapé) são puladas.
 */
export function parseStatement(text, override) {
  const table = parseCSV(text);
  if (!table.length) return { rows: [], skipped: 0, headers: [], cols: null, error: 'empty' };
  const cols = override ? { debit: -1, credit: -1, amount: -1, desc: -1, ...override } : detectColumns(table);
  if (!cols) {
    const hi = table.findIndex(r => r.filter(c => c.trim()).length >= 3);
    return { rows: [], skipped: 0, headers: (table[Math.max(hi, 0)] || []).map(c => c.trim()), cols: null, headerIndex: Math.max(hi, 0), error: 'columns' };
  }
  const headers = (table[cols.headerIndex] || []).map(c => c.trim());
  if (!(cols.date >= 0 && (cols.amount >= 0 || cols.debit >= 0 || cols.credit >= 0))) return { rows: [], skipped: 0, headers, cols, error: 'columns' };
  const sign = cols.invert ? -1 : 1, out = []; let skipped = 0;
  for (const r of table.slice(cols.headerIndex + 1)) {
    const date = parseDate(r[cols.date]);
    let amount = NaN;
    if (cols.amount >= 0) amount = parseAmount(r[cols.amount]);
    else {
      const d = cols.debit >= 0 ? parseAmount(r[cols.debit]) : NaN, c = cols.credit >= 0 ? parseAmount(r[cols.credit]) : NaN;
      if (Number.isFinite(d) && d !== 0) amount = -Math.abs(d); else if (Number.isFinite(c) && c !== 0) amount = Math.abs(c);
    }
    if (!date || !Number.isFinite(amount) || amount === 0) { skipped++; continue; }
    out.push({ date, amount: Math.round(amount * sign * 100) / 100, desc: (cols.desc >= 0 ? String(r[cols.desc] ?? '') : '').replace(/\s+/g, ' ').trim() });
  }
  return { rows: out, skipped, headers, cols, error: out.length ? null : 'rows' };
}

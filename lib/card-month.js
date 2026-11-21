// Extrato do cartão de crédito: lê o texto do PDF (pdftotext -raw), confere os saldos e liga cada pagamento à linha da conta à vista.
// Lógica pura, sem rede nem arquivos. Quem lê PDFs e fala com o cofre é tools/card.mjs. Testado em test/card-month.test.mjs.
//
// Guardado no cofre (nada disso aparece em tela, serve para nunca voltar ao PDF):
//   card-statements: um registro por extrato (cabeçalho, TAN, limite, saldos, imputação do pagamento, próximo pagamento, plano de parcelas, conferência, estado)
//   card-lines:      toda linha de movimento, com `kind` (compra, juros, selo, taxa, serviço, pagamento, estorno) e, nos pagamentos, o id da linha do banco
import { bankId, descKey, inferBranch, UNCAT } from './classify.js';

const r2 = n => Math.round(n * 100) / 100;
const NUM = String.raw`(?<![\d.])\d{1,3}(?: \d{3})*\.\d{2}(?!\d)`;
const N5 = `(${NUM}) (${NUM}) (${NUM}) (${NUM}) (${NUM})`;
const toNum = s => Number(String(s).replace(/\s/g, ''));
const iso = s => String(s).replace(/\//g, '-');
const row5 = m => m && { capital: toNum(m[1]), interest: toNum(m[2]), stamp: toNum(m[3]), fees: toNum(m[4]), total: toNum(m[5]) };

export const CARD_CATEGORY = 'Cartão de crédito';
export const CARD_LABELS = { interest: 'Juros do cartão', stamp: 'Imposto do selo do cartão', fee: 'Taxas do cartão' };

/** Tipo de uma linha do extrato do cartão (descrição já limpa). `credit` = a linha está na coluna de crédito. */
export function isCreditDesc(desc) { return /^(>?PAGAMENTO CARTAO|CRED\.|CASHBACK|ESTORNO|DEVOL|ANULA|REGULARIZ|LIMITE EXCEDIDO NO CARTAO)/i.test(desc); }
export function kindOf(desc) {
  const d = String(desc).trim();
  if (isCreditDesc(d)) return /^(>?PAGAMENTO CARTAO|LIMITE EXCEDIDO NO CARTAO)/i.test(d) ? 'payment' : 'refund';
  if (/^COMPRA /i.test(d)) return 'purchase';
  if (/^(DEBITO )?JUROS/i.test(d)) return 'interest';
  if (/SELO/i.test(d)) return 'stamp';
  if (/^(TAXA|COMISS|ANUIDADE|COM\.)/i.test(d)) return 'fee';
  return 'service';   // PAGSERV, PAG.IGCP...: pagamento feito com o cartão sem o prefixo COMPRA
}

const NOISE = [/^Banco ActivoBank/i, /^Capital Social/i, /^P.g\. ?\d/i, /^\+351/, /^Atendimento/i, /^www\./i, /^O custo das/i, /^(Data|Movimento|Mov\.|Valor)$/, /^Valor Descritivo/, /^Descritivo/, /^(VIS|MB|MC|VPAY|MAE)$/, /^#[SE]#$/];
const NETWORK = /\s+(VIS|MB|MC|VPAY|MAE)$/;

function parseMovements(block, endYear) {
  const out = [], endRe = new RegExp(`(${NUM})$`), startRe = /^(\d{4}\/\d{2}\/\d{2}|\d{2}\/\d{2}) (\d{4}\/\d{2}\/\d{2}|\d{2}\/\d{2}) (.+)$/;
  const full = d => d.length === 5 ? `${endYear}-${d.slice(0, 2)}-${d.slice(3)}` : iso(d);
  let cur = null;
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (!line || NOISE.some(re => re.test(line))) continue;
    const s = line.match(startRe);
    if (s) cur = { date: full(s[1]), valueDate: full(s[2]), text: s[3] };
    else if (cur) cur.text += ' ' + line;
    else continue;
    const a = cur.text.match(endRe);
    if (a) {
      const desc = cur.text.slice(0, a.index).trim().replace(NETWORK, '').replace(/\s+/g, ' ').trim().replace(/^>/, '');
      out.push({ date: cur.date, valueDate: cur.valueDate, desc, amount: toNum(a[1]), credit: isCreditDesc(desc) });
      cur = null;
    }
  }
  return out;
}

function parsePlans(text) {
  const lines = text.split('\n').map(s => s.trim()), plans = [], re = new RegExp(`^(${NUM}) (${NUM}) (\\d+\\.\\d{3})% (\\d{5}/\\d+) (${NUM}) (${NUM}) (${NUM}) (${NUM})$`);
  for (let i = 0; i < lines.length - 1; i++) {
    const h = lines[i].match(/^(\d{4}\/\d{2}\/\d{2}) (COMPRA .+)$/), m = h && lines[i + 1].match(re);
    if (m) plans.push({ date: iso(h[1]), desc: h[2], amount: toNum(m[1]), debt: toNum(m[2]), tan: Number(m[3]), plan: m[4], capital: toNum(m[5]), interest: toNum(m[6]), stamp: toNum(m[7]), installment: toNum(m[8]) });
  }
  return plans;
}

/** Lê o texto (saída do `pdftotext -raw`) de um ou mais extratos. Devolve [{...cabeçalho, lines, plans}], na ordem do arquivo. */
export function parseCardText(text) {
  const parts = String(text).replace(/\r/g, '').split(/(?=EXTRATO VISA CLASSIC)/).filter(p => /RESUMO DA CONTA/.test(p));
  return parts.map(p => {
    const per = p.match(/Extrato de:\s*(\d{4})\/(\d{2})\/(\d{2}) a (\d{4})\/(\d{2})\/(\d{2})/);
    if (!per) return null;
    const sec = (a, b) => { const i = p.search(a); if (i < 0) return ''; const rest = p.slice(i), j = rest.search(b); return j < 0 ? rest : rest.slice(0, j); };
    const first = (re, g = 1) => { const m = p.match(re); return m ? m[g] : null; };
    const mv = p.search(/DETALHE DOS MOVIMENTOS/);
    const sum = p.match(new RegExp(`^(${NUM}) (${NUM}) (${NUM}) (${NUM})$`, 'm'));
    const imp = sec(/IMPUTA/, /DETALHE DE MONTANTES/), nxt = sec(/INFORMA.{1,3}O SOBRE O PR.XIMO/, /Pagamento Percentual:/), debt = sec(/DETALHE DE MONTANTES/, /INFORMA.{1,3}O SOBRE/);
    const debtLines = debt.split('\n').map(s => s.trim()).filter(Boolean), li = debtLines.findIndex(l => /Valor Total/.test(l));
    const labels = li >= 0 ? debtLines[li].match(/Pagamento Percentual|Pagamentos Fracionados|Valor Total/g) || [] : [], vals = li >= 0 ? [...(debtLines[li + 1] || '').matchAll(new RegExp(NUM, 'g'))].map(m => toNum(m[0])) : [];
    const rowOf = (s, label) => row5(s.match(new RegExp(`^${label} ${N5}$`, 'm')));
    const dates = p.match(/Extrato Anterior:\s*((?:\d{4}\/\d{2}\/\d{2})?)\s*Data (?:Limite )?de Pagamento:\s*((?:\d{4}\/\d{2}\/\d{2})?)/);
    const issue = p.match(/Extrato Atual:\s*(\d{4}\/\d{2}\/\d{2})\s+Op.{1,3}o de Pagamento:\s*(\d+(?:[.,]\d+)?)\s*%/);
    const lines = mv >= 0 ? parseMovements(p.slice(mv), per[4]) : [];
    return {
      id: `${per[4]}-${per[5]}`, stmt: `${per[4]}-${per[5]}`, n: first(/N\. (\d{4}\/\d{3})/), from: `${per[1]}-${per[2]}-${per[3]}`, to: `${per[4]}-${per[5]}-${per[6]}`,
      prevIssue: dates && dates[1] ? iso(dates[1]) : null, payDate: dates && dates[2] ? iso(dates[2]) : null, issue: issue ? iso(issue[1]) : null, optionPct: issue ? Number(issue[2].replace(',', '.')) : null,
      tan: Number(first(/TAN Pagamento Percentual:\s*(\d+(?:\.\d+)?)\s*%/)) || null, limit: first(new RegExp(`Limite de Cr.dito:\\s*(${NUM})`)) ? toNum(first(new RegExp(`Limite de Cr.dito:\\s*(${NUM})`))) : null,
      totalDue: first(new RegExp(`Total a Pagar:\\s*(${NUM})`)) ? toNum(first(new RegExp(`Total a Pagar:\\s*(${NUM})`))) : null, minDue: first(new RegExp(`M.nimo a Pagar:\\s*(${NUM})`)) ? toNum(first(new RegExp(`M.nimo a Pagar:\\s*(${NUM})`))) : null,
      prevBalance: sum ? toNum(sum[1]) : null, credits: sum ? toNum(sum[2]) : null, debits: sum ? toNum(sum[3]) : null, balance: sum ? toNum(sum[4]) : null,
      paid: rowOf(imp, 'Pagamento Percentual'), paidFractioned: rowOf(imp, 'Pagamentos Fracionados'),
      debtDetail: labels.length && vals.length === labels.length ? Object.fromEntries(labels.map((l, i) => [{ 'Pagamento Percentual': 'percent', 'Pagamentos Fracionados': 'fractioned', 'Valor Total': 'total' }[l], vals[i]])) : null,
      next: { total: rowOf(nxt, 'Total a Pagar'), percent: rowOf(nxt, 'Pagamento Percentual'), fractioned: rowOf(nxt, 'Pagamentos Fracionados') },
      plans: parsePlans(mv >= 0 ? p.slice(0, mv) : p), lines,
    };
  }).filter(Boolean);
}

/** Conferências do extrato: saldo, soma das linhas, imputação do pagamento. `ok` só se tudo fecha. */
export function checkStatement(st) {
  const sum = fn => r2(st.lines.filter(fn).reduce((s, l) => s + l.amount, 0));
  const deb = sum(l => !l.credit), cred = sum(l => l.credit), pay = sum(l => l.credit && kindOf(l.desc) === 'payment');
  const have = st.prevBalance != null && st.balance != null;
  const balance = have && Math.abs(st.prevBalance + st.debits - st.credits - st.balance) < 0.005;
  const lines = have && Math.abs(deb - st.debits) < 0.015 && Math.abs(cred - st.credits) < 0.015;
  const parts = [st.paid, st.paidFractioned].filter(Boolean), paidTotal = r2(parts.reduce((a, p) => a + p.total, 0));   // pagamento percentual + parcelas do plano
  const imputation = !parts.length || Math.abs(paidTotal - pay) < 0.015 && parts.every(p => Math.abs(p.capital + p.interest + p.stamp + p.fees - p.total) < 0.015);
  return { ok: !!(balance && lines && imputation), balance: !!balance, lines: !!lines, imputation, debitsFromLines: deb, creditsFromLines: cred, paymentsFromLines: pay };
}

/** Linhas do cofre (`card-lines`): id estável (reimportar não duplica), com `kind`. */
export function lineRecords(st) {
  const seen = new Map();
  return st.lines.map((l, i) => ({ id: 'k' + bankId(l.date, l.amount, `${st.stmt}|${l.valueDate}|${l.desc}`, seen).slice(1), stmt: st.stmt, seq: i + 1, date: l.date, valueDate: l.valueDate, desc: l.desc, amount: l.amount, credit: l.credit, kind: kindOf(l.desc) }));
}

/** Registro do extrato para `card-statements`: tudo menos as linhas (que vão em card-lines). */
export function statementRecord(st, extra = {}) {
  const { lines, ...head } = st, c = checkStatement(st);
  return { ...head, nLines: lines.length, check: { ok: c.ok, balance: c.balance, lines: c.lines, imputation: c.imputation }, ...extra, updatedAt: Date.now() };
}

const bankDate = l => l.date;
/**
 * Liga cada pagamento do cartão (linha `payment` com `valueDate`) à saída da conta à vista com o mesmo valor, até 7 dias de diferença.
 * `cardLines` = card-lines (com id); `bankLines` = bank-lines. Devolve { pairs:[{cardLineId, bankLineId, amount, cardDate, bankDate}], unmatchedCard, unmatchedBank }.
 */
export function linkPayments(cardLines, bankLines) {
  const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
  const pays = cardLines.filter(l => l.kind === 'payment').sort((a, b) => a.valueDate.localeCompare(b.valueDate));
  const banks = bankLines.filter(l => l.account === 'SIMPLES' && l.amount < 0 && /CARTAO.*CREDITO/i.test(l.desc)).sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
  const used = new Set(), pairs = [], unmatchedCard = [];
  for (const c of pays) {
    const cand = banks.filter(b => !used.has(b.id) && Math.abs(-b.amount - c.amount) < 0.005 && days(bankDate(b), c.valueDate) <= 7).sort((a, b) => days(bankDate(a), c.valueDate) - days(bankDate(b), c.valueDate))[0];
    if (cand) { used.add(cand.id); pairs.push({ cardLineId: c.id, bankLineId: cand.id, amount: c.amount, cardDate: c.valueDate, bankDate: cand.date, stmt: c.stmt }); } else unmatchedCard.push(c);
  }
  return { pairs, unmatchedCard, unmatchedBank: banks.filter(b => !used.has(b.id)) };
}

/**
 * Gastos que o extrato gera: compras e serviços na data da compra; juros, selo e taxas como itens próprios (categoria Cartão de crédito).
 * Estorno com compra do mesmo comerciante no mesmo extrato abate dela; o que não casa vai em `unmatchedRefunds` (só informativo).
 * Pagamentos não são gasto: são o dinheiro saindo da conta (a amortização das compras que já foram contadas).
 */
export function cardEntries(lines) {
  const entries = [], unmatchedRefunds = [];
  for (const l of lines) {
    const k = l.kind || kindOf(l.desc);
    if (k === 'purchase' || k === 'service') entries.push({ date: l.date, amount: l.amount, desc: l.desc, kind: k });
    else if (k === 'interest' || k === 'stamp' || k === 'fee') {
      const label = k === 'fee' ? (/LIMITE EXCEDIDO/i.test(l.desc) ? 'Taxa de limite excedido' : /COMBUSTIVEL/i.test(l.desc) ? 'Taxa de posto de combustível' : CARD_LABELS.fee) : CARD_LABELS[k];
      entries.push({ date: l.date, amount: l.amount, desc: l.desc, kind: k, category: CARD_CATEGORY, need: 'essential', label });
    }
  }
  for (const l of lines.filter(x => (x.kind || kindOf(x.desc)) === 'refund')) {
    const key = descKey(l.desc.replace(/^CRED\./i, 'COMPRA'));
    const hit = entries.find(e => (e.kind === 'purchase' || e.kind === 'service') && e.amount >= l.amount && descKey(e.desc) === key);
    if (hit) { hit.amount = r2(hit.amount - l.amount); hit.refunded = r2((hit.refunded || 0) + l.amount); } else unmatchedRefunds.push(l);
  }
  return { entries: entries.filter(e => e.amount > 0), unmatchedRefunds };
}

/** Entradas -> registros de `expenses` (source 'card'). Regra aprendida vence o palpite; compras sem regra ficam `auto` (revisar). Id 'k...' estável. */
export function buildCardRecords(entries, existingIds = new Set(), learned = new Map()) {
  const seen = new Map(), records = [];
  let duplicates = 0, skipped = 0;
  for (const e of entries) {
    const amount = r2(e.amount), desc = String(e.desc).replace(/\s+/g, ' ').trim(), key = descKey(desc);
    const id = 'k' + bankId(e.date, amount, desc, seen).slice(1);
    const fixed = !!e.category, l = fixed ? null : learned.get(key);
    if (l && l.skip) { skipped++; continue; }
    if (existingIds.has(id)) { duplicates++; continue; }
    const guess = fixed ? null : inferBranch(desc, key);
    const category = fixed ? e.category : l ? l.category : guess ? guess.category : UNCAT;
    const need = fixed ? e.need : l ? l.need || '' : guess ? guess.need : '';
    const label = fixed ? e.label : l ? l.tag : guess ? guess.label : '';
    records.push({ id, date: e.date, amount, category: category.slice(0, 40), note: desc.slice(0, 120), need, source: 'card', card: true, ck: ['interest', 'stamp', 'fee'].includes(e.kind) ? e.kind : '', auto: !fixed && !l, key, ...(label && { label }) });
  }
  return { records, duplicates, skipped };
}

/** Chaves do banco que são só o pagamento do cartão (a conta à vista): ficam fora de Gastos porque o extrato do cartão detalha o consumo. */
export const CARD_PAYMENT_KEYS = ['vis-credito', 'vis-limite-excedido'];
export const isCardPaymentBank = l => /CARTAO.*CREDITO/i.test(l.desc) && l.amount < 0;

/** Relatório de um mês: conferências, totais por tipo, pagamentos ligados ao banco e o que já está em Gastos. */
export function cardReport(st, lines, expenses, links, skipKeys = new Set()) {   // skipKeys = chaves com regra "não é gasto": o gasto não entra em Gastos de propósito
  const c = checkStatement({ ...st, lines });
  const by = {}; for (const l of lines) { const k = l.kind || kindOf(l.desc); by[k] = by[k] || { n: 0, total: 0 }; by[k].n++; by[k].total = r2(by[k].total + l.amount); }
  const { entries: all, unmatchedRefunds } = cardEntries(lines), entries = all.filter(e => e.category || !skipKeys.has(descKey(e.desc)));
  const expected = r2(entries.reduce((s, e) => s + e.amount, 0)), byRule = r2(all.reduce((s, e) => s + e.amount, 0) - expected);
  // Acha os gastos do extrato pelo id (não pela data: uma compra de 28/fev pode vir no extrato de março). Meses lançados à mão (ids c...) comparam pela data.
  const seen = new Map(), want = [];
  for (const e of all) { const amount = r2(e.amount), desc = String(e.desc).replace(/\s+/g, ' ').trim(); const id = 'k' + bankId(e.date, amount, desc, seen).slice(1); if (e.category || !skipKeys.has(descKey(desc))) want.push(id); }
  const byId = new Map(expenses.map(e => [e.id, e])), legacy = expenses.filter(e => e.source === 'card' && e.id.startsWith('c') && e.date.slice(0, 7) === st.stmt);
  const found = legacy.length ? legacy : want.map(id => byId.get(id)).filter(Boolean);
  const inVault = { n: found.length, total: r2(found.reduce((s, e) => s + e.amount, 0)), pending: found.filter(e => e.auto).length, missing: legacy.length ? 0 : want.length - found.length };
  const mine = links.pairs.filter(p => p.stmt === st.stmt), pays = lines.filter(l => (l.kind || kindOf(l.desc)) === 'payment');
  return { stmt: st.stmt, check: c, byKind: by, expected, expectedN: entries.length, skippedByRule: byRule, inVault, unmatchedRefunds,
    payments: { cardN: pays.length, linked: mine.length, unlinked: pays.filter(p => !mine.some(m => m.cardLineId === p.id)) }, tan: st.tan, limit: st.limit, balance: st.balance };
}

/**
 * Taxa implícita nos juros cobrados: juros ÷ (saldo médio diário × dias ÷ 365). Compara com o TAN impresso para ver se mudou.
 * Período = emissão anterior → emissão atual (quando há); o saldo diário parte do saldo anterior e só desce com pagamentos/estornos (compras do próprio período ainda não rendem juros).
 * Null quando não há juros ou o extrato é do plano de parcelas (taxa própria).
 */
export function impliedTan(st, lines) {
  const interest = r2(lines.filter(l => (l.kind || kindOf(l.desc)) === 'interest').reduce((s, l) => s + l.amount, 0));
  if (!interest || (st.plans && st.plans.length)) return null;
  const day = s => Math.round(Date.parse(s) / 864e5), a = day(st.prevIssue || st.from), b = day(st.issue || st.to), days = b - a;
  if (days <= 0) return null;
  const delta = new Map(), add = (d, v) => delta.set(d, (delta.get(d) || 0) + v);
  for (const l of lines) {
    const k = l.kind || kindOf(l.desc);
    if (k === 'interest' || k === 'stamp') continue;
    if (l.credit) add(Math.max(day(l.valueDate), a), -l.amount);   // compras do próprio período ainda não rendem juros: só o saldo do extrato anterior
  }
  let bal = st.prevBalance ?? 0, sum = 0;
  for (let d = a; d < b; d++) { bal += delta.get(d) || 0; sum += bal; }
  const avg = sum / days;
  return avg > 0 ? { rate: interest / (avg * days / 365) * 100, interest, avg: r2(avg), days } : null;
}

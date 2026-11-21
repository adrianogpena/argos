#!/usr/bin/env node
// Extrato do cartão de crédito -> cofre. Roda no computador do dono; dados nunca vão para o git. Lógica em lib/card-month.js.
//
//   node tools/card.mjs import <extrato.pdf|.txt>... [--apply]   lê (pdftotext -raw), confere cada extrato e grava TUDO em `card-statements` e `card-lines`; liga os pagamentos às linhas do banco
//   node tools/card.mjs months                                   estado de cada extrato: conferência, TAN, limite, saldo, pagamentos ligados, Gastos x esperado
//   node tools/card.mjs month AAAA-MM                            relatório de conferência do extrato (totais por tipo, pagamentos, estornos sem compra)
//   node tools/card.mjs link [--apply]                           (re)liga cada pagamento do cartão à saída da conta à vista (valor igual, até 7 dias)
//   node tools/card.mjs bank-payments [--apply]                  regras "não é gasto" para o pagamento do cartão na conta + apaga esses lançamentos de Gastos (o consumo vem do extrato do cartão)
//   node tools/card.mjs expenses [AAAA-MM] [--apply]             gera os gastos (compras, serviços, juros, selo, taxas) a partir de `card-lines`, sem voltar ao PDF
//   node tools/card.mjs validate AAAA-MM [nota] [--undo] [--apply]   marca o extrato como validado (guarda os totais)
//   node tools/card.mjs tan                                      TAN impresso no extrato x taxa implícita nos juros cobrados (para conferir se mudou)
//
// VAULT_URL e VAULT_TOKEN vêm do ambiente (ou de ~/.argos-vault.env carregado dentro do comando); o token nunca é escrito nem exibido.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { MONTH_STATUS, isMonth } from '../lib/bank-month.js';
import { parseCardText, checkStatement, lineRecords, statementRecord, linkPayments, cardEntries, buildCardRecords, cardReport, impliedTan, CARD_PAYMENT_KEYS, isCardPaymentBank } from '../lib/card-month.js';
import { expenseRecord } from '../lib/expenses-core.js';

const args = process.argv.slice(2), cmd = args[0], rest = args.slice(1), flags = rest.filter(a => a.startsWith('--')), pos = rest.filter(a => !a.startsWith('--'));
const apply = flags.includes('--apply');
const url = (process.env.VAULT_URL || '').replace(/\/$/, ''), token = process.env.VAULT_TOKEN;
const need = () => { if (!/^https:\/\//.test(url) || !token) { console.error('Defina VAULT_URL (https://...) e VAULT_TOKEN no ambiente.'); process.exit(1); } };
async function call(method, path, body) {
  let res;
  for (let t = 1; t <= 5; t++) {
    try { res = await fetch(url + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); } catch { res = null; }
    if (res && res.status < 500) break;
    await new Promise(r => setTimeout(r, 1000 * t));
  }
  if (!res || !res.ok) throw new Error(`cofre respondeu ${res ? res.status : 'sem rede'} em ${method} ${path}`);
  return res.json();
}
const get = async c => (await call('GET', '/v1/c/' + c)).items;
const post = async (c, items) => { for (let i = 0; i < items.length; i += 200) await call('POST', '/v1/c/' + c, { items: items.slice(i, i + 200) }); };
const eur = n => (n ?? 0).toFixed(2) + ' €';
const dry = () => { console.log('\nSimulação: nada foi enviado. Acrescente --apply para gravar.'); process.exit(0); };
const linesOf = (all, stmt) => all.filter(l => l.stmt === stmt).sort((a, b) => a.seq - b.seq);

if (cmd === 'import' && pos.length) {
  const stmts = [];
  for (const f of pos) {
    const text = /\.pdf$/i.test(f) ? execFileSync('pdftotext', ['-raw', f, '-'], { encoding: 'utf8', maxBuffer: 1e8 }) : readFileSync(f, 'utf8');
    for (const s of parseCardText(text)) stmts.push({ ...s, file: f.split(/[\\/]/).pop() });
  }
  stmts.sort((a, b) => a.stmt.localeCompare(b.stmt));
  let bad = 0;
  console.log('# extrato | nº | TAN | limite | saldo | linhas | conferência (saldo | linhas | imputação)');
  for (const s of stmts) { const c = checkStatement(s); if (!c.ok) bad++;
    console.log([s.stmt, s.n, s.tan ?? '-', s.limit ?? '-', eur(s.balance), s.lines.length, c.ok ? 'OK' : `FALHA (${c.balance ? 'saldo ok' : 'SALDO'} | ${c.lines ? 'linhas ok' : 'LINHAS'} | ${c.imputation ? 'imput. ok' : 'IMPUTAÇÃO'})`].join(' | ')); }
  console.log(`\n${stmts.length} extratos, ${stmts.reduce((a, s) => a + s.lines.length, 0)} linhas, ${bad} com falha de conferência.`);
  if (bad) { console.error('Há extratos que não fecham: ache a linha perdida (confira o texto com `pdftotext -raw`) antes de gravar. Nada foi enviado.'); process.exit(1); }
  if (!apply) dry();
  need();
  const [old, bank] = await Promise.all([get('card-statements'), get('bank-lines')]);
  const have = new Map(old.map(x => [x.id, x]));
  const recs = stmts.map(s => { const o = have.get(s.id); return statementRecord(s, { file: s.file, status: o ? o.status : MONTH_STATUS.archived, ...(o && o.validatedAt ? { validatedAt: o.validatedAt, snapshot: o.snapshot, ...(o.note && { note: o.note }) } : {}) }); });
  const lines = stmts.flatMap(lineRecords);
  const link = linkPayments(lines, bank);
  const byCard = new Map(link.pairs.map(p => [p.cardLineId, p]));
  for (const l of lines) { const p = byCard.get(l.id); if (p) { l.bankLineId = p.bankLineId; l.bankDate = p.bankDate; } }
  await post('card-statements', recs); await post('card-lines', lines);
  console.log(`Gravados ${recs.length} extratos em card-statements e ${lines.length} linhas em card-lines.`);
  console.log(`Pagamentos ligados ao banco: ${link.pairs.length} | pagamentos do cartão sem linha no banco: ${link.unmatchedCard.length}`);
  for (const l of link.unmatchedCard) console.log('  sem banco: ' + [l.valueDate, l.amount.toFixed(2), l.desc].join(' | '));
} else if (cmd === 'link') {
  need();
  const [lines, bank] = await Promise.all([get('card-lines'), get('bank-lines')]);
  const link = linkPayments(lines, bank), byCard = new Map(link.pairs.map(p => [p.cardLineId, p]));
  const upd = lines.filter(l => l.kind === 'payment').map(l => { const p = byCard.get(l.id); return p ? { ...l, bankLineId: p.bankLineId, bankDate: p.bankDate } : l; });
  console.log(`# pagamentos do cartão: ${upd.length} | ligados ao banco: ${link.pairs.length} | sem linha no banco: ${link.unmatchedCard.length} | saídas do banco com "cartão de crédito" sem pagamento no cartão: ${link.unmatchedBank.length}`);
  for (const l of link.unmatchedCard) console.log('  cartão sem banco: ' + [l.valueDate, l.amount.toFixed(2), l.desc].join(' | '));
  for (const b of link.unmatchedBank) console.log('  banco sem cartão: ' + [b.date, (-b.amount).toFixed(2), b.desc].join(' | '));
  if (!apply) dry();
  await post('card-lines', upd);
  console.log(`Gravados ${upd.length} pagamentos com o vínculo.`);
} else if (cmd === 'bank-payments') {
  need();
  const [ex, bank] = await Promise.all([get('expenses'), get('bank-lines')]);
  const ids = new Set(bank.filter(isCardPaymentBank).map(b => b.id));
  const hit = ex.filter(x => x.source === 'bank' && CARD_PAYMENT_KEYS.includes(x.key));
  console.log(`# regras "não é gasto" a gravar: ${CARD_PAYMENT_KEYS.join(', ')}`);
  console.log(`# em Gastos hoje, pagamento do cartão na conta (${hit.length}, ${eur(hit.reduce((a, x) => a + x.amount, 0))}) a apagar:`);
  for (const x of hit.sort((a, b) => a.date.localeCompare(b.date))) console.log('  ' + [x.date, x.amount.toFixed(2), x.note].join(' | '));
  if (!apply) dry();
  await post('expense-rules', CARD_PAYMENT_KEYS.map(id => ({ id, skip: true, label: 'Pagamento do cartão (o consumo vem do extrato do cartão)' })));
  for (const x of hit) await call('DELETE', '/v1/c/expenses/' + x.id);
  console.log(`Regras gravadas; apagados ${hit.length} lançamentos.`);
} else if (cmd === 'expenses') {
  need();
  const month = isMonth(pos[0]) ? pos[0] : '';
  const [cl, stm, ex, rules] = await Promise.all([get('card-lines'), get('card-statements'), get('expenses'), get('expense-rules')]);
  const existing = new Set(ex.map(x => x.id)), learned = new Map(rules.map(x => [x.id, x]));
  const legacy = new Set(ex.filter(x => x.source === 'card' && x.id.startsWith('c')).map(x => x.date.slice(0, 7)));   // meses já detalhados à mão (parcelamento 2023-24)
  const all = [];
  console.log('# extrato | gastos novos | total | esperado do extrato | pendentes de revisar | observação');
  for (const s of stm.sort((a, b) => a.stmt.localeCompare(b.stmt))) {
    if (month && s.stmt !== month) continue;
    if (legacy.has(s.stmt)) { console.log([s.stmt, '-', '-', '-', '-', 'já detalhado antes (lançamentos c...): pulado'].join(' | ')); continue; }
    const { entries, unmatchedRefunds } = cardEntries(linesOf(cl, s.stmt));
    const { records, duplicates, skipped } = buildCardRecords(entries, existing, learned);
    const bad = records.map(r => expenseRecord(r)).filter(x => !x.ok);
    if (bad.length) { console.error(`${s.stmt}: registro inválido (${bad[0].error}); nada foi enviado.`); process.exit(1); }
    all.push(...records);
    console.log([s.stmt, records.length, eur(records.reduce((a, r) => a + r.amount, 0)), eur(entries.reduce((a, e) => a + e.amount, 0)), records.filter(r => r.auto).length,
      [duplicates && `${duplicates} já no cofre`, skipped && `${skipped} por regra`, unmatchedRefunds.length && `${unmatchedRefunds.length} estorno(s) sem compra (só informativo)`].filter(Boolean).join('; ') || '-'].join(' | '));
  }
  console.log(`\nTotal: ${all.length} gastos, ${eur(all.reduce((a, r) => a + r.amount, 0))}; juros/selo/taxas: ${eur(all.filter(r => r.ck).reduce((a, r) => a + r.amount, 0))}`);
  if (!apply) dry();
  await post('expenses', all);
  const touched = new Set(all.map(r => r.date.slice(0, 7))), upd = stm.filter(s => touched.has(s.stmt) && s.status === MONTH_STATUS.archived).map(s => ({ ...s, status: MONTH_STATUS.pending, updatedAt: Date.now() }));
  if (upd.length) await post('card-statements', upd);
  console.log(`Gravados ${all.length} gastos do cartão; ${upd.length} extratos agora "pendente".`);
} else if (cmd === 'months') {
  need();
  const [stm, cl, ex, bank, rl] = await Promise.all([get('card-statements'), get('card-lines'), get('expenses'), get('bank-lines'), get('expense-rules')]), skip = new Set(rl.filter(x => x.skip).map(x => x.id));
  const link = linkPayments(cl, bank);
  console.log('# extrato | estado | conferência | TAN | limite | saldo | pagamentos ligados | em Gastos (qtd, total) | esperado | pendentes | faltando');
  for (const s of stm.sort((a, b) => a.stmt.localeCompare(b.stmt))) {
    const r = cardReport(s, linesOf(cl, s.stmt), ex, link, skip);
    console.log([s.stmt, s.status, r.check.ok ? 'OK' : 'FALHA', s.tan ?? '-', s.limit ?? '-', eur(s.balance), `${r.payments.linked}/${r.payments.cardN}`, `${r.inVault.n}, ${eur(r.inVault.total)}`, eur(r.expected), r.inVault.pending, r.inVault.missing ? r.inVault.missing + ' FALTAM' : '-'].join(' | '));
  }
} else if (cmd === 'month' && isMonth(pos[0])) {
  need();
  const [stm, cl, ex, bank, rl] = await Promise.all([get('card-statements'), get('card-lines'), get('expenses'), get('bank-lines'), get('expense-rules')]), skip = new Set(rl.filter(x => x.skip).map(x => x.id));
  const s = stm.find(x => x.id === pos[0]); if (!s) { console.error('Extrato não encontrado em card-statements: ' + pos[0]); process.exit(1); }
  const lines = linesOf(cl, s.stmt), link = linkPayments(cl, bank), r = cardReport(s, lines, ex, link, skip);
  console.log(`# ${s.stmt} (${s.n}) | estado: ${s.status} | arquivo: ${s.file || '-'} | período ${s.from} a ${s.to} | emitido ${s.issue} | pagar até ${s.payDate || '-'}`);
  console.log(`opção de pagamento ${s.optionPct}% | TAN ${s.tan}% | limite ${eur(s.limit)} | total a pagar ${eur(s.totalDue)} | mínimo ${eur(s.minDue)}`);
  console.log(`saldo ${eur(s.prevBalance)} + débitos ${eur(s.debits)} − créditos ${eur(s.credits)} = ${eur(s.balance)} | ${r.check.ok ? 'FECHA' : 'NÃO FECHA ' + JSON.stringify(r.check)}`);
  if (s.paid) console.log(`pago no período: capital ${eur(s.paid.capital)} + juros ${eur(s.paid.interest)} + selo ${eur(s.paid.stamp)} + comissões ${eur(s.paid.fees)} = ${eur(s.paid.total)}`);
  if (s.next?.total) console.log(`próximo pagamento: capital ${eur(s.next.total.capital)} + juros ${eur(s.next.total.interest)} + selo ${eur(s.next.total.stamp)} + comissões ${eur(s.next.total.fees)} = ${eur(s.next.total.total)}`);
  console.log('\n# por tipo: qtd | total'); for (const [k, v] of Object.entries(r.byKind)) console.log(`${k}: ${v.n} | ${eur(v.total)}`);
  console.log(`\nPagamentos do cartão ligados à conta: ${r.payments.linked}/${r.payments.cardN}`);
  for (const l of r.payments.unlinked) console.log('  SEM LINHA NO BANCO: ' + [l.valueDate, l.amount.toFixed(2), l.desc].join(' | '));
  console.log(`Gastos do cartão em Gastos: ${r.inVault.n} (${eur(r.inVault.total)}, ${r.inVault.pending} a revisar) | esperado do extrato: ${r.expectedN} (${eur(r.expected)}${r.skippedByRule ? `, fora ${eur(r.skippedByRule)} por regra "não é gasto"` : ''}) | ${Math.abs(r.inVault.total - r.expected) < 0.015 && !r.inVault.missing ? 'BATE' : 'DIFERE'}`);
  for (const l of r.unmatchedRefunds) console.log('  estorno sem compra (só informativo): ' + [l.date, l.amount.toFixed(2), l.desc].join(' | '));
} else if (cmd === 'validate' && isMonth(pos[0])) {
  need();
  const [stm, cl, ex, bank, rl] = await Promise.all([get('card-statements'), get('card-lines'), get('expenses'), get('bank-lines'), get('expense-rules')]), skip = new Set(rl.filter(x => x.skip).map(x => x.id));
  const s = stm.find(x => x.id === pos[0]); if (!s) { console.error('Extrato não encontrado: ' + pos[0]); process.exit(1); }
  const r = cardReport(s, linesOf(cl, s.stmt), ex, linkPayments(cl, bank), skip), undo = flags.includes('--undo'), note = pos.slice(1).join(' ');
  const problems = [!r.check.ok && 'extrato não fecha', r.payments.unlinked.length && 'pagamento sem linha no banco', (Math.abs(r.inVault.total - r.expected) >= 0.015 || r.inVault.missing) && 'Gastos difere do esperado', r.inVault.pending && 'gastos a revisar'].filter(Boolean);
  console.log(`${pos[0]}: ${undo ? 'reabrir' : 'validar'} | ${problems.length ? 'PROBLEMAS: ' + problems.join(', ') : 'tudo confere'}`);
  if (!undo && problems.length) { console.error('Resolva antes de validar.'); process.exit(1); }
  if (!apply) dry();
  await call('PUT', `/v1/c/card-statements/${s.id}`, undo ? { ...s, status: MONTH_STATUS.pending, validatedAt: null, updatedAt: Date.now() }
    : { ...s, status: MONTH_STATUS.validated, validatedAt: Date.now(), updatedAt: Date.now(), ...(note && { note }), snapshot: { balance: s.balance, expected: r.expected, inVault: r.inVault.total, payments: r.payments.linked } });
  console.log('Gravado em card-statements.');
} else if (cmd === 'tan') {
  need();
  const [stm, cl] = await Promise.all([get('card-statements'), get('card-lines')]);
  console.log('# extrato | TAN impresso | taxa implícita nos juros (juros ÷ saldo médio diário × 365) | juros | saldo médio');
  for (const s of stm.sort((a, b) => a.stmt.localeCompare(b.stmt))) { const t = impliedTan(s, linesOf(cl, s.stmt)); if (t) console.log([s.stmt, s.tan + '%', t.rate.toFixed(2) + '%', eur(t.interest), eur(t.avg)].join(' | ')); }
} else {
  console.error('uso: node tools/card.mjs import <pdf>... [--apply] | months | month AAAA-MM | link | bank-payments | expenses [AAAA-MM] | validate AAAA-MM | tan'); process.exit(1);
}

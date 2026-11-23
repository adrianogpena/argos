#!/usr/bin/env node
// Ponte entre o Claude (que lê o extrato) e o cofre. Roda no computador do dono; dados nunca vão para o git.
//
//   node tools/expenses.mjs rules                       lista as regras (categoria/tipo ou "não é gasto" por comerciante) e as categorias em uso
//   node tools/expenses.mjs rule <chave> --skip [rótulo]            grava regra "não é gasto" (poupança, transferência própria...)
//   node tools/expenses.mjs rule <chave> <categoria> <essential|flexible|-> [rótulo]   grava regra de categoria
//   node tools/expenses.mjs review [AAAA-MM] [--motivo=X|--sem-motivo] [--links] [--html=f.html] [--sugerir=decisoes.json]   pendentes por comerciante (chaves unificadas), maiores primeiro; --html gera tela com links de busca; --sugerir grava as decisões de alta confiança (ramo no texto do banco)
//   node tools/expenses.mjs groups                      lista TODOS os gastos por comerciante (chave, qtd, total, categoria, tipo, rótulo, exemplo)
//   node tools/expenses.mjs label <rotulos.json> [--apply]    rotula gastos já gravados: [{key|id, label}] (simula sem --apply)
//   node tools/expenses.mjs confirm <decisoes.json> [--apply]   aplica decisões [{key, keys?, category, need, label, confirm, motivo}] (simula sem --apply)
//   node tools/expenses.mjs months [--init]            estado de cada mês do extrato (arquivado | pendente | validado); --init cria os registros em `bank-months`
//   node tools/expenses.mjs month AAAA-MM [--lines]     relatório de conferência do mês (saldos, em Gastos x fora, entradas) para validar com o banco
//   node tools/expenses.mjs validate AAAA-MM [nota] [--undo] [--apply]   marca o mês como validado (guarda os totais); --undo reabre
//   node tools/expenses.mjs raw <linhas.json> [--file=nome.pdf] [--apply]   arquiva (cada linha leva stmt=AAAA-MM do extrato e file) TODAS as linhas do extrato em `bank-lines` (invisível nas telas; só para conferência)
//   node tools/expenses.mjs card <cartao.json> [--apply]   grava gastos do cartão de crédito (source 'card', data da compra): [{date,amount,desc,category,need,label,inst:{n,of,left,last}}]
//   node tools/expenses.mjs drop <chave> <AAAA-MM> <AAAA-MM> [--apply]   apaga os gastos do extrato com essa chave entre os dois meses (ex.: o pagamento único do cartão que foi detalhado)
//   node tools/expenses.mjs push <entradas.json>        simulação: mostra o que seria gravado
//   node tools/expenses.mjs push <entradas.json> --apply   grava no cofre
//
// <entradas.json> = [{ "date":"AAAA-MM-DD", "amount":12.5, "desc":"texto do banco", "category":"Mercado", "need":"essential|flexible", "label":"Supermercado" }]
// amount sempre positivo (só gastos). VAULT_URL e VAULT_TOKEN vêm do ambiente; o token nunca é escrito em arquivo nem exibido.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { monthReport, isMonth, MONTH_STATUS } from '../lib/bank-month.js';
import { bankId, descKey, buildRecords, pendingGroups, merchantGroups, applyDecisions, applyLabels, displayName, searchUrl, inferBranch, recurrenceHint, isIntermediary, canonMotivo, GENERIC_KEYS } from '../lib/classify.js';
import { expenseRecord, categoryOptions, canonicalCategory } from '../lib/expenses-core.js';

const [cmd, file, ...flags] = process.argv.slice(2);
const plainKey = s => /^[a-z0-9-]{1,40}$/.test(s);
const url = (process.env.VAULT_URL || '').replace(/\/$/, ''), token = process.env.VAULT_TOKEN;
const haveVault = /^https:\/\//.test(url) && !!token;

async function call(method, path, body) {
  let res;
  for (let tent = 1; tent <= 5; tent++) {            // 5xx/rede são passageiros: repete com espera
    try { res = await fetch(url + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); } catch { res = null; }
    if (res && res.status < 500) break;
    await new Promise(r => setTimeout(r, 1000 * tent));
  }
  if (!res || !res.ok) throw new Error(`cofre respondeu ${res ? res.status : 'sem rede'} em ${method} ${path}`);
  return res.json();
}
const need = () => { if (!haveVault) { console.error('Defina VAULT_URL (https://...) e VAULT_TOKEN no ambiente.'); process.exit(1); } };

if (cmd === 'rules') {
  need();
  const [r, e] = await Promise.all([call('GET', '/v1/c/expense-rules'), call('GET', '/v1/c/expenses')]);
  console.log('# regras aprendidas: chave | categoria | tipo | rótulo | exemplo');
  for (const x of r.items.sort((a, b) => a.id.localeCompare(b.id))) console.log([x.id, x.skip ? 'NÃO É GASTO' : x.category, x.skip ? '-' : x.need || '-', x.tag || '-', x.label || ''].join(' | '));
  const cats = new Map(); for (const x of e.items) cats.set(x.category, (cats.get(x.category) || 0) + 1);
  console.log('\n# categorias em uso (qtd)');
  for (const [c, n] of [...cats].sort((a, b) => b[1] - a[1])) console.log(`${c} (${n})`);
} else if (cmd === 'review') {
  // review [AAAA-MM] [--motivo=X|--sem-motivo] [--links] [--html=arquivo.html] [--sugerir=decisoes.json]
  need();
  const month = isMonth(file) ? file : '', fl = isMonth(file) ? flags : [file, ...flags].filter(Boolean);
  const opt = n => (fl.find(f => f.startsWith('--' + n + '=')) || '').slice(n.length + 3);
  const e = await call('GET', '/v1/c/expenses');
  const nifOf = new Map((await call('GET', '/v1/c/receipt-qr')).items.filter(q => q.expenseId).map(q => [q.expenseId, q.nif]));   // NIF do emitente (QR da fatura) por lançamento
  let g = pendingGroups(e.items, { merge: true, month });
  const mo = opt('motivo'); if (mo) g = g.filter(x => x.motivo === canonMotivo(mo)); if (fl.includes('--sem-motivo')) g = g.filter(x => !x.motivo);
  const nAuto = e.items.filter(x => x.auto && (!month || x.date.startsWith(month))).length;
  const rows = g.map(x => { const nifs = [...new Set(e.items.filter(y => y.auto && x.keys.includes(y.key || descKey(y.note))).map(y => nifOf.get(y.id)).filter(Boolean))], nm = displayName(x.example), person = x.motivo === 'pessoa' || x.keys.some(k => GENERIC_KEYS.has(k));
    return { ...x, nifs, nm, url: person ? '' : searchUrl(nm), ramo: person ? null : inferBranch(x.example, x.keys[0]), hint: recurrenceHint(x), interm: x.keys.some(isIntermediary) }; });
  console.log(`# pendentes${month ? ' de ' + month : ''}: ${nAuto} lançamentos em ${rows.length} comerciantes, maiores primeiro. Grupo = chaves unificadas (use o id do grupo no confirm).`);
  console.log('# id do grupo (chaves) | qtd | total € | média € | de → a | categoria atual | tipo | rótulo | motivo | sinais | exemplo');
  for (const x of rows) {
    console.log([x.key + (x.keys.length > 1 ? ' (' + x.keys.join(',') + ')' : ''), x.n, x.total.toFixed(2), x.avg.toFixed(2), x.from + '→' + x.to, x.category + (x.mixed ? '*' : ''), x.need || '-', x.label || '-', x.motivo || '-',
      [x.nifs.length && 'nif:' + x.nifs.join('/'), x.interm && 'intermediário', x.ramo && 'ramo-no-texto:' + x.ramo.label, x.hint].filter(Boolean).join(';') || '-', x.example].join(' | '));
    if (fl.includes('--links') && x.url) console.log('    ' + x.url);
  }
  const sug = opt('sugerir');
  if (sug) {
    const d = rows.filter(x => x.ramo && !x.interm && x.keys.every(k => !GENERIC_KEYS.has(k)) && !x.motivo).map(x => ({ key: x.key, category: x.ramo.category, need: x.ramo.need, label: x.ramo.label, confirm: true }));
    writeFileSync(sug, JSON.stringify(d, null, 1));
    console.log('');
    console.log(`Sugeridas ${d.length} decisões de alta confiança (ramo declarado no texto do banco) em ${sug}.`);
  }
  const html = opt('html');
  if (html) {
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const tr = rows.map(x => `<tr><td><b>${esc(x.nm)}</b><br><small>${esc(x.keys.join(', '))}</small></td><td>${x.n}</td><td>${x.total.toFixed(2)}</td><td>${x.from}<br>${x.to}</td><td>${esc(x.category)}${x.label ? ' › ' + esc(x.label) : ''}</td><td>${esc(x.motivo || '')}${x.interm ? ' intermediário' : ''}${x.hint ? '<br><small>' + esc(x.hint) + '</small>' : ''}</td><td>${x.url ? '<a target="_blank" rel="noopener" href="' + esc(x.url) + '">pesquisar</a>' : '—'}</td></tr>`).join('\n');
    writeFileSync(html, `<!doctype html><meta charset="utf-8"><title>Pendentes ${esc(month)}</title><style>body{font:14px system-ui;margin:1rem}table{border-collapse:collapse}td,th{border-bottom:1px solid #8884;padding:.35rem .6rem;text-align:left;vertical-align:top}th{position:sticky;top:0;background:Canvas}</style><h1>Pendentes ${esc(month)} (${rows.length} comerciantes)</h1><table><tr><th>Comerciante<th>Qtd<th>Total €<th>Datas<th>Proposta<th>Dúvida<th>Busca</tr>${tr}</table>`);
    console.log('');
    console.log('Página gerada: ' + html + ' (fora do git; contém dados reais).');
  }
} else if (cmd === 'groups') {
  need();
  const e = await call('GET', '/v1/c/expenses');
  const g = merchantGroups(e.items);
  console.log(`# ${e.items.length} lançamentos em ${g.length} comerciantes (chave | qtd | total € | categoria | tipo | rótulo | exemplo)`);
  for (const x of g) console.log([x.key, x.n, x.total.toFixed(2), x.category, x.need || '-', x.label || '-', x.example].join(' | '));
} else if (cmd === 'label' && file) {
  need();
  const decisions = JSON.parse(readFileSync(file, 'utf8'));
  const [r, e] = await Promise.all([call('GET', '/v1/c/expense-rules'), call('GET', '/v1/c/expenses')]);
  const out = applyLabels(e.items, decisions, new Map(r.items.map(x => [x.id, x])));
  out.errors.forEach(x => console.error('AVISO ' + x));
  const bad = out.updates.map(u => expenseRecord(u)).filter(x => !x.ok);
  if (bad.length) { console.error('Registro inválido; nada foi enviado.'); process.exit(1); }
  const sum = new Map(); for (const u of out.updates) if (u.label) sum.set(u.category + ' > ' + u.label, (sum.get(u.category + ' > ' + u.label) || 0) + 1);
  for (const [k, n] of [...sum].sort()) console.log(`${k}: ${n}`);
  console.log(`Rotulados: ${out.labeled} | regras atualizadas: ${out.rules.length} | avisos: ${out.errors.length}`);
  if (!flags.includes('--apply')) { console.log('\nSimulação: nada foi enviado. Acrescente --apply para gravar.'); process.exit(0); }
  for (let i = 0; i < out.updates.length; i += 200) await call('POST', '/v1/c/expenses', { items: out.updates.slice(i, i + 200) });
  for (let i = 0; i < out.rules.length; i += 200) await call('POST', '/v1/c/expense-rules', { items: out.rules.slice(i, i + 200) });  // lote: 1 gravação no KV, não 1 por regra
  console.log(`Gravados ${out.updates.length} lançamentos e ${out.rules.length} regras.`);
} else if (cmd === 'confirm' && file) {
  need();
  const decisions = JSON.parse(readFileSync(file, 'utf8'));
  const e = await call('GET', '/v1/c/expenses');
  const opts = categoryOptions(e.items);
  const r = applyDecisions(e.items, decisions, c => canonicalCategory(c, opts));
  r.errors.forEach(x => console.error('RECUSADA ' + x)); r.warnings.forEach(x => console.error('AVISO ' + x));
  const bad = r.updates.map(u => expenseRecord(u)).filter(x => !x.ok);
  if (bad.length) { console.error('Registro inválido; nada foi enviado.'); process.exit(1); }
  const news = [...new Set(r.updates.map(u => u.category))].filter(c => !opts.includes(c));
  console.log(`Confirmados: ${r.confirmed} (viram regra: ${r.rules.length}) | com dúvida (seguem "revisar"): ${r.doubtful} | avisos: ${r.errors.length}`);
  if (news.length) console.log('Categorias novas: ' + news.join(', '));
  if (r.doubtful) console.log('Dúvidas por motivo: ' + Object.entries(r.byMotivo).map(([m, n]) => m + ' ' + n).join(' | '));
  if (!flags.includes('--apply')) { console.log('\nSimulação: nada foi enviado. Acrescente --apply para gravar.'); process.exit(0); }
  for (let i = 0; i < r.updates.length; i += 200) await call('POST', '/v1/c/expenses', { items: r.updates.slice(i, i + 200) });
  for (let i = 0; i < r.rules.length; i += 200) await call('POST', '/v1/c/expense-rules', { items: r.rules.slice(i, i + 200) });  // lote: 1 gravação no KV, não 1 por regra
  console.log(`Gravados ${r.updates.length} lançamentos e ${r.rules.length} regras.`);
} else if (cmd === 'rule' && file) {
  need();
  if (!plainKey(file)) { console.error('chave inválida (minúsculas, números e hífens, até 40)'); process.exit(1); }
  const [a, b, ...rest] = flags;
  const rec = a === '--skip' ? { id: file, skip: true, label: (b ? [b, ...rest].join(' ') : '').slice(0, 60) }
    : a ? { id: file, category: a.trim().slice(0, 40), need: b === 'essential' || b === 'flexible' ? b : '', label: rest.join(' ').slice(0, 60) } : null;
  if (!rec) { console.error('uso: rule <chave> --skip [rótulo] | rule <chave> <categoria> <essential|flexible|-> [rótulo]'); process.exit(1); }
  await call('PUT', `/v1/c/expense-rules/${rec.id}`, rec);
  console.log('Regra gravada:', rec.skip ? `${rec.id} → não é gasto` : `${rec.id} → ${rec.category} (${rec.need || 'sem tipo'})`);
} else if (cmd === 'push' && file) {
  const entries = JSON.parse(readFileSync(file, 'utf8'));
  let existing = new Set(), learned = new Map();
  if (haveVault) {
    const [r, e] = await Promise.all([call('GET', '/v1/c/expense-rules'), call('GET', '/v1/c/expenses')]);
    existing = new Set(e.items.map(x => x.id)); learned = new Map(r.items.map(x => [x.id, x]));
  } else console.log('(sem VAULT_URL/VAULT_TOKEN: não consegui checar duplicados nem regras aprendidas)');
  const { records, duplicates, skipped, errors } = buildRecords(entries, existing, learned);
  const bad = records.map(r => expenseRecord(r)).filter(x => !x.ok);
  errors.forEach(x => console.error('ERRO ' + x));
  if (errors.length || bad.length) { console.error('Corrija as entradas e rode de novo. Nada foi enviado.'); process.exit(1); }
  const byMonth = new Map(); for (const r of records) { const m = r.date.slice(0, 7); const v = byMonth.get(m) || { n: 0, sum: 0 }; v.n++; v.sum += r.amount; byMonth.set(m, v); }
  for (const [m, v] of [...byMonth].sort()) console.log(`${m}: ${v.n} gastos, ${v.sum.toFixed(2)} €`);
  console.log(`Novos: ${records.length} | já no cofre (mantidos): ${duplicates} | descartados por regra "não é gasto": ${skipped}`);
  if (!flags.includes('--apply')) { console.log('\nSimulação: nada foi enviado. Acrescente --apply para gravar.'); process.exit(0); }
  need();
  for (let i = 0; i < records.length; i += 200) await call('POST', '/v1/c/expenses', { items: records.slice(i, i + 200) });
  console.log(`Gravados ${records.length} gastos no cofre.`);
} else if (cmd === 'card' && file) {
  // Gastos do cartão de crédito: ficam na data da compra e substituem o pagamento único da fatura (ver `drop`). Id estável: repetir sobrescreve.
  const entries = JSON.parse(readFileSync(file, 'utf8')), seen = new Map(), items = [];
  for (const [i, e] of entries.entries()) {
    const amount = Math.round(Number(e.amount) * 100) / 100, desc = String(e.desc || '').replace(/\s+/g, ' ').trim();
    const id = 'c' + bankId(e.date, amount, desc, seen).slice(1);
    const r = expenseRecord({ id, date: e.date, amount, category: e.category, need: e.need, label: e.label, note: desc, source: 'card', card: true, inst: e.inst, key: descKey(desc) });
    if (!r.ok) { console.error(`ERRO entrada ${i + 1}: ${r.error}. Nada foi enviado.`); process.exit(1); }
    items.push(r.rec);
  }
  const byMonth = new Map(); for (const r of items) { const m = r.date.slice(0, 7); byMonth.set(m, (byMonth.get(m) || 0) + r.amount); }
  for (const [m, v] of [...byMonth].sort()) console.log(`${m}: ${v.toFixed(2)} €`);
  console.log(`Total: ${items.reduce((a, r) => a + r.amount, 0).toFixed(2)} € em ${items.length} lançamentos do cartão`);
  if (!flags.includes('--apply')) { console.log('\nSimulação: nada foi enviado. Acrescente --apply para gravar.'); process.exit(0); }
  need();
  await call('POST', '/v1/c/expenses', { items });
  console.log(`Gravados ${items.length} gastos do cartão.`);
} else if (cmd === 'drop' && file && isMonth(flags[0]) && isMonth(flags[1])) {
  need();
  const e = await call('GET', '/v1/c/expenses');
  const hit = e.items.filter(x => x.source === 'bank' && x.key === file && x.date.slice(0, 7) >= flags[0] && x.date.slice(0, 7) <= flags[1]);
  for (const x of hit.sort((a, b) => a.date.localeCompare(b.date))) console.log([x.date, x.amount.toFixed(2), x.note, x.id].join(' | '));
  console.log(`Total: ${hit.reduce((a, x) => a + x.amount, 0).toFixed(2)} € em ${hit.length} lançamentos`);
  if (!flags.includes('--apply')) { console.log('\nSimulação: nada foi apagado. Acrescente --apply.'); process.exit(0); }
  for (const x of hit) await call('DELETE', '/v1/c/expenses/' + x.id);
  console.log(`Apagados ${hit.length}.`);
} else if (cmd === 'months') {
  // Estado de cada mês do extrato em `bank-months`: arquivado (só em bank-lines) | pendente (já em Gastos, falta validar) | validado.
  need();
  const [bl, ex, bm] = await Promise.all([call('GET', '/v1/c/bank-lines'), call('GET', '/v1/c/expenses'), call('GET', '/v1/c/bank-months')]);
  const have = new Map(bm.items.map(x => [x.id, x]));
  const stmts = [...new Set(bl.items.map(x => x.stmt))].sort();
  const created = [];
  for (const s of stmts) if (!have.has(s)) {
    const inSite = ex.items.some(e => e.source === 'bank' && e.date.slice(0, 7) === s);
    const rec = { id: s, stmt: s, status: inSite ? MONTH_STATUS.pending : MONTH_STATUS.archived, file: bl.items.find(x => x.stmt === s).file || '', updatedAt: Date.now() };
    created.push(rec); have.set(s, rec);
  }
  if (created.length && [file, ...flags].includes('--init')) { await call('POST', '/v1/c/bank-months', { items: created }); console.log(`Criados ${created.length} meses em bank-months.\n`); }
  else if (created.length) console.log(`(${created.length} meses ainda sem registro; rode com --init para criar)\n`);
  console.log('# mês | estado | linhas no banco | gastos em Gastos | arquivo | validado em');
  for (const s of stmts) {
    const m = have.get(s);
    console.log([s, m.status, bl.items.filter(x => x.stmt === s).length, ex.items.filter(e => e.source === 'bank' && e.date.slice(0, 7) === s).length, m.file || '-', m.validatedAt ? new Date(m.validatedAt).toISOString().slice(0, 10) : '-'].join(' | '));
  }
} else if (cmd === 'month' && isMonth(file)) {
  // Relatório de conferência de um mês: confira com o extrato do banco e depois rode `validate`.
  need();
  const [bl, ex, bm] = await Promise.all([call('GET', '/v1/c/bank-lines'), call('GET', '/v1/c/expenses'), call('GET', '/v1/c/bank-months')]);
  const r = monthReport(file, bl.items, ex.items), rec = bm.items.find(x => x.id === file);
  if (!r.accounts.length) { console.error('Nenhuma linha do banco para ' + file); process.exit(1); }
  const eur = n => n.toFixed(2) + ' €';
  console.log(`# ${file} | estado: ${rec ? rec.status : '(sem registro)'} | arquivo: ${r.file || '-'}`);
  for (const a of r.accounts) console.log(`conta ${a.account}: saldo ${eur(a.opening)} → ${eur(a.closing)} | ${a.lines} linhas | entradas ${eur(a.credits)} | saídas ${eur(a.debits)} | ${a.balanced ? 'fecha' : 'NÃO FECHA'}`);
  console.log(`\nSaídas da conta à vista: ${eur(r.bankDebits)}  =  em Gastos ${eur(r.site.total)} (${r.site.n} lançamentos, ${r.pendingReview} ainda "revisar")  +  fora de Gastos ${eur(r.outside.total)} (${r.outside.n})`);
  if (r.card.n) console.log(`Gastos do cartão de crédito com data neste mês (fora da conta à vista, não entram na linha acima): ${eur(r.card.total)} (${r.card.n} lançamentos)`);
  console.log('\n# fora de Gastos (regra "não é gasto" ou não importado): chave | qtd | total | exemplo');
  for (const g of r.outsideGroups) console.log([g.key, g.n, g.total.toFixed(2), g.example].join(' | '));
  console.log('\n# entradas (nunca são gasto): chave | qtd | total | exemplo');
  for (const g of r.incomeGroups) console.log([g.key, g.n, g.total.toFixed(2), g.example].join(' | '));
  if (r.siteNotInBank.length) { console.log('\n# em Gastos neste mês SEM linha do banco (manuais ou de outra origem): data | valor | nota'); for (const x of r.siteNotInBank) console.log([x.date, x.amount.toFixed(2), x.note || x.id].join(' | ')); }
  if (flags.includes('--lines')) { console.log('\n# todas as saídas: data | valor | em Gastos? | texto do banco'); for (const d of r.debitLines) console.log([d.date, (-d.amount).toFixed(2), d.inExpenses ? 'sim' : 'NÃO', d.desc].join(' | ')); }
} else if (cmd === 'validate' && isMonth(file)) {
  // Marca o mês como validado (ou reabre com --undo), guardando os totais do momento para detectar mudança depois.
  need();
  const [bl, ex, bm] = await Promise.all([call('GET', '/v1/c/bank-lines'), call('GET', '/v1/c/expenses'), call('GET', '/v1/c/bank-months')]);
  const r = monthReport(file, bl.items, ex.items), old = bm.items.find(x => x.id === file);
  if (!r.accounts.length) { console.error('Nenhuma linha do banco para ' + file); process.exit(1); }
  const undo = flags.includes('--undo'), note = flags.filter(f => !f.startsWith('--')).join(' ');
  const rec = undo ? { ...(old || { id: file, stmt: file }), status: MONTH_STATUS.pending, validatedAt: null, updatedAt: Date.now() }
    : { ...(old || { id: file, stmt: file, file: r.file }), status: MONTH_STATUS.validated, validatedAt: Date.now(), updatedAt: Date.now(), ...(note && { note }),
        snapshot: { bankDebits: r.bankDebits, siteTotal: r.site.total, siteN: r.site.n, outsideTotal: r.outside.total, pendingReview: r.pendingReview, closing: r.accounts.find(a => a.account === 'SIMPLES')?.closing ?? null } };
  console.log(`${file}: ${undo ? 'reabrir (pendente)' : 'validar'} | em Gastos ${r.site.total.toFixed(2)} € (${r.site.n}) | fora ${r.outside.total.toFixed(2)} € | ainda "revisar": ${r.pendingReview}`);
  if (!flags.includes('--apply')) { console.log('Simulação: nada foi gravado. Acrescente --apply.'); process.exit(0); }
  await call('PUT', `/v1/c/bank-months/${file}`, rec);
  console.log('Gravado em bank-months.');
} else if (cmd === 'raw' && file) {
  // Arquivo morto do extrato: TODA linha (gastos, entradas, poupança, transferências), fiel ao banco. Coleção `bank-lines`,
  // que nenhuma tela nem relatório lê; serve só para conferir o extrato original. Id = hash estável: reimportar não duplica.
  const lines = JSON.parse(readFileSync(file, 'utf8'));
  const seen = new Map();
  const srcFile = (flags.find(f => f.startsWith('--file=')) || '').slice(7);   // arquivo de origem (opcional)
  const items = lines.map(l => {
    const base = [l.accountNo, l.date, l.valueDate, l.desc, l.amount.toFixed(2), l.balance.toFixed(2)].join('|');
    const n = seen.get(base) || 0; seen.set(base, n + 1);
    const stmt = l.stmt || l.period.split('/')[1].slice(0, 7);   // mês do extrato (AAAA-MM), pelo fim do período da seção
    return { id: 'b' + createHash('sha1').update(base + '|' + n).digest('hex').slice(0, 20), ...l, stmt, ...(srcFile ? { file: srcFile } : {}) };
  });
  const byYear = new Map(); for (const x of items) byYear.set(x.date.slice(0, 7), (byYear.get(x.date.slice(0, 7)) || 0) + 1);
  console.log(`${items.length} linhas (${[...byYear].sort().map(([m, n]) => m + ':' + n).join(' ')})`);
  if (!flags.includes('--apply')) { console.log('Simulação: nada foi enviado. Acrescente --apply para gravar.'); process.exit(0); }
  need();
  for (let i = 0; i < items.length; i += 200) await call('POST', '/v1/c/bank-lines', { items: items.slice(i, i + 200) });
  console.log(`Gravadas ${items.length} linhas em bank-lines.`);
} else {
  console.error('uso: node tools/expenses.mjs rules | rule <chave> ... | review | groups | label <rotulos.json> | confirm <decisoes.json> | push <entradas.json> [--apply] | months | month AAAA-MM | validate AAAA-MM | raw <linhas.json> [--apply]'); process.exit(1);
}

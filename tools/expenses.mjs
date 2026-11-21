#!/usr/bin/env node
// Ponte entre o Claude (que lê o extrato) e o cofre. Roda no computador do dono; dados nunca vão para o git.
//
//   node tools/expenses.mjs rules                       lista as regras (categoria/tipo ou "não é gasto" por comerciante) e as categorias em uso
//   node tools/expenses.mjs rule <chave> --skip [rótulo]            grava regra "não é gasto" (poupança, transferência própria...)
//   node tools/expenses.mjs rule <chave> <categoria> <essential|flexible|-> [rótulo]   grava regra de categoria
//   node tools/expenses.mjs review                      lista os gastos pendentes (palpite a confirmar) agrupados por comerciante
//   node tools/expenses.mjs confirm <decisoes.json> [--apply]   aplica decisões [{key, category, need, confirm}] (simula sem --apply)
//   node tools/expenses.mjs push <entradas.json>        simulação: mostra o que seria gravado
//   node tools/expenses.mjs push <entradas.json> --apply   grava no cofre
//
// <entradas.json> = [{ "date":"AAAA-MM-DD", "amount":12.5, "desc":"texto do banco", "category":"Mercado", "need":"essential|flexible" }]
// amount sempre positivo (só gastos). VAULT_URL e VAULT_TOKEN vêm do ambiente; o token nunca é escrito em arquivo nem exibido.
import { readFileSync } from 'node:fs';
import { buildRecords, pendingGroups, applyDecisions } from '../lib/classify.js';
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
  console.log('# regras aprendidas: chave | categoria | tipo | exemplo');
  for (const x of r.items.sort((a, b) => a.id.localeCompare(b.id))) console.log([x.id, x.skip ? 'NÃO É GASTO' : x.category, x.skip ? '-' : x.need || '-', x.label || ''].join(' | '));
  const cats = new Map(); for (const x of e.items) cats.set(x.category, (cats.get(x.category) || 0) + 1);
  console.log('\n# categorias em uso (qtd)');
  for (const [c, n] of [...cats].sort((a, b) => b[1] - a[1])) console.log(`${c} (${n})`);
} else if (cmd === 'review') {
  need();
  const e = await call('GET', '/v1/c/expenses');
  const g = pendingGroups(e.items);
  console.log(`# pendentes: ${e.items.filter(x => x.auto).length} lançamentos em ${g.length} comerciantes (chave | qtd | total € | categoria atual | tipo | exemplo)`);
  for (const x of g) console.log([x.key, x.n, x.total.toFixed(2), x.category, x.need || '-', x.example].join(' | '));
} else if (cmd === 'confirm' && file) {
  need();
  const decisions = JSON.parse(readFileSync(file, 'utf8'));
  const e = await call('GET', '/v1/c/expenses');
  const opts = categoryOptions(e.items);
  const r = applyDecisions(e.items, decisions, c => canonicalCategory(c, opts));
  r.errors.forEach(x => console.error('AVISO ' + x));
  const bad = r.updates.map(u => expenseRecord(u)).filter(x => !x.ok);
  if (bad.length) { console.error('Registro inválido; nada foi enviado.'); process.exit(1); }
  const news = [...new Set(r.updates.map(u => u.category))].filter(c => !opts.includes(c));
  console.log(`Confirmados: ${r.confirmed} (viram regra: ${r.rules.length}) | com dúvida (seguem "revisar"): ${r.doubtful} | avisos: ${r.errors.length}`);
  if (news.length) console.log('Categorias novas: ' + news.join(', '));
  if (!flags.includes('--apply')) { console.log('\nSimulação: nada foi enviado. Acrescente --apply para gravar.'); process.exit(0); }
  for (let i = 0; i < r.updates.length; i += 200) await call('POST', '/v1/c/expenses', { items: r.updates.slice(i, i + 200) });
  for (const x of r.rules) await call('PUT', `/v1/c/expense-rules/${x.id}`, x);
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
} else {
  console.error('uso: node tools/expenses.mjs rules | rule <chave> ... | review | confirm <decisoes.json> | push <entradas.json> [--apply]'); process.exit(1);
}

#!/usr/bin/env node
// Importação única do e-fatura (Portal das Finanças) para o cofre, em lotes diários por causa da cota de gravações do KV.
// Os dados ficam FORA do git, em EFATURA_DIR (padrão ~/.argos-efatura): rows.json (linhas lidas do site), plan.json, state.json.
//
//   node tools/efatura.mjs build            lê rows.json + cofre (expenses, qr-merchants), liga faturas a lançamentos, grava plan.json e resumo
//   node tools/efatura.mjs status           quanto já foi enviado, quanto falta, cota de hoje
//   node tools/efatura.mjs push [--apply] [--per-day=600]   simula (ou grava) o próximo lote do dia
// Ordem do envio: qr-merchants (NIF -> nome e categoria), depois efatura (1 registro por fatura, id = NIF-ATCUD, com expenseId quando ligada).
// VAULT_URL e VAULT_TOKEN vêm do ambiente (~/.argos-vault.env); o token nunca é escrito em arquivo nem exibido.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseRow, matchInvoices, merchantSuggestions, merchantRecords, invoiceRecord, nextBatches, recordBatch, isVoid } from '../lib/efatura.js';

const [cmd, ...flags] = process.argv.slice(2);
const dir = process.env.EFATURA_DIR || join(homedir(), '.argos-efatura');
const f = n => join(dir, n);
const url = (process.env.VAULT_URL || '').replace(/\/$/, ''), token = process.env.VAULT_TOKEN;
const opt = n => (flags.find(x => x.startsWith('--' + n + '=')) || '').slice(n.length + 3);
const today = new Date().toISOString().slice(0, 10);   // a cota do KV zera à meia-noite UTC
const readJson = (n, d) => existsSync(f(n)) ? JSON.parse(readFileSync(f(n), 'utf8')) : d;

async function call(method, path, body) {
  let res;
  for (let t = 1; t <= 5; t++) {
    try { res = await fetch(url + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); } catch { res = null; }
    if (res && res.status < 500) break;
    if (res && res.status === 500 && method !== 'GET') break;   // 500 ao gravar = cota diária do KV: não insistir
    await new Promise(r => setTimeout(r, 1000 * t));
  }
  if (!res || !res.ok) throw new Error(`cofre respondeu ${res ? res.status : 'sem rede'} em ${method} ${path}`);
  return res.json();
}
const need = () => { if (!/^https:\/\//.test(url) || !token) { console.error('Defina VAULT_URL (https://...) e VAULT_TOKEN no ambiente.'); process.exit(1); } };

if (cmd === 'build') {
  need();
  const raw = readJson('rows.json');
  if (!raw) { console.error('Falta ' + f('rows.json')); process.exit(1); }
  const invoices = [...new Map(raw.rows.map(parseRow).filter(Boolean).map(i => [i.id, i])).values()];
  const [e, m] = await Promise.all([call('GET', '/v1/c/expenses'), call('GET', '/v1/c/qr-merchants')]);
  const links = matchInvoices(invoices, e.items);
  const sug = merchantSuggestions(invoices, links, e.items);
  const merchants = merchantRecords(sug, m.items.map(x => x.id));
  const records = invoices.map(i => invoiceRecord(i, links.get(i.id))).sort((a, b) => a.date < b.date ? 1 : -1);
  writeFileSync(f('plan.json'), JSON.stringify({ built: today, plan: { 'qr-merchants': merchants, efatura: records } }));
  const byConf = { alta: 0, media: 0, baixa: 0 }; for (const s of sug) byConf[s.conf]++;
  const live = invoices.filter(i => !isVoid(i));
  console.log(`faturas ${invoices.length} (válidas ${live.length}); ligadas a Gastos ${links.size}; sem lançamento ${live.length - links.size}`);
  console.log(`emitentes com ligação ${sug.length}: alta ${byConf.alta}, média ${byConf.media}, baixa ${byConf.baixa}; qr-merchants a gravar ${merchants.length}`);
  console.log(`total de gravações no plano: ${merchants.length + records.length}`);
} else if (cmd === 'status') {
  const p = readJson('plan.json'), st = readJson('state.json', {});
  if (!p) { console.error('Rode build antes.'); process.exit(1); }
  let tot = 0, sent = 0;
  for (const [c, items] of Object.entries(p.plan)) { const s = new Set(st.sent?.[c] || []), n = items.filter(x => s.has(x.id)).length; tot += items.length; sent += n; console.log(`${c}: ${n}/${items.length}`); }
  console.log(`total ${sent}/${tot}; gravados hoje (${today}): ${st.days?.[today] || 0}`);
  console.log(sent === tot ? 'completo.' : 'faltam ' + (tot - sent) + ' registros.');
} else if (cmd === 'push') {
  need();
  const p = readJson('plan.json');
  if (!p) { console.error('Rode build antes.'); process.exit(1); }
  const apply = flags.includes('--apply'), perDay = Number(opt('per-day')) || 600;
  let st = readJson('state.json', {});
  const batches = nextBatches(p.plan, st, today, perDay);
  const n = batches.reduce((a, b) => a + b.items.length, 0);
  console.log(`${apply ? 'gravando' : 'simulação:'} ${n} registros hoje (limite ${perDay}/dia, já gravados hoje ${st.days?.[today] || 0})`);
  for (const b of batches) console.log(`  ${b.collection}: ${b.items.length}`);
  if (apply) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    for (const b of batches) {
      try { await call('POST', '/v1/c/' + b.collection, { items: b.items }); }
      catch (err) { console.error(err.message + '. Parei; o que já foi enviado está registrado. Tente depois da meia-noite UTC.'); break; }
      st = recordBatch(st, today, b.collection, b.items);
      writeFileSync(f('state.json'), JSON.stringify(st));
    }
  }
} else {
  console.error('Uso: build | status | push [--apply] [--per-day=N]');
  process.exit(1);
}

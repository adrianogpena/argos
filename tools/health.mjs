#!/usr/bin/env node
// Laudos de exames -> cofre. Roda no computador do dono; os dados dos laudos nunca vão para o git. Lógica em lib/health-exams.js.
//
//   node tools/health.mjs import <laudo.json> [--apply]   valida e grava 1 registro em `health-exams` + os resultados em `health-results` (ids estáveis: repetir sobrescreve)
//   node tools/health.mjs list [membro]                   laudos e último resultado de cada exame
//
// O JSON é montado pelo Claude lendo o PDF: { member, exam:{date,issued,lab,place,episode}, results:[{test,date,value|text,cmp,low,high,highExcl,refText,flag}] }.
// Colunas "resultados históricos" do laudo entram como resultados de datas antigas. Guardar o JSON em ~/.argos-health/ (fora do git).
// VAULT_URL e VAULT_TOKEN vêm do ambiente (ou de ~/.argos-vault.env carregado dentro do comando); o token nunca é escrito nem exibido.
import { readFileSync } from 'node:fs';
import { examRecord, resultRecord, overview, shown } from '../lib/health-exams.js';

const args = process.argv.slice(2), cmd = args[0], pos = args.slice(1).filter(a => !a.startsWith('--')), apply = args.includes('--apply');
const url = (process.env.VAULT_URL || '').replace(/\/$/, ''), token = process.env.VAULT_TOKEN;
if (!/^https:\/\//.test(url) || !token) { console.error('Defina VAULT_URL (https://...) e VAULT_TOKEN no ambiente.'); process.exit(1); }
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
const post = (c, items) => call('POST', '/v1/c/' + c, { items });

if (cmd === 'import' && pos.length) {
  const file = JSON.parse(readFileSync(pos[0], 'utf8')), bad = [];
  const members = await get('health-members');
  if (!members.some(m => m.id === file.member)) { console.error('Membro não existe no cofre: ' + file.member); process.exit(1); }
  const e = examRecord({ ...file.exam, member: file.member });
  if (!e.ok) { console.error('Laudo inválido: ' + e.error); process.exit(1); }
  const results = [];
  file.results.forEach((r, i) => { const x = resultRecord({ ...r, member: file.member, source: e.rec.id }); if (x.ok) results.push(x.rec); else bad.push(`resultado ${i + 1} (${r.test}): ${x.error}`); });
  if (bad.length) { console.error('Inválidos:\n' + bad.join('\n')); process.exit(1); }
  console.log(`Laudo ${e.rec.date} (${e.rec.lab}), ${results.length} resultados:`);
  for (const r of results) console.log(`  ${r.date}  ${r.test.padEnd(16)} ${shown(r)} ${r.unit ?? ""}`);
  if (!apply) { console.log('\nSimulação: nada foi enviado. Acrescente --apply para gravar.'); process.exit(0); }
  await post('health-exams', [e.rec]); await post('health-results', results);
  console.log('\nGravado.');
} else if (cmd === 'list') {
  const [exams, results] = await Promise.all([get('health-exams'), get('health-results')]);
  const who = pos[0];
  for (const e of exams.filter(x => !who || x.member === who).sort((a, b) => a.date.localeCompare(b.date))) console.log(`${e.date}  ${e.member}  ${e.lab || ''} ${e.episode || ''}`);
  for (const m of [...new Set(results.map(r => r.member))].filter(m => !who || m === who)) {
    console.log('\n' + m);
    for (const o of overview(results, m)) console.log(`  ${o.def.short.padEnd(20)} ${shown(o.last).padStart(8)} ${(o.last.unit ?? "").padEnd(8)} ${o.last.date}  ${o.status || ''}`);
  }
} else {
  console.error('Uso: node tools/health.mjs import <laudo.json> [--apply] | list [membro]'); process.exit(1);
}

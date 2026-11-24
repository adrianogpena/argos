#!/usr/bin/env node
// Gastos do cartão de vale refeição Coverflex -> cofre, pelo MESMO plano diário da importação do e-fatura (cota de gravações do KV).
// Dados ficam FORA do git: COVERFLEX_DIR (padrão ~/.argos-coverflex)/coverflex-entries.json. O plano é o plan.json do e-fatura (EFATURA_DIR).
//
//   node tools/coverflex.mjs link [--apply]   última parte do plano: liga faturas do e-fatura sem `expenseId` às compras da Coverflex (rode depois de `plan --apply`; pode repetir)
//   node tools/coverflex.mjs plan [--apply]   simula (ou grava no plan.json do e-fatura) a coleção `expenses` com as compras; as cargas (topup) ficam de fora
// O envio é feito por `node tools/efatura.mjs push [--apply]` (a coleção `expenses` vai depois das do e-fatura). `efatura.mjs build` preserva essa coleção.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { coverflexRecords, linkCoverflex } from '../lib/coverflex.js';

const [cmd, ...flags] = process.argv.slice(2);
const cfDir = process.env.COVERFLEX_DIR || join(homedir(), '.argos-coverflex'), efDir = process.env.EFATURA_DIR || join(homedir(), '.argos-efatura');
if (cmd !== 'plan' && cmd !== 'link') { console.error('Uso: plan [--apply] | link [--apply]'); process.exit(1); }
const src = join(cfDir, 'coverflex-entries.json'), planFile = join(efDir, 'plan.json');
if (!existsSync(src)) { console.error('Falta ' + src); process.exit(1); }
if (!existsSync(planFile)) { console.error('Falta ' + planFile + ' (rode efatura.mjs build)'); process.exit(1); }
const rows = JSON.parse(readFileSync(src, 'utf8')).rows;
const { records, errors } = coverflexRecords(rows);
if (errors.length) { errors.forEach(e => console.error('ERRO ' + e)); process.exit(1); }
const byMonth = new Map(); for (const r of records) { const m = r.date.slice(0, 7); byMonth.set(m, (byMonth.get(m) || 0) + r.amount); }
for (const [m, v] of [...byMonth].sort()) console.log(`${m}: ${v.toFixed(2)} €`);
console.log(`${records.length} compras (${rows.length - records.length} cargas fora) = ${records.reduce((a, r) => a + r.amount, 0).toFixed(2)} €`);
const plan = JSON.parse(readFileSync(planFile, 'utf8'));
if (cmd === 'link') {
  if (!plan.plan.expenses) { console.error('Rode plan --apply antes.'); process.exit(1); }
  const stFile = join(efDir, 'state.json'), st = existsSync(stFile) ? JSON.parse(readFileSync(stFile, 'utf8')) : {};
  const r = linkCoverflex(plan.plan, st, records);
  console.log(`faturas ligadas a compras da Coverflex: ${r.direct.length + r.resend.length} (no registro ainda não enviado: ${r.direct.length}; já enviadas, reenvio em efatura+link: ${r.resend.length})`);
  if (!flags.includes('--apply')) { console.log('Simulação: o plano não foi alterado. Acrescente --apply.'); process.exit(0); }
  writeFileSync(planFile, JSON.stringify({ ...plan, plan: r.plan }));
  console.log('plano atualizado.'); process.exit(0);
}
console.log(`plano atual: ${Object.entries(plan.plan).map(([c, i]) => c + ' ' + i.length).join(', ')}`);
if (!flags.includes('--apply')) { console.log('\nSimulação: o plano não foi alterado. Acrescente --apply.'); process.exit(0); }
plan.plan.expenses = records;
writeFileSync(planFile, JSON.stringify(plan));
console.log(`plano atualizado: coleção expenses com ${records.length} registros (envie com efatura.mjs push --apply).`);

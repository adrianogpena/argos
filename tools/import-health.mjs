#!/usr/bin/env node
// Importação ÚNICA de peso e altura (exportados do Supabase em CSV) para o cofre. Roda no SEU computador; o CSV nunca vai para o git.
// Depois de importar, este arquivo pode ser apagado.
//
//   node tools/import-health.mjs data/medidas.csv                                                       (simulação)
//   VAULT_URL=https://vault.adrianogpena.workers.dev VAULT_TOKEN=... node tools/import-health.mjs data/medidas.csv --apply   (grava)
//
// Colunas esperadas no CSV: name, kind, birth_date, metric, value, unit, recorded_on (opcionais: species, sex, notes).
// Os ids são estáveis (nome + nascimento; membro + medida + data), então rodar de novo sobrescreve em vez de duplicar.
import { readFileSync } from 'node:fs';
import { parseCsv } from '../lib/fuelio.js';
import { fromRows } from '../lib/health-core.js';

const [file, ...flags] = process.argv.slice(2);
if (!file) { console.error('uso: node tools/import-health.mjs <arquivo.csv> [--apply]'); process.exit(1); }
const [head, ...body] = parseCsv(readFileSync(file, 'utf8').replace(/^﻿/, '')).filter(r => r.some(c => c.trim()));
const need = ['name', 'kind', 'birth_date', 'metric', 'value', 'unit', 'recorded_on'].filter(c => !head.includes(c));
if (need.length) { console.error('Faltam colunas no CSV: ' + need.join(', ')); process.exit(1); }
const { members, measures, skipped } = fromRows(body.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()]))));

console.log(`Linhas no CSV: ${body.length} | Membros: ${members.length} | Medidas: ${measures.length} | Ignoradas: ${skipped.length}`);
for (const m of members) {
  const mine = measures.filter(x => x.member === m.id), dates = mine.map(x => x.date).sort();
  console.log(`  ${m.name} (${m.kind}): ${mine.filter(x => x.metric === 'weight').length} pesos, ${mine.filter(x => x.metric === 'height').length} alturas, ${dates[0]} a ${dates[dates.length - 1]}`);
}
skipped.forEach(s => console.log('  ignorada -', s));
if (!flags.includes('--apply')) { console.log('\nSimulação: nada foi enviado. Confira os números e acrescente --apply para gravar no cofre.'); process.exit(0); }

const url = (process.env.VAULT_URL || '').replace(/\/$/, ''), token = process.env.VAULT_TOKEN;
if (!/^https:\/\//.test(url) || !token) { console.error('Defina VAULT_URL (https://...) e VAULT_TOKEN no ambiente.'); process.exit(1); }
let ok = 0;
for (const [col, recs] of [['health-members', members], ['health-measures', measures]]) {
  for (const rec of recs) {
    let res;
    for (let tent = 1; tent <= 5; tent++) {            // erros 5xx/rede são passageiros: repete com espera
      try { res = await fetch(`${url}/v1/c/${col}/${rec.id}`, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(rec) }); } catch { res = null; }
      if (res && res.status < 500) break;
      await new Promise(r => setTimeout(r, 1000 * tent));
    }
    if (!res || !res.ok) { console.error(`Falhou (${res ? res.status : 'rede'}) em ${col}/${rec.id}. Parando; pode rodar de novo com segurança.`); process.exit(1); }
    ok++;
  }
}
console.log(`Gravados ${ok} registros no cofre.`);

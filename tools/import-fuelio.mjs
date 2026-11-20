#!/usr/bin/env node
// Importação única de um CSV do Fuelio para o cofre. Roda no SEU computador; os dados nunca vão para o git.
//
//   VAULT_URL=https://vault.adrianogpena.workers.dev VAULT_TOKEN=... node tools/import-fuelio.mjs caminho/vehicle-2-local.csv          (simulação)
//   VAULT_URL=... VAULT_TOKEN=... node tools/import-fuelio.mjs caminho/vehicle-2-local.csv --apply                                    (grava)
//
// Os ids vêm do Fuelio, então rodar de novo sobrescreve em vez de duplicar. O token vem só do ambiente.
import { readFileSync } from 'node:fs';
import { convert } from '../lib/fuelio.js';

const [file, ...flags] = process.argv.slice(2);
if (!file) { console.error('uso: node tools/import-fuelio.mjs <vehicle-N-local.csv> [--apply]'); process.exit(1); }
const apply = flags.includes('--apply');
const { vehicle, fuel, service, skipped } = convert(readFileSync(file, 'utf8'));
const dates = fuel.map(f => f.date).sort();
console.log(`Veículo: ${vehicle.make} ${vehicle.model} ${vehicle.year}`);
console.log(`Abastecimentos: ${fuel.length} (${dates[0]} a ${dates[dates.length - 1]}) | Manutenções/custos: ${service.length} | Ignorados: ${skipped.length}`);
skipped.forEach(s => console.log('  ignorado -', s));
if (!apply) { console.log('\nSimulação: nada foi enviado. Acrescente --apply para gravar no cofre.'); process.exit(0); }

const url = (process.env.VAULT_URL || '').replace(/\/$/, ''), token = process.env.VAULT_TOKEN;
if (!/^https:\/\//.test(url) || !token) { console.error('Defina VAULT_URL (https://...) e VAULT_TOKEN no ambiente.'); process.exit(1); }
let ok = 0;
for (const [col, recs] of [['car-fuel', fuel], ['car-service', service]]) {
  for (const rec of recs) {
    const res = await fetch(`${url}/v1/c/${col}/${rec.id}`, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(rec) });
    if (!res.ok) { console.error(`Falhou (${res.status}) em ${col}/${rec.id}. Parando; pode rodar de novo com segurança.`); process.exit(1); }
    ok++;
  }
}
console.log(`Gravados ${ok} registros no cofre.`);

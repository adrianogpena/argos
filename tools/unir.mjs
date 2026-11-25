#!/usr/bin/env node
// Rede da UNIR (duração das viagens e paradas do mesmo lugar) -> cofre, coleção `unir-net`. Lógica em lib/unir-net.js.
// Dado público de transporte, mas fica fora do git: o cache vai em ~/.argos-unir/.
//
//   node tools/unir.mjs scan [AAAA-MM-DD]        lê os horários de todas as paradas da UNIR (uns 2000 pedidos, 8 por vez) e guarda em ~/.argos-unir/stops.json
//   node tools/unir.mjs build [--from stops.json] monta a rede e mostra o resumo (tamanhos, linhas, grupos)
//   node tools/unir.mjs push [--from stops.json] [--apply]   grava a rede no cofre (simula sem --apply); refaça de vez em quando, os horários mudam
//
// VAULT_URL e VAULT_TOKEN vêm do ambiente (ou de ~/.argos-vault.env carregado dentro do comando); o token nunca é escrito nem exibido.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildNet, netRecords } from '../lib/unir-net.js';

const args = process.argv.slice(2), cmd = args[0], flags = args.filter(a => a.startsWith('--')), pos = args.slice(1).filter(a => !a.startsWith('--'));
const apply = flags.includes('--apply'), fromIdx = args.indexOf('--from');
const DIR = join(homedir(), '.argos-unir'), STOPS = join(DIR, 'stops.json'), UNIR = 'https://paragens.amp.pt';
const url = (process.env.VAULT_URL || '').replace(/\/$/, ''), token = process.env.VAULT_TOKEN;

async function stop(id, date) {
  for (let t = 1; t <= 3; t++) {
    try {
      const r = await fetch(`${UNIR}/acarto2/get_horarios_prg?dia=${date}&id=vng:${id}`, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) return null;
      let j = await r.json(); if (typeof j === 'string') j = JSON.parse(j);
      return j && j.lat != null && Array.isArray(j.horarios) ? j : null;
    } catch { await new Promise(r => setTimeout(r, 500 * t)); }
  }
  return null;
}
const load = () => JSON.parse(readFileSync(fromIdx > 0 ? args[fromIdx + 1] : STOPS, 'utf8'));
const summary = (net, recs) => console.log(`${Object.keys(net.lines).length} linhas, ${Object.values(net.lines).reduce((a, l) => a + Object.keys(l.trips).length, 0)} viagens, ${net.groups.length} grupos de lugar → ${recs.length} registros, o maior com ${Math.max(...recs.map(r => JSON.stringify(r).length))} bytes`);

if (cmd === 'scan') {
  const date = pos[0] || new Date().toISOString().slice(0, 10), out = {}; let next = 1, done = 0;
  const MAX = 2600;   // o maior id visto até hoje é 2084
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (;;) {
      const id = next++; if (id > MAX) return;
      const j = await stop(id, date); if (j) out[id] = j;
      if (++done % 400 === 0) console.error(`… ${done}/${MAX}`);
    }
  }));
  mkdirSync(DIR, { recursive: true }); writeFileSync(STOPS, JSON.stringify(out));
  console.log(`${Object.keys(out).length} paradas guardadas em ${STOPS}`);
} else if (cmd === 'build') {
  const net = buildNet(load()); summary(net, netRecords(net));
} else if (cmd === 'push') {
  const net = buildNet(load()), recs = netRecords(net); summary(net, recs);
  if (!apply) { console.log('\nSimulação: nada foi enviado. Acrescente --apply para gravar.'); process.exit(0); }
  if (!/^https:\/\//.test(url) || !token) { console.error('Defina VAULT_URL (https://...) e VAULT_TOKEN no ambiente.'); process.exit(1); }
  for (let i = 0; i < recs.length; i += 100) {
    const res = await fetch(`${url}/v1/c/unir-net`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ items: recs.slice(i, i + 100) }) });
    if (!res.ok) { console.error(res.status === 401 ? 'o cofre recusou o token (VAULT_TOKEN)' : `cofre respondeu ${res.status}${res.status >= 500 ? ' (limite diário de gravações do KV? veja o CLAUDE.md)' : ''}`); process.exit(1); }
  }
  console.log(`${recs.length} registros gravados em unir-net.`);
} else {
  console.error('Uso: node tools/unir.mjs scan [data] | build [--from arq] | push [--from arq] [--apply]'); process.exit(1);
}

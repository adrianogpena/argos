#!/usr/bin/env node
// GTFS público do Metro do Porto: baixa, guarda os arquivos brutos em gtfs/metro/ e monta gtfs/metro/net.json (rede compacta). Lógica em lib/metro-gtfs.js.
// Dado público de horários, sem dado pessoal: por isso fica no git, ao contrário do resto do Argos.
//
//   node tools/metro.mjs fetch    baixa google_transit.zip, extrai em gtfs/metro/ e monta net.json
//   node tools/metro.mjs build    monta net.json a partir dos arquivos já em gtfs/metro/
//   node tools/metro.mjs info     resumo da rede e validade do feed
import { readFileSync, writeFileSync, mkdirSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildNet } from '../lib/metro-gtfs.js';

const ZIP = 'https://www.metrodoporto.pt/metrodoporto/uploads/document/file/794/google_transit.zip';
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'gtfs', 'metro'), NET = join(DIR, 'net.json');
const cmd = process.argv[2];

function unzip(zip, out) {
  const tries = [['unzip', ['-o', '-q', zip, '-d', out]], ['tar', ['-xf', zip, '-C', out]],
    ['powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${out}'`]]];
  for (const [bin, a] of tries) { try { execFileSync(bin, a, { stdio: 'ignore' }); if (readdirSync(out).some(f => f.endsWith('.txt'))) return; } catch { /* próximo */ } }
  throw new Error('não consegui extrair o zip (precisa de unzip, tar ou PowerShell)');
}
function build() {
  const files = {};
  for (const f of readdirSync(DIR).filter(f => f.endsWith('.txt'))) files[f] = readFileSync(join(DIR, f), 'utf8');
  const net = buildNet(files);
  writeFileSync(NET, JSON.stringify(net) + '\n');
  return net;
}
function info(net) {
  const sv = Object.keys(net.services).length;
  console.log(`feed ${net.feed.start}..${net.feed.end} (versão ${net.feed.version || '-'}); ${Object.keys(net.stops).length} paradas, ${Object.keys(net.routes).length} linhas, ${net.patterns.length} padrões, ${net.patterns.reduce((a, p) => a + p.variants.length, 0)} variantes, ${net.trips.length} viagens, ${sv} serviços`);
  const orphans = Object.values(net.exceptions).flatMap(e => [...e.add, ...e.remove]).filter(s => !net.services[s]);
  if (orphans.length) console.log('exceções para serviços sem viagens (ignoradas):', [...new Set(orphans)].join(', '));
}

if (cmd === 'fetch') {
  const tmp = mkdtempSync(join(tmpdir(), 'metro-gtfs-'));
  try {
    const r = await fetch(ZIP, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`download falhou: HTTP ${r.status}`);
    const zip = join(tmp, 'g.zip'); writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
    const x = join(tmp, 'x'); mkdirSync(x); unzip(zip, x);
    mkdirSync(DIR, { recursive: true });
    for (const f of readdirSync(x).filter(f => f.endsWith('.txt'))) copyFileSync(join(x, f), join(DIR, f));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  info(build());
} else if (cmd === 'build') info(build());
else if (cmd === 'info') info(JSON.parse(readFileSync(NET, 'utf8')));
else { console.error('uso: node tools/metro.mjs fetch | build | info'); process.exit(1); }

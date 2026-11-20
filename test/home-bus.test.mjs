// node test/home-bus.test.mjs  (dados fictícios)
import assert from 'node:assert/strict';
import { busTargets, nextBuses } from '../lib/home-bus.js';
import { createUnir } from '../lib/bus-net.js';
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

const stops = [{ id: 'S1', name: 'Praça Exemplo' }, { id: 'S2', name: 'Rua Exemplo' }];
const setup = { lines: [
  { key: 'x', short: '502', example: true, dirs: [{ name: 'Exemplo', stops, myStop: 'S1' }], activeDir: 0 },
  { key: 'a', short: '600', dirs: [{ name: 'Centro', stops, myStop: 'S2' }], activeDir: 0 },
  { key: 'b', short: '700', dirs: [{ name: 'Sem parada', stops, myStop: '' }], activeDir: 0 },
  { key: 'u', kind: 'unir', short: 'U', name: 'Casa → Trabalho', arrive: 'there', routes: [{ from: 'vng:1', to: ['vng:2'] }] },
  { key: 'v', kind: 'unir', short: 'V', routes: [] },
] };

await t('só linhas com parada ou trajeto; exemplo fora', () => {
  assert.deepEqual(busTargets(setup).map(x => x.line.key), ['a', 'u']);
  assert.deepEqual(busTargets(null), []);
});
await t('STCP: duas próximas chegadas da linha, ordenadas', async () => {
  const fetchStcp = async id => { assert.equal(id, 'S2'); return { arrivals: [
    { route_short_name: '600', trip_id: 'a', arrival_minutes: 9 }, { route_short_name: '600', trip_id: 'b', arrival_minutes: 3 },
    { route_short_name: '600', trip_id: 'c', arrival_minutes: 20 }, { route_short_name: '999', trip_id: 'd', arrival_minutes: 1 } ] }; };
  const r = await nextBuses(setup, { fetchStcp, unirUpcoming: async () => [] });
  assert.deepEqual(r[0].minutesList, [3, 9]);
});
await t('UNIR: pega o primeiro que não perde para um posterior; falha isolada', async () => {
  const now = Date.UTC(2026, 5, 1, 10, 0);
  const unirUpcoming = async () => [{ line: '1', depAt: now + 5 * 60000, doneAt: now + 30 * 60000, toName: 'Rua Exemplo', beaten: true }, { line: '2', depAt: now + 12 * 60000, doneAt: now + 31 * 60000, toName: 'Rua Exemplo' }];
  const r = await nextBuses(setup, { fetchStcp: async () => { throw new Error('x'); }, unirUpcoming }, now);
  assert.equal(r[0].err, true);
  assert.equal(r[1].minutes, 12); assert.equal(r[1].line, '2'); assert.equal(r[1].label, 'Casa → Trabalho');
});
await t('createUnir busca cada parada/dia uma vez e usa o cache', async () => {
  const calls = [], store = {};
  const storage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
  const getJSON = async (b, p) => { calls.push(p); const id = decodeURIComponent(p.split('id=')[1]);
    return JSON.stringify({ prg: id, designa: id, horarios: [{ trip_id: 'T1', chegada: id === 'vng:1' ? '23:59:00' : '25:10:00', linha: 'L', destino: 'Fim' }] }); };
  const u = createUnir({ getJSON, storage });
  const l = { routes: [{ from: 'vng:1', to: ['vng:2'] }] };
  const a = await u.unirDay(l, '2026-06-01'), b = await u.unirDay(l, '2026-06-01');
  assert.equal(a.trips.length, 1); assert.equal(calls.length, 2); assert.equal(b.trips.length, 1);
});
console.log(n + ' ok');

// node test/unir-stops.test.mjs  (dados fictícios)
import assert from 'node:assert/strict';
import { savedStops, stopLabel, stopDepartures } from '../lib/unir-stops.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const stop = rows => ({ horarios: rows.map(([trip_id, chegada, linha, destino]) => ({ trip_id, chegada, linha, destino })) });

t('paradas salvas: de todas as linhas UNIR, sem repetir, na ordem', () => {
  const setup = { lines: [
    { key: 'a', short: '502', dirs: [] },
    { key: 'u', kind: 'unir', target: 'vng:9', routes: [{ from: 'vng:1', to: ['vng:2', 'vng:3'], est: ['vng:3', 'vng:4'] }] },
    { key: 'v', kind: 'unir', routes: [{ from: 'vng:2', to: ['vng:1'] }] },
  ] };
  assert.deepEqual(savedStops(setup), ['vng:1', 'vng:2', 'vng:3', 'vng:4', 'vng:9']);
  assert.deepEqual(savedStops(null), []);
});
t('rótulo: apelido, senão oficial, senão id', () => {
  assert.equal(stopLabel('vng:1', { 'vng:1': ' Apelido ' }, 'Oficial'), 'Apelido');
  assert.equal(stopLabel('vng:1', { 'vng:1': ' ' }, 'Oficial '), 'Oficial');
  assert.equal(stopLabel('vng:1', {}, ''), 'vng:1');
});
t('ônibus da parada: todos, em ordem, só dali em diante, com a madrugada no dia certo', () => {
  const now = new Date(2026, 9, 9, 17, 0).getTime();
  const ontem = { date: '2026-10-08', stop: stop([['Z0', '24:30:00', '9011', 'Destino B']]) };   // 00:30 do dia 9: já passou
  const hoje = { date: '2026-10-09', stop: stop([['T2', '17:15:00', '9030', 'Destino A'], ['T1', '17:10:00', '9011', 'Destino B'], ['T0', '16:50:00', '9011', 'Destino B'], ['T3', '17:15:00', '1004', 'Outro'], ['Z1', '24:30:00', '9011', 'Destino B']]) };   // Z1 = 00:30 do dia 10
  const amanha = { date: '2026-10-10', stop: stop([['T1', '06:00:00', '9011', 'Destino B']]) };
  const r = stopDepartures([ontem, hoje, amanha], now);
  assert.deepEqual(r.map(x => [x.tripId, new Date(x.depAt).getDate(), x.line]),
    [['T1', 9, '9011'], ['T3', 9, '1004'], ['T2', 9, '9030'], ['Z1', 10, '9011'], ['T1', 10, '9011']]);
  assert.equal(stopDepartures([hoje, amanha], now, 2).length, 2);
});
console.log(`${n} grupos ok`);

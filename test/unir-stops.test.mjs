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
t('destino: marca quem chega, a viagem; quem não para fica na lista como não serve; fim de linha serve sem hora', () => {
  const now = new Date(2026, 9, 9, 17, 0).getTime();
  const org = { date: '2026-10-09', stop: { designa: 'Origem', ...stop([['A', '17:10:00', '9011', 'Fim Exemplo'], ['B', '17:20:00', '9030', 'Outro'], ['C', '17:30:00', '9011', 'Destino Z'], ['D', '17:40:00', '9011', 'Destino Z']]) } };
  const dst = { date: '2026-10-09', stop: { designa: 'Destino Z', ...stop([['C', '17:52:00', '9011', 'Fim Exemplo'], ['D', '17:35:00', '9011', 'Fim Exemplo']]) } };
  const r = stopDepartures([org], now, 10, [dst]);
  assert.deepEqual(r.map(x => [x.tripId, x.serves, x.rideMin ?? null, x.ends ?? false]),
    [['A', false, null, false], ['B', false, null, false], ['C', true, 22, false], ['D', false, null, false]]);   // D chega antes de sair: outro sentido
  assert.equal(new Date(r[2].arrAt).getMinutes(), 52);
  const fim = { date: '2026-10-09', stop: { designa: 'Fim Exemplo', ...stop([]) } };
  assert.deepEqual(stopDepartures([org], now, 10, [fim]).map(x => [x.tripId, x.serves, x.ends ?? false]),
    [['A', true, true], ['B', false, false], ['C', false, false], ['D', false, false]]);
  assert.equal(stopDepartures([org], now, 10).every(x => x.serves === undefined), true);
});
console.log(`${n} grupos ok`);

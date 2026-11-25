// node test/unir-net.test.mjs  (dados fictícios)
import assert from 'node:assert/strict';
import { buildNet, netRecords, netFromRecords, sisters, loopDepartures } from '../lib/unir-net.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

// Linha X (círculo): ida (sentido 2) A > B > C(fim). Volta (sentido 1) S(início, ao lado de C) > C2 (outro lado de C) > E > A2 (outro lado de A).
const st = (designa, lat, lon, rows) => ({ designa, lat, lon, horarios: rows.map(([trip_id, chegada, linha, sentido, ordem]) => ({ trip_id, chegada, linha, sentido, destino: 'Destino', 'ordem:': ordem })) });
const stops = {
  1: st('Praça Exemplo', 41.100, -8.600, [['X:2:0630', '06:30:00', 'X', '2', 1], ['X:2:0730', '07:30:00', 'X', '2', 1], ['Z:2:0600', '06:00:00', 'Z', '2', 1], ['Z:2:0700', '07:00:00', 'Z', '2', 1]]),
  2: st('Rua Beta', 41.110, -8.610, [['X:2:0630', '06:40:00', 'X', '2', 2], ['X:2:0730', '07:40:00', 'X', '2', 2]]),
  3: st('Largo Fim', 41.120, -8.620, [['X:2:0630', '06:50:00', 'X', '2', 3], ['X:2:0730', '07:50:00', 'X', '2', 3]]),
  4: st('Feira Início', 41.1203, -8.6203, [['X:1:0655', '06:55:00', 'X', '1', 1], ['X:1:0755', '07:55:00', 'X', '1', 1]]),
  5: st('Largo Fim', 41.1204, -8.6205, [['X:1:0655', '06:57:00', 'X', '1', 2], ['X:1:0755', '07:57:00', 'X', '1', 2]]),
  6: st('Escola Exemplo', 41.130, -8.630, [['X:1:0655', '07:00:00', 'X', '1', 3], ['X:1:0755', '08:00:00', 'X', '1', 3], ['Y:2:0640', '06:55:00', 'Y', '2', 2], ['Z:2:0600', '06:10:00', 'Z', '2', 2], ['Z:2:0700', '07:10:00', 'Z', '2', 2]]),
  7: st('Praça Exemplo', 41.1001, -8.6001, [['X:1:0655', '07:10:00', 'X', '1', 4], ['X:1:0755', '08:10:00', 'X', '1', 4], ['Z:1:0630', '06:40:00', 'Z', '1', 2]]),
  8: st('Origem Y', 41.2, -8.7, [['Y:2:0640', '06:40:00', 'Y', '2', 1]]),
  9: st('Fim Z', 41.3, -8.8, [['Z:2:0600', '06:20:00', 'Z', '2', 3], ['Z:2:0700', '07:20:00', 'Z', '2', 3], ['Z:1:0630', '06:30:00', 'Z', '1', 1]]),
};
const net = buildNet(stops);

t('rede: duração por linha e sentido, viagens com início e fim, lados da rua agrupados', () => {
  assert.deepEqual(net.lines.X.trips['X:2:0630'], [390, 410, '2']);
  assert.deepEqual(net.lines.X.dur, { 1: 15, 2: 20 });
  assert.deepEqual(net.groups.map(g => g.join()).sort(), ['1,7', '3,5']);
  assert.deepEqual(sisters(net, 'vng:1'), ['vng:1', 'vng:7']);
  assert.deepEqual(sisters(net, 'vng:6'), ['vng:6']);
});
t('registros do cofre: ida e volta sem perder nada, cada um cabe em 8 KB', () => {
  const recs = netRecords(net, '2026-01-01');
  assert.ok(recs.every(r => JSON.stringify(r).length < 8 * 1024));
  assert.deepEqual(netFromRecords(recs).lines, net.lines);
  assert.deepEqual(netFromRecords(recs).groups, net.groups);
  const big = { lines: { L: { dur: { 1: 5 }, trips: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`AU:L:0:1:${String(i).padStart(4, '0')}`, [i, i + 5, '1']])) } }, groups: [] };
  const r = netRecords(big); assert.ok(r.length > 2 && r.every(x => JSON.stringify(x).length < 8 * 1024));
  assert.equal(Object.keys(netFromRecords(r).lines.L.trips).length, 400);
});
const day = (origin, dest) => [{ date: '2026-10-09', origin: origin.map(i => ({ prg: `vng:${i}`, ...stops[i] })), dest: dest ? dest.map(i => ({ prg: `vng:${i}`, ...stops[i] })) : null }];
const now = new Date(2026, 9, 9, 6, 0).getTime(), hm = ms => { const d = new Date(ms); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

t('círculo: o ônibus segue até o fim da linha, recomeça na volta e passa no destino', () => {
  const r = loopDepartures(day([1], [6]), net, now, 10).filter(x => x.line === 'X');
  assert.deepEqual(r.map(x => [x.tripId, x.mode, hm(x.arrAt), x.rideMin]), [['X:2:0630', 'continues', '7:00', 30], ['X:2:0730', 'continues', '8:00', 30]]);
});
t('viagem direta no mesmo trip_id continua valendo', () => {
  const r = loopDepartures(day([8], [6]), net, now, 10);
  assert.deepEqual(r.map(x => [x.line, x.mode, x.rideMin, x.fade]), [['Y', 'direct', 15, null]]);
});
t('dois lados da rua na origem; sentido mais longo do círculo fica marcado, não some', () => {
  const r = loopDepartures(day([1, 7], [6]), net, now, 20).filter(x => x.line === 'Z');
  assert.deepEqual(r.map(x => [x.sentido, x.mode, x.rideMin, x.fade]), [['2', 'direct', 10, null], ['1', 'continues', 30, 'longer'], ['2', 'direct', 10, null]]);
});
t('quem nunca passa no destino fica na lista com fade "none"; sem destino não há marcação', () => {
  const r = loopDepartures(day([8], [3]), net, now, 10);
  assert.deepEqual(r.map(x => [x.line, x.mode, x.fade]), [['Y', null, 'none']]);
  assert.equal(loopDepartures(day([8], null), net, now, 10)[0].fade, undefined);
});
t('espera longa no fim da linha não é o mesmo ônibus: sem rota', () => {
  const sem = (i, ord) => st(stops[i].designa, stops[i].lat, stops[i].lon, stops[i].horarios.filter(h => h.trip_id !== 'X:1:0655').map(h => [h.trip_id, h.chegada, h.linha, h.sentido, h['ordem:']]));
  const tarde = { ...stops, 4: sem(4), 5: sem(5), 6: sem(6), 7: sem(7) };
  const net2 = buildNet(tarde);
  const r = loopDepartures([{ date: '2026-10-09', origin: [{ prg: 'vng:1', ...tarde[1] }], dest: [{ prg: 'vng:6', ...tarde[6] }] }], net2, now, 10).filter(x => x.line === 'X');
  assert.deepEqual(r.map(x => [x.tripId, x.mode]), [['X:2:0630', null], ['X:2:0730', 'continues']]);   // a ida 0630 acaba 06:50 e a próxima volta (sem a 06:55) é a das 07:55, 65 min depois
});
t('respeita o agora e o limite', () => {
  const r = loopDepartures(day([1], [6]), net, new Date(2026, 9, 9, 7, 0).getTime(), 10);
  assert.ok(r.every(x => x.depAt >= new Date(2026, 9, 9, 7, 0).getTime()));
  assert.equal(loopDepartures(day([1], [6]), net, now, 2).length, 2);
});
console.log(`${n} grupos ok`);

// node test/unir-net.test.mjs  (dados fictícios)
import assert from 'node:assert/strict';
import { buildNet, netRecords, netFromRecords, sisters, loopDepartures, multiDepartures } from '../lib/unir-net.js';
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
const mday = (origin, dests) => [{ date: '2026-10-09', origin: origin.map(i => ({ prg: `vng:${i}`, ...stops[i] })), dests: dests.map(g => ({ id: `vng:${g[0]}`, stops: g.map(i => ({ prg: `vng:${i}`, ...stops[i] })) })) }];
t('sem destino escolhido: uma chegada por lugar salvo, só pelo menor trajeto; sem chegada fica esmaecido', () => {
  const r = multiDepartures(mday([1, 7], [[6], [3, 5]]), net, now, 20);
  const z = r.filter(x => x.line === 'Z');
  assert.deepEqual(z.map(x => [x.sentido, x.arrivals.map(a => [a.id, a.rideMin]), x.fade]), [['2', [['vng:6', 10]], undefined], ['1', [], 'none'], ['2', [['vng:6', 10]], undefined]]);
  const x0 = r.find(x => x.tripId === 'X:2:0630');
  assert.deepEqual(x0.arrivals.map(a => [a.id, a.mode, a.rideMin]), [['vng:6', 'continues', 30], ['vng:3', 'direct', 20]]);   // ordem dos lugares salvos, não da hora
  const y = multiDepartures(mday([8], [[6], [3]]), net, now, 20);
  assert.deepEqual(y.map(x => [x.line, x.arrivals.map(a => a.id), x.fade]), [['Y', ['vng:6'], undefined]]);
  assert.deepEqual(multiDepartures(mday([8], [[3]]), net, now, 20).map(x => x.fade), ['none']);
  assert.equal(multiDepartures(mday([1], [[6]]), net, now, 1).length, 1);
});
// Linha W: sentido 2 faz O > D em 10 min; sentido 1 sai de O, acaba em E às 07:55 e segue na viagem 2 que sai de X às 07:55 e passa em D às 08:05
const w = (id, rows) => st(id, 41.5 + rows.length / 100, -8.5, rows);
const ws = {
  20: w('Origem W', [['W:2:0700', '07:00:00', 'W', '2', 1], ['W:2:0800', '08:00:00', 'W', '2', 1], ['W:1:0745', '07:45:00', 'W', '1', 1]]),
  21: w('Destino W', [['W:2:0700', '07:10:00', 'W', '2', 2], ['W:2:0800', '08:10:00', 'W', '2', 2], ['W:2:0755', '08:05:00', 'W', '2', 2]]),
  22: w('Fim E', [['W:1:0745', '07:55:00', 'W', '1', 2]]),
  23: w('Saída X', [['W:2:0755', '07:55:00', 'W', '2', 1]]),
};
const wnet = buildNet(ws), wday = (o, d) => [{ date: '2026-10-09', origin: o.map(i => ({ prg: `vng:${i}`, ...ws[i] })), dests: d.map(g => ({ id: `vng:${g[0]}`, stops: g.map(i => ({ prg: `vng:${i}`, ...ws[i] })) })) }];
t('sentido mais longo que chega antes do próximo do sentido curto continua valendo', () => {
  const r = multiDepartures(wday([20], [[21]]), wnet, now, 10);
  assert.deepEqual(r.map(x => [x.sentido, x.arrivals.map(a => [a.rideMin, a.mode])]), [['2', [[10, 'direct']]], ['1', [[20, 'continues']]], ['2', [[10, 'direct']]]]);
});
t('viagem acima do teto não conta; e o limite não muda o que é "mais longo"', () => {
  const r = multiDepartures(wday([20], [[21]]), wnet, now, 10, { maxRide: 15 });
  assert.deepEqual(r.map(x => [x.sentido, x.arrivals.length, x.fade]), [['2', 1, undefined], ['1', 0, 'none'], ['2', 1, undefined]]);
  const um = multiDepartures(wday([20], [[21]]), wnet, now, 1), tres = multiDepartures(wday([20], [[21]]), wnet, now, 3);
  assert.deepEqual(um[0], tres[0]);
  const memo = {}; multiDepartures(wday([20], [[21]]), wnet, now, 10, { memo });
  assert.deepEqual(memo['vng:21|W'], { 2: 10, 1: 20 });   // o mínimo fica guardado para as próximas chamadas
});
t('destino é o fim da linha: chegada estimada pelo fim da viagem; sem rede, só "fim da linha"', () => {
  const fs = {
    30: st('Origem F', 41.6, -8.5, [['F:2:0900', '09:00:00', 'F', '2', 1]]),
    31: st('Meio F', 41.61, -8.5, [['F:2:0900', '09:12:00', 'F', '2', 2]]),
    32: st('Fim Exemplo', 41.62, -8.5, []),
  };
  for (const h of Object.values(fs)) for (const x of h.horarios) x.destino = 'Fim Exemplo';
  const days = [{ date: '2026-10-09', origin: [{ prg: 'vng:30', ...fs[30] }], dests: [{ id: 'vng:32', stops: [{ prg: 'vng:32', ...fs[32] }] }] }];
  const a = multiDepartures(days, buildNet(fs), now, 5)[0].arrivals[0];
  assert.deepEqual([a.mode, hm(a.arrAt), a.rideMin], ['ends', '9:12', 12]);
  const b = multiDepartures(days, null, now, 5)[0].arrivals[0];
  assert.deepEqual([b.mode, b.arrAt, b.rideMin], ['ends', null, null]);
});
console.log(`${n} grupos ok`);

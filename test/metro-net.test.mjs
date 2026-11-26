// node test/metro-net.test.mjs  (feed fictício)
import assert from 'node:assert/strict';
import { buildNet } from '../lib/metro-gtfs.js';
import { stationList, destinationsFrom, departures } from '../lib/metro-net.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

// Estações: 1 Álamo, 2 Centro (cruzamento), 3 Fim Norte, 4 Fim Sul. Linha X: Álamo > Centro > Fim Norte (e volta). Linha Y: Fim Sul > Centro > Fim Norte; Y curta: Álamo > Centro.
const tr = (route, svc, id, head, dir) => `${route},${svc},${id},${head},${dir},,1,S`;
const st = (id, rows) => rows.map(([h, stop, seq]) => `${id},${h},${h},${stop},${seq},,,,`);
const files = {
  'stops.txt': 'stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url\n1,,Álamo,,41.1,-8.6,Z1,\n2,,Centro,,41.2,-8.7,Z1,\n3,,Fim Norte,,41.3,-8.8,Z2,\n4,,Fim Sul,,41.0,-8.5,Z2,\n',
  'routes.txt': 'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color\nX,,X, - ,,1,,199FDA,FFFFFF\nY,,Y, - ,,1,,EBBC14,000000\n',
  'trips.txt': ['route_id,service_id,trip_id,trip_headsign,direction_id,block_id,wheelchair_accessible,shape_id',
    tr('X', 'XU', 'XU1', 'Fim Norte', 0), tr('X', 'XU', 'XU2', 'Fim Norte', 0), tr('X', 'XU', 'XB1', 'Álamo', 1), tr('X', 'XU', 'XN1', 'Fim Norte', 0),
    tr('Y', 'XU', 'YU1', 'Fim Norte', 0), tr('Y', 'XU', 'YC1', 'Centro', 0), tr('X', 'XS', 'XS1', 'Fim Norte', 0)].join('\n') + '\n',
  'stop_times.txt': ['trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type,shape_dist_traveled',
    ...st('XU1', [['6:00:00', 1, 0], ['6:10:00', 2, 1], ['6:20:00', 3, 2]]),
    ...st('XU2', [['6:30:00', 1, 0], ['6:41:00', 2, 1], ['6:52:00', 3, 2]]),
    ...st('XB1', [['6:05:00', 3, 0], ['6:15:00', 2, 1], ['6:25:00', 1, 2]]),
    ...st('XN1', [['23:50:00', 1, 0], ['24:00:00', 2, 1], ['24:10:00', 3, 2]]),
    ...st('YU1', [['6:12:00', 4, 0], ['6:22:00', 2, 1], ['6:32:00', 3, 2]]),
    ...st('YC1', [['6:40:00', 1, 0], ['6:50:00', 2, 1]]),
    ...st('XS1', [['9:00:00', 1, 0], ['9:10:00', 2, 1], ['9:20:00', 3, 2]]),
  ].join('\n') + '\n',
  'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nXU,1,1,1,1,1,0,0,20260907,20261231\nXS,0,0,0,0,0,1,0,20260907,20261231\n',
  'calendar_dates.txt': 'service_id,date,exception_type\nXU,20261208,2\nXS,20261208,1\n',
};
const net = buildNet(files);
const d = (y, mo, da, h = 0, mi = 0) => new Date(y, mo - 1, da, h, mi).getTime();
const hhmm = ms => { const x = new Date(ms); return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`; };
const THU = (h, mi) => d(2026, 11, 26, h, mi);   // quinta-feira

t('estações em ordem alfabética, sem depender de acento', () => {
  assert.deepEqual(stationList(net).map(s => s.name), ['Álamo', 'Centro', 'Fim Norte', 'Fim Sul']);
  assert.deepEqual(stationList(net)[2], { id: '3', name: 'Fim Norte', zone: 'Z2' });
});
t('partidas do cruzamento: destino de cada uma e próxima estação; a viagem que termina ali não sai', () => {
  const r = departures(net, '2', THU(6, 0), { limit: 5 });
  assert.deepEqual(r.map(x => `${hhmm(x.depAt)} ${x.line}>${x.headsign}|${x.nextName}`), [
    '06:10 X>Fim Norte|Fim Norte', '06:15 X>Álamo|Álamo', '06:22 Y>Fim Norte|Fim Norte', '06:41 X>Fim Norte|Fim Norte', '00:00 X>Fim Norte|Fim Norte']);
  assert.ok(!departures(net, '2', THU(6, 0), { limit: 20 }).some(x => x.tripId === 'YC1'));
});
t('linha ganha cor do feed e dois destinos diferentes na mesma direção ficam distintos', () => {
  const r = departures(net, '1', THU(6, 0), { limit: 20 });
  const heads = r.filter(x => x.dir === 0).map(x => `${x.line}>${x.headsign}`);
  assert.ok(heads.includes('X>Fim Norte') && heads.includes('Y>Centro'));
  assert.equal(r[0].color, '199FDA'); assert.equal(r[0].text, 'FFFFFF');
});
t('com destino: só viagens que passam nele depois da origem, com chegada e trajeto', () => {
  const r = departures(net, '1', THU(6, 0), { dest: '3', limit: 3 });
  assert.deepEqual(r.map(x => [hhmm(x.depAt), hhmm(x.arrAt), x.rideMin, x.stops]), [['06:00', '06:20', 20, 2], ['06:30', '06:52', 22, 2], ['23:50', '00:10', 20, 2]]);
  assert.ok(!r.some(x => x.line === 'Y'));
});
t('com destino antes da origem na mesma viagem, não aparece', () => {
  assert.deepEqual(departures(net, '3', THU(6, 0), { dest: '2', limit: 1 }).map(x => x.tripId), ['XB1']);
  assert.deepEqual(departures(net, '2', THU(6, 0), { dest: '4' }), []);
});
t('depois da meia-noite: viagem de ontem sai hoje; hoje só aparece uma vez', () => {
  const r = departures(net, '2', d(2026, 11, 27, 0, 0), { limit: 2 });
  assert.deepEqual(r.map(x => [x.tripId, hhmm(x.depAt), x.date]), [['XN1', '00:00', '2026-11-26'], ['XU1', '06:10', '2026-11-27']]);
  const z = departures(net, '2', THU(23, 55), { limit: 1 });
  assert.equal(z[0].tripId, 'XN1'); assert.equal(new Date(z[0].depAt).getDate(), 27);
});
t('já passou não entra; limite corta; ordem por horário', () => {
  assert.deepEqual(departures(net, '1', THU(6, 1), { limit: 2 }).map(x => hhmm(x.depAt)), ['06:30', '06:40']);
  assert.equal(departures(net, '1', THU(6, 0), { limit: 1 }).length, 1);
});
t('sábado, feriado com exceção e dia sem serviço', () => {
  assert.deepEqual(departures(net, '2', d(2026, 11, 28, 8, 0)).map(x => [x.tripId, hhmm(x.depAt)]), [['XS1', '09:10']]);
  assert.deepEqual(departures(net, '2', d(2026, 12, 8, 8, 0), { limit: 1 }).map(x => x.tripId), ['XS1']);
  assert.deepEqual(departures(net, '2', d(2027, 3, 1, 8, 0)), []);
});
t('destinos alcançáveis direto da estação, com as linhas', () => {
  assert.deepEqual(destinationsFrom(net, '2').map(x => [x.name, x.routes.join('')]), [['Álamo', 'X'], ['Fim Norte', 'XY']]);
  assert.deepEqual(destinationsFrom(net, '1').map(x => x.name), ['Centro', 'Fim Norte']);
  assert.deepEqual(destinationsFrom(net, '999'), []); assert.deepEqual(departures(net, '999', THU(6, 0)), []);
});
console.log(`${n} grupos ok`);

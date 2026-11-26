// node test/metro-gtfs.test.mjs  (feed fictício)
import assert from 'node:assert/strict';
import { parseCsv, minutes, buildNet, activeServices, tripStops } from '../lib/metro-gtfs.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

const files = {
  'stops.txt': '﻿stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url\n1,,Praça Exemplo,,41.1,-8.6,Z1,\n2,,"Rua, Beta",,41.2,-8.7,Z1,\n3,,Largo Fim,,41.3,-8.8,Z2,\n',
  'routes.txt': 'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_url,route_color,route_text_color\nX,,X, - ,,1,,199FDA,FFFFFF\n',
  'trips.txt': 'route_id,service_id,trip_id,trip_headsign,direction_id,block_id,wheelchair_accessible,shape_id\nX,XU,XU0,Fim,0,,1,S\nX,XU,XU1,Fim,0,,1,S\nX,XU,XU2,Fim,0,,1,S\nX,XS,XS0,Início,1,,1,S\n',
  'stop_times.txt': [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type,shape_dist_traveled',
    'XU0,6:00:00,6:00:00,1,0,,,,', 'XU0,6:10:00,6:10:00,2,1,,,,', 'XU0,6:15:00,6:15:00,3,2,,,,',
    'XU1,23:50:00,23:50:00,1,0,,,,', 'XU1,24:01:00,24:01:00,2,1,,,,', 'XU1,24:06:00,24:06:00,3,2,,,,',
    'XU2,7:00:00,7:00:00,1,0,,,,', 'XU2,7:12:00,7:12:00,2,1,,,,', 'XU2,7:17:00,7:17:00,3,2,,,,',
    'XS0,8:05:00,8:05:00,3,1,,,,', 'XS0,8:00:00,8:00:00,2,0,,,,',
  ].join('\n') + '\n',
  'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nXU,1,1,1,1,1,0,0,20260907,20261231\nXS,0,0,0,0,0,1,0,20260907,20261231\n',
  'calendar_dates.txt': 'service_id,date,exception_type\nXS,20261207,1\nXU,20261208,2\nXD,20261208,1\n',
  'feed_info.txt': 'feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date,feed_version\nMetro,https://x.pt,pt,20260901,20261231,\n',
};

t('CSV: BOM, aspas com vírgula, linhas finais vazias', () => {
  const r = parseCsv(files['stops.txt']);
  assert.equal(r.length, 3); assert.equal(r[1].stop_name, 'Rua, Beta'); assert.equal(r[0].stop_id, '1');
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [{ a: '1', b: '2' }]);
});
t('minutos: depois da meia-noite passa de 1440; segundos rejeitados', () => {
  assert.equal(minutes('6:01:00'), 361); assert.equal(minutes('24:10:00'), 1450);
  assert.throws(() => minutes('6:01:30')); assert.throws(() => minutes('abc'));
});
const net = buildNet(files);
t('padrões e variantes: viagens iguais dividem padrão e deslocamentos', () => {
  assert.equal(net.patterns.length, 2); assert.equal(net.trips.length, 4);
  const p = net.patterns.find(x => x.dir === 0);
  assert.deepEqual(p.stops, ['1', '2', '3']); assert.deepEqual(p.variants, [[0, 10, 15], [0, 11, 16], [0, 12, 17]]);
});
t('viagem: horários por parada, inclusive depois da meia-noite; parada ordenada por sequência', () => {
  const late = net.trips.find(x => x[4] === 'XU1');
  assert.deepEqual(tripStops(net, late), [['1', 1430], ['2', 1441], ['3', 1446]]);
  const back = net.trips.find(x => x[4] === 'XS0');
  assert.deepEqual(tripStops(net, back), [['2', 480], ['3', 485]]);
});
t('serviços do dia: semana, sábado, exceção que acrescenta e que remove', () => {
  assert.deepEqual([...activeServices(net, '2026-11-26')], ['XU']);
  assert.deepEqual([...activeServices(net, '2026-11-28')], ['XS']);
  assert.deepEqual([...activeServices(net, '2026-12-07')].sort(), ['XS', 'XU']);
  assert.deepEqual([...activeServices(net, '2026-12-08')], ['XD']);
  assert.deepEqual([...activeServices(net, '2027-01-04')], []);
});
t('feed e paradas', () => {
  assert.equal(net.feed.end, '20261231'); assert.deepEqual(net.stops['2'], ['Rua, Beta', 41.2, -8.7, 'Z1']);
});
t('erros: viagem sem horário e serviço sem calendário', () => {
  assert.throws(() => buildNet({ ...files, 'trips.txt': files['trips.txt'] + 'X,XU,XU9,Fim,0,,1,S\n' }), /sem horários/);
  assert.throws(() => buildNet({ ...files, 'trips.txt': files['trips.txt'].replace(',XS,', ',ZZ,') }), /sem calendário/);
});
console.log(`${n} grupos ok`);

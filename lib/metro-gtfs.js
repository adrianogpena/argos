// GTFS do Metro do Porto -> rede compacta (gtfs/metro/net.json). Puro, sem DOM nem rede; testado em test/metro-gtfs.test.mjs.
// Os horários são idênticos de uma viagem para outra no mesmo "padrão" (linha, sentido, destino, paradas), só muda a hora de saída
// e, em poucas variantes, os minutos entre paradas. Por isso a rede guarda padrões + variantes de deslocamento + viagens (padrão, variante, saída).
// Minutos desde 00:00 do dia de serviço; viagens depois da meia-noite passam de 1440 (GTFS usa 24:10:00, 25:00:00...).

export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.some(x => x !== ''));
  if (!head) return [];
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

// "6:01:00" -> 361. Segundos têm de ser 0 (o feed do Metro só usa minutos inteiros).
export function minutes(t) {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(String(t).trim());
  if (!m) throw new Error(`hora inválida: ${t}`);
  if (m[3] !== '00') throw new Error(`hora com segundos: ${t}`);
  return +m[1] * 60 + +m[2];
}

// files = { 'stops.txt': texto, 'routes.txt': ..., 'trips.txt': ..., 'stop_times.txt': ..., 'calendar.txt': ..., 'calendar_dates.txt': ..., 'feed_info.txt'? }
export function buildNet(files) {
  const stopsRows = parseCsv(files['stops.txt']), routesRows = parseCsv(files['routes.txt']), tripsRows = parseCsv(files['trips.txt']);
  const timesRows = parseCsv(files['stop_times.txt']), calRows = parseCsv(files['calendar.txt']);
  const datesRows = files['calendar_dates.txt'] ? parseCsv(files['calendar_dates.txt']) : [];
  const feedRow = files['feed_info.txt'] ? parseCsv(files['feed_info.txt'])[0] || {} : {};

  const stops = {};
  for (const s of stopsRows) stops[s.stop_id] = [s.stop_name, +s.stop_lat, +s.stop_lon, s.zone_id];
  const routes = {};
  for (const r of routesRows) routes[r.route_id] = { short: r.route_short_name, color: r.route_color, text: r.route_text_color };
  const services = {};
  for (const c of calRows) services[c.service_id] = {
    days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(d => +c[d]),
    start: c.start_date, end: c.end_date,
  };
  const exceptions = {};
  for (const d of datesRows) {
    const e = (exceptions[d.date] ??= { add: [], remove: [] });
    (d.exception_type === '1' ? e.add : e.remove).push(d.service_id);
  }

  const byTrip = new Map();
  for (const r of timesRows) { let a = byTrip.get(r.trip_id); if (!a) byTrip.set(r.trip_id, a = []); a.push(r); }

  const patterns = [], pIndex = new Map(), trips = [];
  for (const t of tripsRows) {
    const rows = byTrip.get(t.trip_id);
    if (!rows) throw new Error(`viagem sem horários: ${t.trip_id}`);
    if (!services[t.service_id]) throw new Error(`serviço sem calendário: ${t.service_id} (viagem ${t.trip_id})`);
    rows.sort((a, b) => a.stop_sequence - b.stop_sequence);
    const ids = rows.map(r => r.stop_id);
    for (const id of ids) if (!stops[id]) throw new Error(`parada desconhecida: ${id} (viagem ${t.trip_id})`);
    const times = rows.map(r => { const a = minutes(r.arrival_time), d = minutes(r.departure_time); if (a !== d) throw new Error(`chegada diferente da saída em ${t.trip_id}`); return a; });
    for (let i = 1; i < times.length; i++) if (times[i] < times[i - 1]) throw new Error(`horário volta no tempo em ${t.trip_id}`);
    const key = [t.route_id, t.direction_id, t.trip_headsign, ids.join('-')].join('|');
    let p = pIndex.get(key);
    if (p == null) { p = patterns.length; pIndex.set(key, p); patterns.push({ route: t.route_id, dir: +t.direction_id, headsign: t.trip_headsign, stops: ids, variants: [], _v: new Map() }); }
    const pat = patterns[p], start = times[0], off = times.map(x => x - start), vk = off.join(',');
    let v = pat._v.get(vk);
    if (v == null) { v = pat.variants.length; pat._v.set(vk, v); pat.variants.push(off); }
    trips.push([p, v, start, t.service_id, t.trip_id]);
  }
  for (const p of patterns) delete p._v;
  trips.sort((a, b) => a[2] - b[2] || a[0] - b[0]);
  return {
    feed: { start: feedRow.feed_start_date || '', end: feedRow.feed_end_date || '', version: feedRow.feed_version || '' },
    stops, routes, services, exceptions, patterns, trips,
  };
}

// Serviços ativos numa data (AAAA-MM-DD ou Date): calendário semanal dentro de start/end, mais as exceções (1 = acrescenta, 2 = remove).
export function activeServices(net, date) {
  const d = typeof date === 'string' ? new Date(date + 'T12:00:00') : date;
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const dow = (d.getDay() + 6) % 7;
  const on = new Set(Object.entries(net.services).filter(([, s]) => s.days[dow] && s.start <= ymd && ymd <= s.end).map(([id]) => id));
  const ex = net.exceptions[ymd];
  if (ex) { for (const id of ex.remove) on.delete(id); for (const id of ex.add) on.add(id); }
  return on;
}

// Hora de cada parada de uma viagem: [[stopId, minutos], ...]
export function tripStops(net, trip) {
  const p = net.patterns[trip[0]], off = p.variants[trip[1]];
  return p.stops.map((id, i) => [id, trip[2] + off[i]]);
}

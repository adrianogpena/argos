// Rede da UNIR para a aba Unir: cada linha é um círculo (ida e volta do mesmo ônibus, sem início nem fim) e os dois
// lados da rua são o mesmo lugar. A UNIR só publica horários por parada; daqui sai o que falta:
//   - duração e horário de cada viagem (para saber quando o ônibus chega ao fim da linha e recomeça);
//   - grupos de paradas do mesmo lugar (mesmo nome, até 250 m).
// A rede é dado público de transporte, mas fica no cofre (coleção `unir-net`), não no git. Gerada por `tools/unir.mjs`.
// Lógica pura, testável em Node.

const hms = t => { const [h, m, s = 0] = String(t).split(':').map(Number); return h * 60 + m + s / 60; };
const r1 = x => Math.round(x * 10) / 10;
export const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const GROUP_M = 250;
export const MAX_LAYOVER = 25;   // minutos: espera máxima no fim da linha para ainda ser o mesmo ônibus

function meters(a, b) {
  const r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  return 2 * 6371000 * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2));
}

/**
 * `stops` = { id: resposta de get_horarios_prg } (cada uma com designa, lat, lon e horarios[]).
 * Devolve { lines: { linha: { dur: { sentido: min }, trips: { trip_id: [início, fim, sentido] } } }, groups: [[id, ...]] }.
 * início/fim = minutos desde o começo do dia de serviço, da primeira à última parada da viagem.
 */
export function buildNet(stops) {
  const trips = new Map();
  for (const [id, j] of Object.entries(stops)) for (const x of j.horarios || []) {
    if (!trips.has(x.trip_id)) trips.set(x.trip_id, { line: String(x.linha), sentido: String(x.sentido), rows: [] });
    trips.get(x.trip_id).rows.push({ o: Number(x['ordem:']), t: hms(x.chegada) });
  }
  const lines = {}, durs = {};
  for (const [tid, v] of trips) {
    if (v.rows.length < 2) continue;
    v.rows.sort((a, b) => a.o - b.o);
    const start = v.rows[0].t, end = v.rows[v.rows.length - 1].t;
    if (!(end > start)) continue;
    (lines[v.line] ||= { dur: {}, trips: {} }).trips[tid] = [r1(start), r1(end), v.sentido];
    (durs[`${v.line}|${v.sentido}`] ||= []).push(end - start);
  }
  for (const [k, d] of Object.entries(durs)) {
    const [line, s] = k.split('|'); d.sort((a, b) => a - b);
    lines[line].dur[s] = r1(d[d.length >> 1]);
  }
  const byName = new Map();
  for (const [id, j] of Object.entries(stops)) {
    if (j.lat == null) continue;
    const k = norm(j.designa); if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push([id, j]);
  }
  const groups = [];
  for (const list of byName.values()) {
    const used = new Set();
    for (const [a, ja] of list) {
      if (used.has(a)) continue;
      const g = [a]; used.add(a);
      for (const [b, jb] of list) if (!used.has(b) && meters(ja, jb) <= GROUP_M) { g.push(b); used.add(b); }
      if (g.length > 1) groups.push(g.sort((x, y) => x - y));
    }
  }
  return { lines, groups };
}

const SIZE = 6500;   // o cofre aceita 8 KB por registro

/** Registros do cofre (coleção `unir-net`): meta, grupos de lugar e uma ou mais partes por linha. */
export function netRecords(net, built = new Date().toISOString().slice(0, 10)) {
  const out = [{ id: 'meta', built, lines: Object.keys(net.lines).length, groups: net.groups.length }];
  let cur = [], n = 0;
  const flush = () => { if (cur.length) out.push({ id: `places-${n++}`, groups: cur }); cur = []; };
  for (const g of net.groups) { cur.push(g); if (JSON.stringify(cur).length > SIZE) { const last = cur.pop(); flush(); cur = [last]; } }
  flush();
  for (const [line, l] of Object.entries(net.lines)) {
    let part = {}, k = 0;
    const emit = () => { if (Object.keys(part).length || k === 0) out.push({ id: `line-${line}-${k++}`, line, ...(k === 1 ? { dur: l.dur } : {}), trips: part }); part = {}; };
    for (const [tid, v] of Object.entries(l.trips)) { part[tid] = v; if (JSON.stringify(part).length > SIZE) { delete part[tid]; emit(); part[tid] = v; } }
    emit();
  }
  return out;
}

/** Inverso de netRecords. */
export function netFromRecords(items) {
  const net = { lines: {}, groups: [], built: null };
  for (const r of items || []) {
    if (r.id === 'meta') net.built = r.built;
    else if (Array.isArray(r.groups)) net.groups.push(...r.groups);
    else if (r.line) {
      const l = (net.lines[r.line] ||= { dur: {}, trips: {} });
      Object.assign(l.dur, r.dur || {}); Object.assign(l.trips, r.trips || {});
    }
  }
  return net;
}

/** Paradas do mesmo lugar que `id` (inclui o próprio), em texto como vêm dos ids ("1443"). Aceita "vng:N". */
export function sisters(net, id) {
  const n = String(id).replace(/^vng:/, '');
  const g = (net?.groups || []).find(x => x.map(String).includes(n));
  return (g ? g.map(String) : [n]).map(x => `vng:${x}`);
}

/** Viagem da tabela, ou estimada pelo horário do trip_id e pela duração mediana da linha. */
function span(net, line, tripId, sentido) {
  const t = net?.lines?.[line]?.trips?.[tripId];
  if (t) return { start: t[0], end: t[1] };
  const dur = net?.lines?.[line]?.dur?.[sentido], m = /:(\d{2})(\d{2})$/.exec(tripId);
  if (dur == null || !m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  return { start, end: start + dur };
}

/** Sentido da viagem; respostas guardadas antes não o traziam, mas o trip_id também o diz (…:0:2:0630). */
const sentidoOf = x => x.sentido != null ? String(x.sentido) : (/:(\d):\d{4}$/.exec(x.trip_id) || [])[1] || '';

const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

/** Constantes ajustáveis (minutos, exceto a razão). */
export const MAX_RIDE = 90;        // chegadas com viagem mais longa que isso não aparecem
export const LONGER_RATIO = 1.25;  // um sentido é "mais longo" se passa de melhor * razão + folga
export const LONGER_PAD = 2;

/**
 * Como este ônibus (x, saindo da origem em t0) chega a um lugar, com `dRows` = paradas do lugar nesse dia.
 * 'direct' = o mesmo trip_id passa lá depois; 'continues'/'loop' = segue o círculo (ver loopDepartures);
 * 'ends' = o lugar é o fim da linha (`destName`, só se passa a lista de partidas): chegada estimada pelo fim da viagem, ou sem hora.
 * Devolve { mode, arrAt, toTrip } ou null.
 */
function routeTo(x, net, t0, dRows, at, destName = null) {
  const line = String(x.linha), sentido = sentidoOf(x);
  const hit = dRows.filter(r => r.tripId === x.trip_id && r.t > t0).sort((a, b) => a.t - b.t)[0];
  if (hit) return { mode: 'direct', arrAt: at(hit.t) };
  const sp = span(net, line, x.trip_id, sentido);
  if (destName && norm(x.destino) === destName) return { mode: 'ends', arrAt: sp ? at(sp.end) : null };
  if (!sp) return null;
  // 1) o fim da linha, e a primeira viagem do outro sentido que sai depois e passa no destino
  const flip = sentido === '1' ? '2' : '1';
  const next = (want, after) => dRows.filter(r => r.line === line && r.sentido === want).map(r => ({ ...r, sp: span(net, line, r.tripId, want) }))
    .filter(r => r.sp && r.sp.start >= after - 0.5 && r.sp.start - after <= MAX_LAYOVER && r.t >= r.sp.start).sort((a, b) => a.t - b.t)[0];
  let c = next(flip, sp.end), mode = 'continues';
  if (!c) {
    // 2) uma volta inteira: a viagem seguinte (outro sentido) nem passa no destino; a depois dela, sim
    const mid = Object.entries(net?.lines?.[line]?.trips || {}).filter(([, v]) => v[2] === flip && v[0] >= sp.end - 0.5 && v[0] - sp.end <= MAX_LAYOVER).sort((a, b) => a[1][0] - b[1][0])[0];
    if (mid) { c = next(sentido, mid[1][1]); mode = 'loop'; }
  }
  return c && c.t > t0 ? { mode, arrAt: at(c.t), toTrip: c.tripId } : null;
}

/**
 * Ônibus que saem do lugar de origem, em ordem de horário, e como chegam ao lugar de destino.
 * `days` = [{ date: 'AAAA-MM-DD', origin: [respostas das paradas do lugar de origem], dest: [idem do destino] }].
 * Cada linha é um círculo: se o mesmo ônibus não passa no destino depois da origem, ele segue até o fim da linha,
 * recomeça na viagem do outro sentido e passa no destino (mode 'continues'); se precisar de mais uma volta, 'loop'.
 * Por linha, o sentido do círculo com o menor trajeto fica normal; o outro (`fade`) é marcado como mais longo.
 * Sem destino (`days[].dest` ausente), só lista as saídas.
 */
export function loopDepartures(days, net, now, limit = 10) {
  const rows = [];
  for (const { date, origin = [], dest = null } of days) {
    const [y, mo, d] = date.split('-').map(Number), base = new Date(y, mo - 1, d).getTime(), at = m => base + Math.round(m * 60000);
    const dRows = [];   // paradas do destino nesse dia
    for (const s of dest || []) for (const x of s.horarios || []) dRows.push({ tripId: x.trip_id, line: String(x.linha), sentido: sentidoOf(x), t: hms(x.chegada) });
    const seen = new Set();
    for (const s of origin) for (const x of s.horarios || []) {
      const t0 = hms(x.chegada), depAt = at(t0);
      if (depAt < now) continue;
      const key = `${x.trip_id}|${s.prg}|${Math.round(t0)}`;
      if (seen.has(key)) continue; seen.add(key);
      const line = String(x.linha), sentido = sentidoOf(x);
      const row = { tripId: x.trip_id, line, sentido, headsign: String(x.destino || '').trim(), depAt, fromId: s.prg, fromName: String(s.designa || '').trim(), mode: null };
      if (dest) {
        Object.assign(row, routeTo(x, net, t0, dRows, at) || {});
        if (row.arrAt) row.rideMin = Math.round((row.arrAt - depAt) / 60000);
      }
      rows.push(row);
    }
  }
  rows.sort((a, b) => a.depAt - b.depAt || a.line.localeCompare(b.line, 'pt', { numeric: true }));
  if (rows.some(r => 'mode' in r) && days.some(d => d.dest)) {
    const by = new Map();
    for (const r of rows) if (r.rideMin != null) { const k = `${r.line}|${r.sentido}`; (by.get(k) || by.set(k, []).get(k)).push(r.rideMin); }
    const med = new Map([...by].map(([k, v]) => [k, median(v)]));
    const best = new Map();
    for (const [k, m] of med) { const l = k.split('|')[0]; best.set(l, Math.min(best.get(l) ?? Infinity, m)); }
    for (const r of rows) {
      if (r.rideMin == null) { r.fade = 'none'; continue; }
      const m = med.get(`${r.line}|${r.sentido}`), b = best.get(r.line);
      r.fade = m > b * 1.25 + 2 ? 'longer' : null;
      r.sideMedian = m; r.bestMedian = b;
    }
  }
  return rows.slice(0, limit);
}

/**
 * Próximos ônibus de um lugar de origem e, para cada um, onde chega entre os lugares salvos (sem escolher destino).
 * `days` = [{ date, origin: [respostas do lugar de origem], dests: [{ id, stops: [respostas do lugar] }] }]; `dests` na ordem de exibição.
 * Cada ônibus ganha `arrivals` = [{ id, arrAt, rideMin, mode }] na ordem de `dests`. Regras, por lugar e linha:
 *   - o sentido de menor trajeto (o mínimo já visto, em `opts.memo`, que o chamador guarda entre chamadas para não oscilar) vale sempre;
 *   - o sentido mais longo só vale se chega antes do próximo ônibus do sentido curto (ou se não há outro);
 *   - viagens acima de `opts.maxRide` (MAX_RIDE) não contam.
 * Sem nenhuma chegada, `fade: 'none'`. Tudo é calculado sobre todos os ônibus dos dias recebidos; só no fim se aplica `limit`.
 */
export function multiDepartures(days, net, now, limit = 10, opts = {}) {
  const { maxRide = MAX_RIDE, memo = {}, ratio = LONGER_RATIO, pad = LONGER_PAD } = opts;
  const order = [];
  for (const d of days) for (const x of d.dests || []) if (!order.includes(x.id)) order.push(x.id);
  const rows = [], cand = new Map();   // cand: linha da lista -> { id: { arrAt, rideMin, mode } }
  for (const { date, origin = [], dests = [] } of days) {
    const [y, mo, d] = date.split('-').map(Number), base = new Date(y, mo - 1, d).getTime(), at = m => base + Math.round(m * 60000);
    const places = dests.map(p => {
      const dRows = [];
      for (const s of p.stops || []) for (const x of s.horarios || []) dRows.push({ tripId: x.trip_id, line: String(x.linha), sentido: sentidoOf(x), t: hms(x.chegada) });
      return { id: p.id, dRows, name: norm((p.stops || []).find(s => s.designa)?.designa) };
    });
    const seen = new Set();
    for (const s of origin) for (const x of s.horarios || []) {
      const t0 = hms(x.chegada), depAt = at(t0);
      if (depAt < now) continue;
      const key = `${x.trip_id}|${s.prg}|${Math.round(t0)}`;
      if (seen.has(key)) continue; seen.add(key);
      const row = { tripId: x.trip_id, line: String(x.linha), sentido: sentidoOf(x), headsign: String(x.destino || '').trim(), depAt, fromId: s.prg, fromName: String(s.designa || '').trim(), arrivals: [] };
      const c = {};
      for (const p of places) {
        const r = routeTo(x, net, t0, p.dRows, at, p.name);
        if (r) c[p.id] = { id: p.id, mode: r.mode, arrAt: r.arrAt, rideMin: r.arrAt != null ? Math.round((r.arrAt - depAt) / 60000) : null };
      }
      cand.set(row, c); rows.push(row);
    }
  }
  rows.sort((a, b) => a.depAt - b.depAt || a.line.localeCompare(b.line, 'pt', { numeric: true }));
  // menor trajeto por lugar, linha e sentido: o mínimo visto agora e antes
  for (const r of rows) for (const a of Object.values(cand.get(r))) if (a.rideMin != null) {
    const m = (memo[`${a.id}|${r.line}`] ||= {}); m[r.sentido] = Math.min(m[r.sentido] ?? Infinity, a.rideMin);
  }
  const isShort = (id, r, a) => { const m = memo[`${id}|${r.line}`]; return a.rideMin == null || m[r.sentido] <= Math.min(...Object.values(m)) * ratio + pad; };
  for (const id of order) {
    const byLine = new Map();
    for (const r of rows) { const a = cand.get(r)[id]; if (a) (byLine.get(r.line) || byLine.set(r.line, []).get(r.line)).push([r, a]); }
    for (const list of byLine.values()) list.forEach(([r, a], i) => {
      let keep = isShort(id, r, a);
      if (!keep) {   // sentido mais longo: só se chega antes do próximo ônibus do sentido curto
        const g = list.slice(i + 1).find(([r2, a2]) => isShort(id, r2, a2) && a2.arrAt != null);
        keep = !g || a.arrAt < g[1].arrAt;
      }
      if (keep && (a.rideMin == null || a.rideMin <= maxRide)) r.arrivals.push(a);
    });
  }
  for (const r of rows) { r.arrivals.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)); if (!r.arrivals.length) r.fade = 'none'; }
  return rows.slice(0, limit);
}

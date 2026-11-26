// Partidas do Metro do Porto a partir da rede compacta (gtfs/metro/net.json, ver lib/metro-gtfs.js). Puro, sem DOM nem rede.
// O Metro tem uma parada por estação (as duas plataformas dividem o stop_id) e viagens com início e fim. O sentido vem do
// destino da viagem (`headsign`, sempre o nome da última estação) e da próxima estação. Chegar a um destino = a mesma viagem
// passa nele depois da origem. Horários depois da meia-noite pertencem ao dia de serviço anterior (minutos acima de 1440).
import { activeServices } from './metro-gtfs.js';

const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const byName = (a, b) => a.sort.localeCompare(b.sort, 'pt');
export const SERVICE_DAYS_BACK = 1;   // ontem: viagens que passam da meia-noite
export const SERVICE_DAYS_AHEAD = 1;  // amanhã: quando a noite já não tem mais saídas

/** Estações em ordem alfabética: [{ id, name, zone }]. */
export function stationList(net) {
  return Object.entries(net.stops).map(([id, s]) => ({ id, name: s[0], zone: s[3], sort: norm(s[0]) })).sort(byName).map(({ sort, ...s }) => s);
}

/** Estações que o metro alcança direto saindo de `originId` (sem baldeação), em ordem alfabética: [{ id, name, zone, routes: ['A', 'E'] }]. */
export function destinationsFrom(net, originId) {
  const found = new Map();
  for (const p of net.patterns) {
    const i = p.stops.indexOf(String(originId));
    if (i < 0) continue;
    for (const id of p.stops.slice(i + 1)) {
      const f = found.get(id) || found.set(id, { id, name: net.stops[id][0], zone: net.stops[id][3], routes: [] }).get(id);
      const short = net.routes[p.route]?.short || p.route;
      if (!f.routes.includes(short)) f.routes.push(short);
    }
  }
  return [...found.values()].sort((a, b) => norm(a.name).localeCompare(norm(b.name), 'pt'));
}

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Próximas partidas de uma estação, em ordem de horário.
 * `now` = ms desde 1970 (hora local do aparelho). `opts.dest` = id de uma estação: só viagens que passam nela depois da origem.
 * Cada linha: { tripId, route, line, color, text, headsign, dir, depAt, fromId, nextId, nextName, date, arrAt?, rideMin?, stops? }
 * `stops` = quantas paradas até o destino. A viagem que termina na própria origem não sai de lá, então não entra.
 */
export function departures(net, originId, now, opts = {}) {
  const { dest = null, limit = 10 } = opts, from = String(originId), to = dest == null ? null : String(dest);
  if (!net.stops[from]) return [];
  const pat = net.patterns.map(p => {
    const i = p.stops.indexOf(from);
    if (i < 0 || i === p.stops.length - 1) return null;
    const j = to == null ? -1 : p.stops.indexOf(to, i + 1);
    if (to != null && j < 0) return null;
    return { i, j };
  });
  const out = [], today = new Date(now);
  for (let k = -SERVICE_DAYS_BACK; k <= SERVICE_DAYS_AHEAD; k++) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + k, 12);
    const on = activeServices(net, day), date = ymd(day);
    const at = m => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, Math.round(m)).getTime();
    for (const t of net.trips) {
      const x = pat[t[0]]; if (!x || !on.has(t[3])) continue;
      const p = net.patterns[t[0]], off = p.variants[t[1]], depAt = at(t[2] + off[x.i]);
      if (depAt < now) continue;
      const r = net.routes[p.route] || {}, nextId = p.stops[x.i + 1];
      const row = { tripId: t[4], route: p.route, line: r.short || p.route, color: r.color || '', text: r.text || '', headsign: p.headsign, dir: p.dir, depAt, fromId: from, nextId, nextName: net.stops[nextId][0], date };
      if (to != null) { row.arrAt = at(t[2] + off[x.j]); row.rideMin = Math.round((row.arrAt - depAt) / 60000); row.stops = x.j - x.i; }
      out.push(row);
    }
  }
  out.sort((a, b) => a.depAt - b.depAt || a.line.localeCompare(b.line, 'pt'));
  return out.slice(0, limit);
}

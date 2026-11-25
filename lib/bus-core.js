// Lógica pura dos ônibus (sem DOM). Usada por onibus.html e pela home; testada em test/core.test.mjs.
const Core = (() => {
  const norm = s => String(s ?? '').trim().toUpperCase();
  const routeOf = a => norm(a.route_short_name ?? a.route_long_name ?? a.route_id);

  /**
   * Arrivals at one stop for one line, keyed by trip_id (smallest non-negative minutes per trip).
   * The map also carries `listed` (rows at the stop, all lines) and `horizon` (latest minutes listed),
   * so `maybeCut` can tell whether a missing trip may only have been cut off a long list.
   */
  function lineArrivals(arrivals, line) {
    const L = norm(line), byTrip = new Map();
    byTrip.listed = (arrivals || []).length;
    byTrip.horizon = Math.max(-1, ...(arrivals || []).map(a => Number(a.arrival_minutes)).filter(Number.isFinite));
    for (const a of arrivals || []) {
      if (routeOf(a) !== L) continue;
      const m = Number(a.arrival_minutes);
      if (a.arrival_minutes === null || a.arrival_minutes === '' || !Number.isFinite(m) || m < 0) continue;
      const id = a.trip_id || `${L}@${a.estimated_arrival_time ?? m}`;
      const prev = byTrip.get(id);
      if (!prev || m < prev._m) byTrip.set(id, { ...a, _m: m });
    }
    return byTrip;
  }

  /**
   * True if a trip due at `minutes` may be missing from this stop's list only because the list was cut off:
   * the list is long (busy stop) and ends before `minutes`. Absence from such a list does not mean "passed".
   */
  const LIST_FULL = 8;
  const maybeCut = (m, minutes) => !!m && m.listed >= LIST_FULL && minutes > m.horizon;

  /**
   * Poll my stop, then walk backwards toward the start of the line, `concurrency` stops at a time,
   * until every followed bus has dropped out of a stop's list (that is where it currently is),
   * or `maxBack` stops have been checked. Returns raw observations: Map(stopIndex -> Map(trip_id -> arrival)).
   */
  async function track({ fetchStop, stops, myIdx, line, count = 2, maxBack = 15, concurrency = 3, ahead = 0, ghostMinutes = 10 }) {
    const obs = new Map();
    const errors = [];
    let requests = 1;
    const mine = await fetchStop(stops[myIdx].id);         // a failure here is fatal: the caller shows it
    obs.set(myIdx, lineArrivals(mine.arrivals, line));
    const followed = [...obs.get(myIdx).values()].sort((a, b) => a._m - b._m).slice(0, count).map(a => a.trip_id || null);
    const open = new Set(followed.filter(Boolean));
    const lastMin = new Map([...obs.get(myIdx).values()].map(a => [a.trip_id, a._m]));
    const floor = Math.max(0, myIdx - maxBack);
    let k = myIdx - 1;
    while (k >= floor && open.size) {
      const batch = [];
      for (let i = k; i >= floor && batch.length < concurrency; i--) batch.push(i);
      const res = await Promise.allSettled(batch.map(i => fetchStop(stops[i].id)));
      requests += batch.length;
      let broken = false;
      for (let j = 0; j < batch.length; j++) {
        const i = batch[j];
        if (res[j].status === 'rejected') { errors.push({ idx: i, error: res[j].reason }); broken = true; break; }
        const m = lineArrivals(res[j].value.arrivals, line);
        obs.set(i, m);
        for (const t of [...open]) {
          if (m.has(t)) lastMin.set(t, m.get(t)._m);
          else if (!maybeCut(m, lastMin.get(t))) open.delete(t);
        }
        if (!open.size) break;
      }
      if (broken) break;
      k -= batch.length;
    }
    // Then walk forward up to `ahead` stops, until a stop lists a trip that my stop no longer lists:
    // that is the last bus that passed. A failure here only means it is not shown.
    const atMine = obs.get(myIdx);
    const last = Math.min(stops.length - 1, myIdx + ahead);
    let f = myIdx + 1, found = false;
    while (f <= last && !found) {
      const batch = [];
      for (let i = f; i <= last && batch.length < concurrency; i++) batch.push(i);
      const res = await Promise.allSettled(batch.map(i => fetchStop(stops[i].id)));
      requests += batch.length;
      let broken = false;
      for (let j = 0; j < batch.length; j++) {
        if (res[j].status === 'rejected') { broken = true; break; }
        const m = lineArrivals(res[j].value.arrivals, line);
        obs.set(batch[j], m);
        if ([...m.values()].some(a => isPassed(a, atMine, ghostMinutes))) { found = true; break; }
      }
      if (broken) break;
      f += batch.length;
    }
    return { obs, errors, requests, meta: { stop_name: mine.stop_name, last_updated: mine.last_updated, data_source: mine.data_source } };
  }

  /**
   * Turn observations into "where is each bus I care about".
   * Next stop = among the contiguous run of stops (counting back from my stop) that list the trip,
   * the one with the smallest arrival_minutes (ties: the earlier stop).
   */
  function locate({ obs, stops, myIdx, count = 2, ghostMinutes = 10 }) {
    const atMine = obs.get(myIdx);
    if (!atMine) return [];
    const polled = [...obs.keys()];
    const lowest = Math.min(...polled);
    return [...atMine.values()].sort((a, b) => a._m - b._m).slice(0, count).map(a => {
      const t = a.trip_id;
      const seen = [];
      let i = myIdx;
      while (i >= 0 && obs.has(i)) {
        const x = obs.get(i).get(t || `__none__`) ?? (i === myIdx ? a : null);
        if (!x) {
          if (t && maybeCut(obs.get(i), seen.at(-1)[1]._m)) { i--; continue; }   // cut off a busy stop's list: look further back
          break;
        }
        seen.push([i, x]);
        if (!t) break;                       // without a trip_id we cannot follow it across stops
        i--;
      }
      const runEndedUnpolled = i >= 0 && !obs.has(i);   // ran into stops we did not check
      let next = seen[0];
      for (const s of seen) if (s[1]._m < next[1]._m || (s[1]._m === next[1]._m && s[0] < next[0])) next = s;
      const nextIdx = next[0], nextMin = next[1]._m;
      let state = 'moving';
      if (!t) state = 'unknown';
      else if (runEndedUnpolled && nextIdx === lowest && lowest > 0) state = 'far';
      else if (nextIdx === 0) state = 'terminus';
      else if (nextMin > ghostMinutes) state = 'scheduled';   // "approaching" a stop it won't reach for a long time = not started
      if (state === 'moving' && nextIdx === myIdx && a._m <= 1) state = 'arriving';
      const etas = {};
      for (const [j, x] of seen) etas[j] = x._m;
      return {
        tripId: t, headsign: a.trip_headsign || '', minutes: a._m,
        clock: a.estimated_arrival_time ?? null, delay: a.delay_minutes ?? null, status: a.status ?? null,
        nextIdx, nextName: stops[nextIdx]?.name ?? '', nextMinutes: nextMin,
        stopsAway: myIdx - nextIdx, state, etas,
      };
    });
  }

  /**
   * A trip listed after my stop has passed it if my stop no longer lists it. If my list may be cut off before
   * the trip's minutes, a bus not yet at my stop could be missing too (it is due there sooner), so that does not count.
   */
  const isPassed = (a, atMine, ghostMinutes) => !!a.trip_id && !atMine.has(a.trip_id) && a._m <= ghostMinutes && !maybeCut(atMine, a._m);

  /**
   * The last bus that passed my stop: the first stop after mine (in the polled run) that lists a trip
   * my stop no longer lists. If several, the one furthest from that stop, i.e. closest behind it.
   */
  function locatePassed({ obs, stops, myIdx, ghostMinutes = 10 }) {
    const atMine = obs.get(myIdx);
    if (!atMine) return null;
    for (let i = myIdx + 1; obs.has(i); i++) {
      const hit = [...obs.get(i).values()].filter(a => isPassed(a, atMine, ghostMinutes)).sort((a, b) => b._m - a._m)[0];
      if (hit) return {
        tripId: hit.trip_id, headsign: hit.trip_headsign || '', nextIdx: i, nextName: stops[i]?.name ?? '', nextMinutes: hit._m,
        stopsPast: i - myIdx, delay: hit.delay_minutes ?? null, status: hit.status ?? null,
      };
    }
    return null;
  }

  /** Parse a pasted stop list. Returns [{id, code, name}]. */
  function parseStopList(text) {
    const isCode = s => /^[A-Z][A-Z0-9]{1,7}$/.test(s) && (/\d/.test(s) || s.length <= 4);
    let rows = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (rows.length === 1) rows = rows[0].split(/[,;]\s*(?=[A-Z][A-Z0-9]{1,7}\s)/).map(s => s.trim()).filter(Boolean);
    const out = [];
    for (let r of rows) {
      r = r.replace(/^\d+\s*[.)]\s+/, '').replace(/[.,;]$/, '').trim();
      let m, code, name;
      if ((m = r.match(/^([A-Z][A-Z0-9]{1,7})\s*[\t,;|:–—-]?\s+(.+)$/)) && isCode(m[1])) { code = m[1]; name = m[2]; }
      else if ((m = r.match(/^(.+?)\s*[([]([A-Z][A-Z0-9]{1,7})[)\]]$/)) && isCode(m[2])) { code = m[2]; name = m[1]; }
      else if ((m = r.match(/^(.+?)\s*[\t,;|–—-]?\s+([A-Z][A-Z0-9]{1,7})$/)) && isCode(m[2])) { code = m[2]; name = m[1]; }
      if (code) out.push({ id: code, code, name: name.replace(/^[\s,;|:–—-]+|[\s,;|:–—-]+$/g, '') });
    }
    return out;
  }

  /** Normalise /api/route/{id}/stops/direction output. */
  function normaliseRouteStops(json) {
    const list = Array.isArray(json) ? json : (json && (json.stops || json.data)) || [];
    return list.map(s => ({
      id: String(s.stop_id ?? s.stop_code ?? s.code),
      code: String(s.stop_code ?? s.stop_id ?? s.code),
      name: String(s.stop_name ?? s.name ?? ''),
      seq: Number(s.stop_sequence ?? s.seq ?? 0),
      lat: s.stop_lat ?? s.lat ?? null, lon: s.stop_lon ?? s.lon ?? null,
    })).sort((a, b) => a.seq - b.seq);
  }

  /** Find a line's internal route_id and colour in /api/stops/{id}/routes output. */
  function findRoute(json, line) {
    const L = norm(line);
    const list = Array.isArray(json) ? json : (json && (json.dropdown_routes || json.routes)) || [];
    const hit = list.find(r => norm(r.route_short_name ?? r.route_slug ?? r.short_name) === L);
    if (!hit) return null;
    return { routeId: String(hit.route_id), color: normColor(hit.route_color ?? hit.color ?? hit.colour), name: hit.route_long_name || '' };
  }

  function normColor(c) {
    if (!c) return null;
    c = String(c).trim().replace(/^#?/, '#');
    return /^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : (/^#[0-9a-f]{3}$/i.test(c) ? c.toUpperCase() : null);
  }

  // ---------- UNIR (paragens.amp.pt): timetables only, no live data ----------

  /** The UNIR API sends its JSON inside a JSON string. */
  function unirParse(j) {
    if (typeof j === 'string') j = JSON.parse(j);
    if (!j || !Array.isArray(j.horarios)) throw new Error('The UNIR answer has no "horarios" list. The API may have changed.');
    return j;
  }

  /** "HH:MM:SS" to minutes from the start of the service day (can pass 24 h, e.g. "25:00:00"). */
  const hms = t => { const [h, m, s = 0] = String(t).split(':').map(Number); return h * 60 + m + s / 60; };

  /** Walking minutes between two stops: straight line + 30 %, at 80 m/min. */
  function walkMinutes(a, b) {
    if (a?.lat == null || b?.lat == null) return 0;
    const r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
    const m = 2 * 6371000 * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2));
    return Math.ceil(m * 1.3 / 80);
  }

  /** Apelido da parada (se houver e não for vazio) ou o nome oficial da UNIR. */
  function stopName(stop, names = {}) {
    const a = names && typeof names[stop?.prg] === 'string' ? names[stop.prg].trim() : '';
    return a || String(stop?.designa || '').trim();
  }

  /** Median ride in minutes per line, for trips listed at stop `a` and later at stop `b` on the same day. */
  function unirRides(a, b) {
    const at = new Map(b.horarios.map(x => [x.trip_id, x])), by = {};
    for (const x of a.horarios) {
      const y = at.get(x.trip_id);
      if (y && hms(y.chegada) > hms(x.chegada)) (by[x.linha] ||= []).push(hms(y.chegada) - hms(x.chegada));
    }
    const out = {};
    for (const [l, v] of Object.entries(by)) { v.sort((p, q) => p - q); out[l] = v[v.length >> 1]; }
    return out;
  }

  /**
   * One service day of one route: each trip listed at `from` and later at one of the `to` stops.
   * A terminus lists only departures, so a `to` stop with no matching trips gets the trips at `from`
   * whose destino is that stop, arriving after the ride time in `est` ({ line: minutes }).
   * `target` (a stop near home or school) adds the walk from the drop-off stop.
   * `names` = apelidos por id de parada ({ 'vng:N': 'Apelido' }); o nome oficial fica em fromOfficial/toOfficial.
   * Times are minutes from the start of the service day.
   */
  function unirTrips({ from, to, est = {}, target = null, names = {} }) {
    const out = [];
    const row = (x, t, arr, isEst) => ({
      tripId: x.trip_id, line: x.linha, headsign: String(x.destino || '').trim(),
      from: from.prg, fromOfficial: String(from.designa || '').trim(), fromName: stopName(from, names),
      to: t.prg, toOfficial: String(t.designa || '').trim(), toName: stopName(t, names),
      dep: hms(x.chegada), arr, walk: target && t.prg !== target.prg ? walkMinutes(t, target) : 0, est: isEst,
    });
    for (const t of to) {
      const at = new Map(t.horarios.map(x => [x.trip_id, x]));
      const before = out.length;
      for (const x of from.horarios) {
        const y = at.get(x.trip_id);
        if (y && hms(y.chegada) > hms(x.chegada)) out.push(row(x, t, hms(y.chegada), false));
      }
      if (out.length > before) continue;
      for (const x of from.horarios) {
        if (est[x.linha] != null && norm(x.destino) === norm(t.designa)) out.push(row(x, t, hms(x.chegada) + est[x.linha], true));
      }
    }
    return out;
  }

  /**
   * The next `n` buses after `now` across service days ([{ date: 'YYYY-MM-DD', trips }], local midnight).
   * One row per bus, with its quickest drop-off. `best` = earliest arrival; `beaten` = a later bus arrives no later.
   */
  function unirNext(days, now, n = 6) {
    const byBus = new Map();
    for (const { date, trips } of days) {
      const [y, mo, d] = date.split('-').map(Number), base = new Date(y, mo - 1, d).getTime();
      for (const t of trips) {
        const depAt = base + Math.round(t.dep * 60000);
        if (depAt < now) continue;
        const o = { ...t, depAt, arrAt: base + Math.round(t.arr * 60000), doneAt: base + Math.round((t.arr + t.walk) * 60000) };
        const k = `${t.tripId}@${Math.round(depAt / 60000)}`;
        if (!byBus.has(k) || o.doneAt < byBus.get(k).doneAt) byBus.set(k, o);
      }
    }
    const list = [...byBus.values()].sort((a, b) => a.depAt - b.depAt || a.doneAt - b.doneAt).slice(0, n);
    const first = Math.min(...list.map(o => o.doneAt));
    return list.map(o => ({ ...o, best: o.doneAt === first, beaten: list.some(p => p.depAt > o.depAt && p.doneAt <= o.doneAt) }));
  }

  return { lineArrivals, track, locate, locatePassed, parseStopList, normaliseRouteStops, findRoute, normColor, unirParse, stopName, walkMinutes, unirRides, unirTrips, unirNext };
})();
export default Core;

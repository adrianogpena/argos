// Acesso à rede dos ônibus, compartilhado por onibus.html e pela home. Sem DOM.
import Core from './bus-core.js';

export const STCP = 'https://stcp.pt';
export const UNIR = 'https://paragens.amp.pt';
export const PAGES_PROXY = 'https://argos-proxy.adrianogpena.workers.dev';
export const UNIR_KEY = 'argos.unir.';
export const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** GET simples para JSON, com limite de tempo. A página dos ônibus usa a sua, com erros mais detalhados. */
export async function fetchJSON(base, path, timeoutMs = 10000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(base + path, { signal: ctl.signal, headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

/** Base da API da STCP: o Worker na pages.dev (a stcp.pt não libera CORS), senão direto. */
export const stcpBase = host => /pages\.dev$/.test(host) ? PAGES_PROXY : STCP;

/**
 * Horários UNIR. Um dia de horário não muda, então cada um é buscado uma vez e guardado em `storage`.
 * `getJSON(base, path)` e `storage` (como o localStorage) são injetados.
 */
export function createUnir({ getJSON, storage }) {
  const mem = new Map();
  function unirStop(id, date) {
    const k = `${UNIR_KEY}${id}@${date}`;
    if (!mem.has(k)) mem.set(k, (async () => {
      try { const c = JSON.parse(storage.getItem(k)); if (c) return c; } catch (e) {}
      const j = Core.unirParse(await getJSON(UNIR, `/acarto2/get_horarios_prg?dia=${date}&id=${encodeURIComponent(id)}`));
      const slim = { prg: j.prg, designa: j.designa, lat: j.lat, lon: j.lon, horarios: j.horarios.map(({ trip_id, chegada, linha, destino }) => ({ trip_id, chegada, linha, destino })) };
      try { storage.setItem(k, JSON.stringify(slim)); } catch (e) {}
      return slim;
    })().catch(e => { mem.delete(k); throw e; }));
    return mem.get(k);
  }
  function unirPrune() {
    const keep = ymd(new Date(Date.now() - 864e5));
    try { Object.keys(storage).filter(k => k.startsWith(UNIR_KEY) && k.split('@')[1] < keep).forEach(k => storage.removeItem(k)); } catch (e) {}
  }
  async function unirDay(l, date) {
    const target = l.target ? await unirStop(l.target, date) : null;
    const trips = [];
    for (const r of l.routes) {
      const [from, ...to] = await Promise.all([r.from, ...r.to].map(id => unirStop(id, date)));
      const est = r.est ? Core.unirRides(...await Promise.all(r.est.map(id => unirStop(id, date)))) : {};
      trips.push(...Core.unirTrips({ from, to, est, target }));
    }
    return { date, trips };
  }
  /** Ontem (para as viagens depois da meia-noite), hoje e os dias seguintes até haver `n` ônibus. */
  async function unirUpcoming(l, n = 6) {
    const now = Date.now(), days = [];
    for (let k = -1; k < 8; k++) {
      const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + k);
      days.push(await unirDay(l, ymd(d)));
      if (k >= 0 && Core.unirNext(days, now, n).length >= n) break;
    }
    return Core.unirNext(days, now, n);
  }
  return { unirStop, unirDay, unirUpcoming, unirPrune };
}

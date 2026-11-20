// Pure logic for the car module. No DOM, no network: tested by test/car.test.mjs.

const num = v => { const t = String(v ?? '').trim().replace(',', '.'); const n = t === '' ? NaN : Number(t); return Number.isFinite(n) ? n : NaN; };
export const parseNum = num;

/** Validate and normalise a fuel record from form input. Returns {ok, rec} or {ok:false, error}. */
export function fuelRecord(f) {
  const rec = { id: f.id, date: String(f.date || ''), odometer: num(f.odometer), liters: num(f.liters), total: num(f.total), full: f.full !== false, station: String(f.station || '').trim().slice(0, 60), note: String(f.note || '').trim().slice(0, 200) };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.date)) return { ok: false, error: 'date' };
  if (!(rec.odometer >= 0)) return { ok: false, error: 'odometer' };
  if (!(rec.liters > 0 && rec.liters < 1000)) return { ok: false, error: 'liters' };
  if (!(rec.total >= 0 && rec.total < 100000)) return { ok: false, error: 'total' };
  rec.pricePerL = rec.liters ? rec.total / rec.liters : 0;
  return { ok: true, rec };
}

export const byOdometer = (a, b) => a.odometer - b.odometer || a.date.localeCompare(b.date);

/**
 * Consumption by the full-tank method: between two consecutive full fill-ups, litres put in
 * (the later full fill plus any partial fills in between) divided by the km driven.
 * Returns one entry per full fill-up that has a previous full fill-up.
 */
export function consumption(fuels) {
  const list = [...fuels].sort(byOdometer);
  const out = [];
  let prev = null, litres = 0, cost = 0;
  for (const f of list) {
    if (prev) { litres += f.liters; cost += f.total; }
    if (f.full) {
      if (prev && f.odometer > prev.odometer) {
        const km = f.odometer - prev.odometer;
        out.push({ id: f.id, date: f.date, odometer: f.odometer, km, litres, cost, kmPerL: km / litres, lPer100: litres / km * 100, costPerKm: cost / km });
      }
      prev = f; litres = 0; cost = 0;
    }
  }
  return out;
}

export function summary(fuels, services = []) {
  const list = [...fuels].sort(byOdometer);
  const cons = consumption(list);
  const spent = list.reduce((s, f) => s + f.total, 0);
  const litres = list.reduce((s, f) => s + f.liters, 0);
  const lastOdo = Math.max(0, ...list.map(f => f.odometer), ...services.map(s => s.odometer || 0));
  const kmCovered = cons.reduce((s, c) => s + c.km, 0);
  const consL = cons.reduce((s, c) => s + c.litres, 0);
  const consCost = cons.reduce((s, c) => s + c.cost, 0);
  return {
    count: list.length, spent, litres, lastOdo,
    avgKmPerL: consL ? kmCovered / consL : null,
    avgLPer100: kmCovered ? consL / kmCovered * 100 : null,
    avgCostPerKm: kmCovered ? consCost / kmCovered : null,
    lastKmPerL: cons.length ? cons[cons.length - 1].kmPerL : null,
    avgPricePerL: litres ? spent / litres : null,
  };
}

/** Money spent per calendar month (fuel + services), oldest first. */
export function monthlySpend(fuels, services = []) {
  const m = new Map();
  for (const r of [...fuels.map(f => ({ date: f.date, v: f.total })), ...services.map(s => ({ date: s.date, v: s.cost || 0 }))]) {
    const k = r.date.slice(0, 7); m.set(k, (m.get(k) || 0) + r.v);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, total]) => ({ month, total }));
}

/** Reminders from service records that carry nextKm and/or nextDate, newest record per kind wins. */
export function reminders(services, odometer, today) {
  const latest = new Map();
  for (const s of [...services].sort((a, b) => a.date.localeCompare(b.date))) latest.set(s.kind.toLowerCase(), s);
  const out = [];
  for (const s of latest.values()) {
    const left = Number.isFinite(s.nextKm) ? s.nextKm - odometer : null;
    const days = s.nextDate ? Math.round((Date.parse(s.nextDate) - Date.parse(today)) / 864e5) : null;
    if (left === null && days === null) continue;
    const overdue = (left !== null && left < 0) || (days !== null && days < 0);
    const soon = (left !== null && left <= 1000) || (days !== null && days <= 30);
    out.push({ kind: s.kind, kmLeft: left, daysLeft: days, state: overdue ? 'overdue' : soon ? 'soon' : 'ok' });
  }
  const rank = { overdue: 0, soon: 1, ok: 2 };
  return out.sort((a, b) => rank[a.state] - rank[b.state]);
}

export function serviceRecord(s) {
  const rec = { id: s.id, date: String(s.date || ''), odometer: num(s.odometer), kind: String(s.kind || '').trim().slice(0, 60), cost: num(s.cost), nextKm: num(s.nextKm), nextDate: String(s.nextDate || ''), note: String(s.note || '').trim().slice(0, 200) };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.date)) return { ok: false, error: 'date' };
  if (!rec.kind) return { ok: false, error: 'kind' };
  if (!(rec.odometer >= 0)) rec.odometer = 0;
  if (!(rec.cost >= 0)) rec.cost = 0;
  if (!Number.isFinite(rec.nextKm)) delete rec.nextKm;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.nextDate)) delete rec.nextDate;
  return { ok: true, rec };
}

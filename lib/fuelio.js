// Pure parser for Fuelio backup CSVs ("vehicle-N-local.csv"). No DOM, no network: tested by test/fuelio.test.mjs.
// Turns the "## Log" section into car-fuel records and the "## Costs" section into car-service records.

import { fuelRecord, serviceRecord } from './car-core.js';

/** Minimal CSV parser (RFC 4180 quotes). Returns an array of rows. */
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Split into named sections: { Vehicle: [{col: val}], Log: [...], Costs: [...], ... }. */
export function sections(text) {
  const out = {}; let name = null, head = null;
  for (const r of parseCsv(text)) {
    if (r.length === 1 && r[0].startsWith('## ')) { name = r[0].slice(3).trim(); out[name] = []; head = null; continue; }
    if (!name || (r.length === 1 && r[0] === '')) continue;
    if (!head) { head = r; continue; }
    out[name].push(Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
  }
  return out;
}

const day = s => String(s || '').slice(0, 10);
// stable ids from Fuelio's own ids, so running the import twice overwrites instead of duplicating
const safe = s => String(s).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30);

/** Convert one vehicle file. Returns { vehicle, fuel: [records], service: [records], skipped: [reasons] }. */
export function convert(text, prefix = 'fu') {
  const s = sections(text), skipped = [];
  const fuel = [], service = [];
  for (const r of s.Log || []) {
    const id = prefix + '-f' + safe(r.UniqueId || r.guid || fuel.length);
    const res = fuelRecord({
      id, date: day(r.Data), odometer: r['Odo (km)'], liters: r['Fuel (litres)'], total: r['Price (optional)'],
      full: r.Full === '1' && r.Missed !== '1',            // a missed fill-up makes the full-tank consumption unreliable
      station: r['City (optional)'], note: r['Notes (optional)'],
    });
    if (res.ok) fuel.push(res.rec); else skipped.push(`abastecimento ${day(r.Data)}: ${res.error}`);
  }
  const types = Object.fromEntries((s.CostCategories || []).map(c => [c.CostTypeID, c.Name]));
  for (const r of s.Costs || []) {
    if (r.isTemplate === '1') continue;
    const kind = r.CostTitle || types[r.CostTypeID] || '';
    const res = serviceRecord({
      id: prefix + '-s' + safe(r.UniqueId || r.guid || service.length),
      date: day(r.Date), odometer: r.Odo, kind, cost: r.Cost,
      nextKm: Number(r.RemindOdo) > 0 ? r.RemindOdo : '', nextDate: r.RemindDate, note: r.Notes,
    });
    if (res.ok) service.push(res.rec); else skipped.push(`custo ${day(r.Date)}: ${res.error}`);
  }
  const v = (s.Vehicle || [])[0] || {};
  return { vehicle: { name: v.Name || '', make: (v.Make || '').trim(), model: v.Model || '', year: v.Year || '' }, fuel, service, skipped };
}

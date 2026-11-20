// Pure logic for the health module (weight and height of people and pets). No DOM, no network: tested by test/health.test.mjs.
import { parseNum } from './car-core.js';

export const METRICS = {
  weight: { label: 'Peso', unit: 'kg', min: 0.01, max: 1000, decimals: 3 },
  height: { label: 'Altura', unit: 'cm', min: 1, max: 300, decimals: 1 },
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

export function memberRecord(m) {
  const kind = m.kind === 'pet' ? 'pet' : 'human';
  const rec = { id: m.id, name: String(m.name || '').trim().slice(0, 40), kind, species: String(m.species || '').trim().slice(0, 30), sex: String(m.sex || '').trim().slice(0, 10), birth: String(m.birth || ''), notes: String(m.notes || '').trim().slice(0, 300) };
  if (!rec.name) return { ok: false, error: 'name' };
  if (rec.birth && !DATE.test(rec.birth)) return { ok: false, error: 'birth' };
  return { ok: true, rec };
}

/** id is built from member + metric + date, so the same day replaces itself instead of duplicating. */
export const measureId = (member, metric, date) => `${member}-${metric}-${date}`;

export function measureRecord(m) {
  const spec = METRICS[m.metric];
  if (!spec) return { ok: false, error: 'metric' };
  const value = parseNum(m.value), date = String(m.date || '');
  if (!m.member) return { ok: false, error: 'member' };
  if (!DATE.test(date)) return { ok: false, error: 'date' };
  if (!(value >= spec.min && value <= spec.max)) return { ok: false, error: 'value' };
  return { ok: true, rec: { id: measureId(m.member, m.metric, date), member: m.member, metric: m.metric, value: round(value, spec.decimals), date } };
}

/** Measurements of one member and metric, oldest first. */
export const series = (measures, member, metric) => measures.filter(x => x.member === member && x.metric === metric).sort((a, b) => a.date.localeCompare(b.date));

/** Latest value, the previous one and the change between them; null when there is no data. */
export function latest(measures, member, metric) {
  const s = series(measures, member, metric);
  if (!s.length) return null;
  const last = s[s.length - 1], prev = s.length > 1 ? s[s.length - 2] : null;
  return { value: last.value, date: last.date, change: prev ? round(last.value - prev.value, METRICS[metric].decimals) : null, since: prev ? prev.date : null };
}

/** Age in whole years and months at `today` ('YYYY-MM-DD'); null without a valid birth date. */
export function age(birth, today) {
  if (!DATE.test(birth || '') || birth > today) return null;
  const [by, bm, bd] = birth.split('-').map(Number), [ty, tm, td] = today.split('-').map(Number);
  let months = (ty - by) * 12 + (tm - bm) - (td < bd ? 1 : 0);
  return { years: Math.floor(months / 12), months: months % 12, total: months };
}
export function ageText(birth, today) {
  const a = age(birth, today);
  if (!a) return '';
  if (a.years < 1) return a.months === 1 ? '1 mês' : a.months + ' meses';
  return a.years + (a.years === 1 ? ' ano' : ' anos') + (a.months ? ` e ${a.months} ${a.months === 1 ? 'mês' : 'meses'}` : '');
}

const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * One-off conversion of rows exported from the old database (name, kind, birth_date, metric, value, unit, recorded_on,
 * optionally species, sex, notes). Ids are stable, so running it twice overwrites instead of duplicating.
 */
export function fromRows(rows) {
  const members = new Map(), measures = new Map(), skipped = [];
  rows.forEach((r, i) => {
    const name = String(r.name || '').trim(), key = slug(name + '-' + (r.birth_date || ''));
    if (!name || !key) { skipped.push(`linha ${i + 2}: sem nome`); return; }
    if (!members.has(key)) {
      const m = memberRecord({ id: key, name, kind: r.kind, species: r.species, sex: r.sex, birth: r.birth_date, notes: r.notes });
      if (!m.ok) { skipped.push(`linha ${i + 2}: membro inválido (${m.error})`); return; }
      members.set(key, m.rec);
    }
    let value = parseNum(r.value);
    if (r.unit === 'g' && r.metric === 'weight') value /= 1000;
    if (r.unit === 'm' && r.metric === 'height') value *= 100;
    const m = measureRecord({ member: key, metric: r.metric, value, date: r.recorded_on });
    if (!m.ok) { skipped.push(`linha ${i + 2}: medida inválida (${m.error})`); return; }
    measures.set(m.rec.id, m.rec);
  });
  return { members: [...members.values()], measures: [...measures.values()], skipped };
}

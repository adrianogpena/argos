// node test/health-exams.test.mjs  (dados fictícios)
import assert from 'node:assert/strict';
import { TESTS, resultRecord, examRecord, status, testSeries, refOf, shown, overview, resultId, examId } from '../lib/health-exams.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const R = (o = {}) => resultRecord({ member: 'm1', test: 'hba1c', date: '2026-01-01', value: '5,5', ...o });

t('resultRecord validates, accepts comma, builds a stable id', () => {
  const r = R(); assert.ok(r.ok); assert.equal(r.rec.value, 5.5); assert.equal(r.rec.id, resultId('m1', 'hba1c', '2026-01-01')); assert.equal(r.rec.unit, '%');
  assert.equal(R({ test: 'nada' }).error, 'test'); assert.equal(R({ member: '' }).error, 'member'); assert.equal(R({ date: 'hoje' }).error, 'date');
  assert.equal(R({ value: '' }).error, 'value'); assert.equal(R({ value: 'abc' }).error, 'value'); assert.equal(R({ flag: 'x' }).error, 'flag');
  assert.equal(R({ value: '', text: 'Negativo' }).ok, true); assert.equal(R({ cmp: '<' }).rec.cmp, '<'); assert.equal(R({ cmp: '=' }).rec.cmp, undefined);
});
t('status: exclusive "<" limit, inclusive range, qualitative flag, no range', () => {
  assert.equal(status(R({ value: 5.7, high: 5.7, highExcl: true }).rec), 'high');
  assert.equal(status(R({ value: 5.6, high: 5.7, highExcl: true }).rec), 'ok');
  assert.equal(status(R({ value: 25, low: 3, high: 25 }).rec), 'ok');
  assert.equal(status(R({ value: 25.1, low: 3, high: 25 }).rec), 'high'); assert.equal(status(R({ value: 2.9, low: 3, high: 25 }).rec), 'low');
  assert.equal(status(R({ value: '', text: 'Negativo', flag: 'ok' }).rec), 'ok');
  assert.equal(status(R({ value: 7 }).rec), null); assert.equal(status(R({ value: 0.3, cmp: '<', high: 1 }).rec), null); assert.equal(status(null), null);
});
t('series sorts by date and isolates member and test; refOf takes the newest printed range', () => {
  const rs = [R({ date: '2026-03-01', value: 5.7, high: 5.7, highExcl: true }).rec, R({ date: '2025-01-01', value: 7 }).rec, R({ member: 'm2', value: 9 }).rec, R({ test: 'gme', value: 120 }).rec];
  const s = testSeries(rs, 'm1', 'hba1c'); assert.deepEqual(s.map(x => x.value), [7, 5.7]); assert.equal(refOf(s).high, 5.7); assert.equal(refOf([s[0]]), null);
});
t('shown prints comparator, locale decimals, qualitative text', () => {
  assert.equal(shown(R({ value: 17.1, test: 'insulin' }).rec), '17,1'); assert.equal(shown(R({ value: 0.3, cmp: '<', test: 'albu' }).rec), '<0,3');
  assert.equal(shown(R({ value: '', text: 'Negativo', test: 'ica' }).rec), 'Negativo');
});
t('overview: one row per test in catalogue order, change, status from the newest printed range', () => {
  const rs = [R({ date: '2026-11-14', value: 5.7, high: 5.7, highExcl: true, refText: '<5.7' }).rec, R({ date: '2026-01-10', value: 7.1 }).rec, R({ test: 'acr', date: '2026-11-14', value: 2.3 }).rec, R({ test: 'acr', date: '2024-08-31', value: 2.5, cmp: '<' }).rec];
  const o = overview(rs, 'm1'); assert.deepEqual(o.map(x => x.test), ['hba1c', 'acr']);
  assert.equal(o[0].change, -1.4); assert.equal(o[0].status, 'high'); assert.equal(o[0].count, 2);
  assert.equal(o[1].change, null); assert.equal(o[1].status, null);
  assert.deepEqual(overview(rs, 'm9'), []);
  const old = [R({ date: '2025-01-01', value: 5, high: 5.7, highExcl: true }).rec, R({ date: '2026-01-01', value: 5.4 }).rec];
  assert.equal(overview(old, 'm1')[0].status, 'ok');
});
t('examRecord validates and builds the id from member, date and episode', () => {
  const e = examRecord({ member: 'm1', date: '2026-11-14', issued: '2026-11-24', episode: '12-34', lab: 'Lab' });
  assert.ok(e.ok); assert.equal(e.rec.id, examId('m1', '2026-11-14', '12-34')); assert.equal(e.rec.id, 'x-20261114-1234-m1');
  assert.equal(examRecord({ member: '', date: '2026-11-14' }).error, 'member'); assert.equal(examRecord({ member: 'm1', date: 'x' }).error, 'date'); assert.equal(examRecord({ member: 'm1', date: '2026-11-14', issued: 'x' }).error, 'issued');
});
t('every test has a unit field, a section and plain-language texts', () => {
  for (const [k, d] of Object.entries(TESTS)) { assert.ok(d.name && d.section && d.what && d.read && 'unit' in d, k); }
});
console.log(`${n} grupos ok`);

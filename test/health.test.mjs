// node test/health.test.mjs  (dados fictícios)
import assert from 'node:assert/strict';
import { memberRecord, measureRecord, series, latest, age, ageText, fromRows } from '../lib/health-core.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('memberRecord validates and defaults', () => {
  assert.equal(memberRecord({ id: 'a', name: ' ' }).error, 'name');
  assert.equal(memberRecord({ id: 'a', name: 'Teste', birth: 'ontem' }).error, 'birth');
  const r = memberRecord({ id: 'a', name: 'Bolinha', kind: 'pet', birth: '2024-01-31' });
  assert.ok(r.ok); assert.equal(r.rec.kind, 'pet'); assert.equal(memberRecord({ id: 'b', name: 'X', kind: '??' }).rec.kind, 'human');
});
t('measureRecord accepts comma, rounds, builds a stable id, rejects nonsense', () => {
  const r = measureRecord({ member: 'm1', metric: 'weight', value: '4,6', date: '2026-01-02' });
  assert.ok(r.ok); assert.equal(r.rec.value, 4.6); assert.equal(r.rec.id, 'm1-weight-2026-01-02');
  assert.equal(measureRecord({ member: 'm1', metric: 'weight', value: '0', date: '2026-01-02' }).error, 'value');
  assert.equal(measureRecord({ member: 'm1', metric: 'height', value: '900', date: '2026-01-02' }).error, 'value');
  assert.equal(measureRecord({ member: 'm1', metric: 'mood', value: '1', date: '2026-01-02' }).error, 'metric');
  assert.equal(measureRecord({ member: '', metric: 'weight', value: '1', date: '2026-01-02' }).error, 'member');
  assert.equal(measureRecord({ member: 'm1', metric: 'weight', value: '1', date: 'hoje' }).error, 'date');
});
t('series isolates member and metric and sorts by date', () => {
  const ms = [
    { member: 'a', metric: 'weight', value: 3, date: '2026-03-01' }, { member: 'a', metric: 'weight', value: 2, date: '2026-01-01' },
    { member: 'b', metric: 'weight', value: 99, date: '2026-02-01' }, { member: 'a', metric: 'height', value: 50, date: '2026-02-01' }];
  assert.deepEqual(series(ms, 'a', 'weight').map(x => x.value), [2, 3]);
});
t('latest gives value, change and the date compared; null when empty', () => {
  const ms = [{ member: 'a', metric: 'weight', value: 2.1, date: '2026-01-01' }, { member: 'a', metric: 'weight', value: 2.4, date: '2026-02-01' }];
  assert.deepEqual(latest(ms, 'a', 'weight'), { value: 2.4, date: '2026-02-01', change: 0.3, since: '2026-01-01' });
  assert.equal(latest(ms.slice(0, 1), 'a', 'weight').change, null);
  assert.equal(latest(ms, 'a', 'height'), null);
});
t('age handles month and year boundaries', () => {
  assert.deepEqual(age('2020-03-10', '2026-03-09'), { years: 5, months: 11, total: 71 });
  assert.equal(age('2020-03-10', '2026-03-10').years, 6);
  assert.equal(age('2030-01-01', '2026-01-01'), null); assert.equal(age('', '2026-01-01'), null);
  assert.equal(ageText('2026-01-15', '2026-03-20'), '2 meses');
  assert.equal(ageText('2024-01-10', '2026-03-20'), '2 anos e 2 meses');
  assert.equal(ageText('2025-03-20', '2026-03-20'), '1 ano');
});
t('fromRows builds members and measures, dedups by day, converts units, reports skips', () => {
  const rows = [
    { name: 'Ana Exemplo', kind: 'human', birth_date: '1990-01-01', metric: 'weight', value: '60', unit: 'kg', recorded_on: '2026-01-01' },
    { name: 'Ana Exemplo', kind: 'human', birth_date: '1990-01-01', metric: 'height', value: '1.65', unit: 'm', recorded_on: '2026-01-01' },
    { name: 'Ana Exemplo', kind: 'human', birth_date: '1990-01-01', metric: 'weight', value: '61', unit: 'kg', recorded_on: '2026-01-01' },
    { name: 'Totó', kind: 'pet', birth_date: '2025-05-05', metric: 'weight', value: '500', unit: 'g', recorded_on: '2026-01-02' },
    { name: '', kind: 'pet', birth_date: '', metric: 'weight', value: '1', unit: 'kg', recorded_on: '2026-01-02' },
    { name: 'Totó', kind: 'pet', birth_date: '2025-05-05', metric: 'weight', value: '-1', unit: 'kg', recorded_on: '2026-01-03' }];
  const out = fromRows(rows);
  assert.equal(out.members.length, 2); assert.equal(out.members[1].id, 'toto-2025-05-05');
  assert.equal(out.measures.length, 3); assert.equal(out.skipped.length, 2);
  assert.equal(out.measures.find(m => m.metric === 'height').value, 165);
  assert.equal(out.measures.find(m => m.member === 'toto-2025-05-05').value, 0.5);
  assert.equal(out.measures.find(m => m.id === 'ana-exemplo-1990-01-01-weight-2026-01-01').value, 61);
  assert.deepEqual(fromRows(rows).measures.map(m => m.id), out.measures.map(m => m.id));   // idempotent
});
console.log(`${n} grupos ok`);

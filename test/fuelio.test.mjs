// node test/fuelio.test.mjs  (dados fictícios)
import assert from 'node:assert/strict';
import { parseCsv, convert } from '../lib/fuelio.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

const CSV = `"## Vehicle"
"Name","Make","Model","Year"
"Teste","Marca ","Modelo","2010"
"## Log"
"Data","Odo (km)","Fuel (litres)","Full","Price (optional)","City (optional)","Notes (optional)","Missed","UniqueId"
"2026-01-10 08:00","1000.0","40.0","1","70.0","Posto Exemplo, Centro","","0","1"
"2026-01-20 08:00","1400.0","20.0","0","36.0","","com ""aspas""","0","2"
"2026-02-01 08:00","1800.0","30.0","1","54.0","","","1","3"
"2026-02-02 08:00","1900.0","0.0","1","0","","","0","4"
"## CostCategories"
"CostTypeID","Name"
"2","Maintenance"
"## Costs"
"CostTitle","Date","Odo","CostTypeID","Notes","Cost","RemindOdo","RemindDate","isTemplate","UniqueId"
"Oil Change","2026-01-05 10:00","0","2","","80.0","11000","2026-12-01","0","1"
"","2026-01-06 10:00","0","2","","0.0","0","","0","2"
"Modelo","2026-01-07 10:00","0","2","","0.0","0","","1","3"
`;

t('parseCsv handles quotes, commas and escaped quotes', () => {
  const r = parseCsv('"a","b,c","d ""x"""\n"1","2","3"\n');
  assert.deepEqual(r, [['a', 'b,c', 'd "x"'], ['1', '2', '3']]);
});
t('convert: fuel records, stable ids, partial and missed fills', () => {
  const c = convert(CSV);
  assert.equal(c.fuel.length, 3); assert.equal(c.skipped.length, 1);
  assert.equal(c.fuel[0].id, 'fu-f1'); assert.equal(c.fuel[0].date, '2026-01-10'); assert.equal(c.fuel[0].station, 'Posto Exemplo, Centro');
  assert.equal(c.fuel[0].full, true); assert.equal(c.fuel[1].full, false); assert.equal(c.fuel[1].note, 'com "aspas"');
  assert.equal(c.fuel[2].full, false);                   // missed fill-up is not trusted as a full tank
  assert.equal(c.vehicle.make, 'Marca');
});
t('convert: costs become services; template rows are ignored; reminders kept', () => {
  const c = convert(CSV);
  assert.equal(c.service.length, 2);
  assert.equal(c.service[0].kind, 'Oil Change'); assert.equal(c.service[0].nextKm, 11000); assert.equal(c.service[0].nextDate, '2026-12-01');
  assert.equal(c.service[1].kind, 'Maintenance');        // empty title falls back to the category name
  assert.ok(!('nextKm' in c.service[1]));
});
t('ids are valid for the vault', () => {
  for (const r of [...convert(CSV).fuel, ...convert(CSV).service]) assert.match(r.id, /^[A-Za-z0-9_-]{1,40}$/);
});
console.log(n + ' tests passed');

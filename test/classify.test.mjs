// node test/classify.test.mjs  (dados fictícios)
import assert from 'node:assert/strict';
import { descKey, bankId, buildRecords, UNCAT } from '../lib/classify.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('descKey ignora números, datas e palavras de banco', () => {
  assert.equal(descKey('COMPRA 1234 Loja Exemplo Lda 05-03'), 'loja-exemplo');
  assert.equal(descKey('Compra Loja Exemplo 9999'), descKey('COMPRA 1234 Loja Exemplo Lda'));
  assert.equal(descKey('123 456'), 'sem-descricao');
});
t('bankId: estável, e idênticos no mesmo dia ganham ids distintos', () => {
  assert.equal(bankId('2026-03-05', 23.4, 'LOJA  EXEMPLO'), bankId('2026-03-05', 23.4, 'loja exemplo'));
  const seen = new Map();
  assert.notEqual(bankId('2026-03-05', 23.4, 'X', seen), bankId('2026-03-05', 23.4, 'X', seen));
  assert.match(bankId('2026-03-05', 1, 'X'), /^[A-Za-z0-9_-]{1,40}$/);
});
const E = [
  { date: '2026-03-05', amount: 23.4, desc: 'COMPRA LOJA EXEMPLO 1234', category: 'Mercado', need: 'essential' },
  { date: '2026-03-05', amount: 23.4, desc: 'COMPRA LOJA EXEMPLO 1234', category: 'Mercado', need: 'essential' },
  { date: '2026-03-07', amount: 650, desc: 'PAG RENDA MARCO', category: 'Moradia', need: 'essential' },
  { date: '2026-03-08', amount: 5, desc: 'Praça Exemplo Quiosque' },
];
t('buildRecords: campos, auto marca o palpite, sem categoria vira UNCAT', () => {
  const p = buildRecords(E);
  assert.equal(p.records.length, 4); assert.equal(new Set(p.records.map(r => r.id)).size, 4);
  assert.deepEqual(p.records[2], { id: p.records[2].id, date: '2026-03-07', amount: 650, category: 'Moradia', note: 'PAG RENDA MARCO', need: 'essential', source: 'bank', auto: true, key: 'renda-marco' });
  assert.deepEqual([p.records[3].category, p.records[3].need], [UNCAT, '']);
});
t('buildRecords: reimportar não duplica nem sobrescreve; mês parcial reaproveita ids', () => {
  const ids = new Set(buildRecords(E.slice(0, 2)).records.map(r => r.id));
  const p = buildRecords(E, ids); assert.equal(p.duplicates, 2); assert.equal(p.records.length, 2);
});
t('buildRecords: regra aprendida vence o palpite e não é "auto"', () => {
  const learned = new Map([['loja-exemplo', { category: 'Casa', need: 'flexible' }]]);
  const p = buildRecords(E, new Set(), learned);
  assert.deepEqual([p.records[0].category, p.records[0].need, p.records[0].auto], ['Casa', 'flexible', false]);
});
t('buildRecords: entrada inválida (valor negativo, sem data) vira erro, não registro', () => {
  const p = buildRecords([{ date: '05/03', amount: 1, desc: 'x' }, { date: '2026-03-05', amount: -3, desc: 'x' }]);
  assert.equal(p.records.length, 0); assert.equal(p.errors.length, 2);
});
t('buildRecords: regra skip descarta o lançamento ("não é gasto") e conta', () => {
  const learned = new Map([['loja-exemplo', { skip: true }]]);
  const p = buildRecords(E, new Set(), learned);
  assert.equal(p.skipped, 2); assert.equal(p.records.length, 2);
  assert.ok(p.records.every(r => r.key !== 'loja-exemplo'));
});
console.log(`\n${n} passed`);

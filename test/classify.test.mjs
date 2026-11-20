// node test/classify.test.mjs  (dados fictícios)
import assert from 'node:assert/strict';
import { descKey, classify, planImport, UNCAT } from '../lib/classify.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('descKey ignora números, datas e palavras de banco', () => {
  assert.equal(descKey('COMPRA 1234 Loja Exemplo Lda 05-03'), 'loja-exemplo');
  assert.equal(descKey('Compra Loja Exemplo 9999'), descKey('COMPRA 1234 Loja Exemplo Lda'));
  assert.equal(descKey('123 456'), 'sem-descricao');
});
t('regras embutidas: categoria e tipo, sem acento e sem caixa', () => {
  assert.deepEqual(classify('PAG RENDA MARÇO'), { category: 'Moradia', need: 'essential', source: 'rule' });
  assert.equal(classify('EDP Comercial 123').category, 'Contas');
  assert.deepEqual([classify('Netflix.com').category, classify('Netflix.com').need], ['Assinaturas', 'flexible']);
  assert.equal(classify('GALP POWER Casa').category, 'Contas');
});
t('sem palpite: Sem categoria, tipo vazio', () => {
  assert.deepEqual(classify('Praça Exemplo Quiosque'), { category: UNCAT, need: '', source: 'none' });
});
t('regra aprendida vale mais que a embutida', () => {
  const learned = new Map([['continente-modelo', { category: 'Casa', need: 'flexible' }]]);
  assert.deepEqual(classify('Continente Modelo 1', learned), { category: 'Casa', need: 'flexible', source: 'learned' });
});
const ROWS = [
  { date: '2026-03-05', amount: -23.4, desc: 'COMPRA LOJA EXEMPLO 1234' },
  { date: '2026-03-05', amount: -23.4, desc: 'COMPRA LOJA EXEMPLO 1234' },   // idêntico no mesmo dia: é outro lançamento
  { date: '2026-03-06', amount: 1500, desc: 'SALARIO EMPRESA X' },
  { date: '2026-03-07', amount: -650, desc: 'PAG RENDA MARCO' },
];
t('planImport: só saídas, ids distintos para idênticos, auto marca o palpite', () => {
  const p = planImport(ROWS);
  assert.equal(p.records.length, 3); assert.equal(p.income, 1);
  assert.equal(new Set(p.records.map(r => r.id)).size, 3);
  assert.ok(p.records.every(r => /^[A-Za-z0-9_-]{1,40}$/.test(r.id)));
  assert.deepEqual(p.records[2], { id: p.records[2].id, date: '2026-03-07', amount: 650, category: 'Moradia', note: 'PAG RENDA MARCO', need: 'essential', source: 'bank', auto: true, key: 'renda-marco' });
  assert.equal(p.records[0].category, UNCAT);
});
t('planImport: reimportar não duplica nem sobrescreve; regra aprendida não é "auto"', () => {
  const first = planImport(ROWS).records, ids = new Set(first.map(r => r.id));
  const again = planImport(ROWS, ids); assert.equal(again.records.length, 0); assert.equal(again.duplicates, 3);
  const learned = new Map([['loja-exemplo', { category: 'Mercado', need: 'essential' }]]);
  const p = planImport(ROWS, new Set(), learned);
  assert.deepEqual([p.records[0].category, p.records[0].auto], ['Mercado', false]);
});
t('planImport: mês parcial importado depois reaproveita os ids dos dias já importados', () => {
  const ids = new Set(planImport(ROWS.slice(0, 2)).records.map(r => r.id));
  const p = planImport(ROWS, ids); assert.equal(p.duplicates, 2); assert.equal(p.records.length, 1);
});
console.log(`\n${n} passed`);

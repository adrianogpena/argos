// node test/classify.test.mjs  (dados fictícios)
import assert from 'node:assert/strict';
import { descKey, bankId, buildRecords, pendingGroups, applyDecisions, applyLabels, merchantGroups, UNCAT } from '../lib/classify.js';
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
const X = (id, key, amount, o = {}) => ({ id, date: '2026-03-0' + id.slice(-1), amount, category: 'Compras', need: 'flexible', note: 'COMPRA ' + key, source: 'bank', auto: true, key, ...o });
const EXP = [X('a1', 'loja-a', 10), X('a2', 'loja-a', 5), X('b3', 'loja-b', 7, { category: UNCAT, need: '' }), X('c4', 'loja-c', 3, { auto: undefined }), X('d5', 'trf', 1, { note: 'TRF MB WAY P/ *****1' })];
t('pendingGroups: só pendentes, agrupados por chave, maiores primeiro', () => {
  const g = pendingGroups(EXP);
  assert.deepEqual(g.map(x => [x.key, x.n, x.total]), [['loja-a', 2, 15], ['trf', 1, 1], ['loja-b', 1, 7]].sort((a, b) => b[2] - a[2]));
});
t('applyDecisions: confirm vira regra e tira auto; dúvida mantém auto e não cria regra', () => {
  const r = applyDecisions(EXP, [{ key: 'loja-a', category: 'Mercado', need: 'essential', confirm: true }, { key: 'loja-b', category: 'Lazer', confirm: false }]);
  assert.equal(r.confirmed, 2); assert.equal(r.doubtful, 1); assert.deepEqual(r.errors, []);
  assert.ok(r.updates.filter(u => u.key === 'loja-a').every(u => u.category === 'Mercado' && u.need === 'essential' && !('auto' in u)));
  const b = r.updates.find(u => u.key === 'loja-b'); assert.deepEqual([b.category, b.need, b.auto], ['Lazer', '', true]);
  assert.deepEqual(r.rules.map(x => [x.id, x.category, x.need]), [['loja-a', 'Mercado', 'essential']]);
});
t('applyDecisions: não toca no confirmado pelo dono, recusa chave genérica, categoria vazia ou sem pendentes', () => {
  const r = applyDecisions(EXP, [{ key: 'loja-c', category: 'X', confirm: true }, { key: 'trf', category: 'X', confirm: true }, { key: 'loja-a', category: '', confirm: true }, { key: 'loja-b', category: UNCAT, confirm: true }]);
  assert.equal(r.updates.length, 0); assert.equal(r.errors.length, 4);
});
t('applyDecisions: canon normaliza a grafia da categoria', () => {
  const r = applyDecisions(EXP, [{ key: 'loja-a', category: 'mercado', confirm: true }], c => c === 'mercado' ? 'Mercado' : c);
  assert.equal(r.updates[0].category, 'Mercado');
});
t('rótulo: palpite entra no registro, regra.tag vence, applyDecisions grava rótulo e tag da regra', () => {
  const e = [{ date: '2026-03-05', amount: 10, desc: 'Posto Exemplo 1', category: 'Transporte', need: 'essential', label: 'Combustível' }];
  assert.equal(buildRecords(e).records[0].label, 'Combustível');
  assert.equal(buildRecords(e, new Set(), new Map([['posto-exemplo', { category: 'Transporte', need: 'essential', tag: 'Gasolina' }]])).records[0].label, 'Gasolina');
  assert.equal('label' in buildRecords([{ ...e[0], label: undefined }]).records[0], false);
  const exp = buildRecords(e).records;
  const r = applyDecisions(exp, [{ key: 'posto-exemplo', category: 'Transporte', label: 'Combustível', confirm: true }]);
  assert.equal(r.updates[0].label, 'Combustível'); assert.equal(r.rules[0].tag, 'Combustível');
});
t('applyLabels: rotula por chave ou por id, atualiza tag da regra, não confirma palpite nem cria regra de palpite', () => {
  const ex = [
    { id: 'a1', date: '2026-03-01', amount: 5, category: 'Mercado', note: 'Loja A 1', key: 'loja-a', need: 'essential' },
    { id: 'a2', date: '2026-03-02', amount: 6, category: 'Mercado', note: 'Loja A 2', key: 'loja-a', need: 'essential', label: 'velho' },
    { id: 'p1', date: '2026-03-03', amount: 7, category: 'Lazer', note: 'Cinema P', key: 'cinema-p', need: 'flexible', auto: true },
    { id: 't1', date: '2026-03-04', amount: 8, category: 'Outros', note: 'TRF x', key: 'trf' }];
  const r = applyLabels(ex, [{ key: 'loja-a', label: 'Supermercado' }, { key: 'cinema-p', label: 'Cinema' }, { id: 't1', key: 'trf', label: 'Presente' }, { key: 'zzz', label: 'x' }, { key: 'loja-a' }], new Map());
  assert.equal(r.labeled, 4); assert.equal(r.errors.length, 2);
  assert.ok(r.updates.filter(u => u.key === 'loja-a').every(u => u.label === 'Supermercado'));
  assert.equal(r.updates.find(u => u.id === 'p1').auto, true);
  assert.deepEqual(r.rules.map(x => [x.id, x.tag]), [['loja-a', 'Supermercado']]);   // palpite (auto) e chave genérica não viram regra
  const r2 = applyLabels(ex, [{ key: 'loja-a', label: '' }], new Map([['loja-a', { id: 'loja-a', category: 'Mercado', tag: 'velho' }]]));
  assert.equal('label' in r2.updates[1], false); assert.equal('tag' in r2.rules[0], false);
  assert.equal(merchantGroups(ex).find(g => g.key === 'loja-a').n, 2);
});
console.log(`\n${n} passed`);

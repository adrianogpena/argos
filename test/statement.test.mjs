// node test/statement.test.mjs  (dados fictícios)
import assert from 'node:assert/strict';
import { parseCSV, parseAmount, parseDate, parseStatement, decodeText } from '../lib/statement.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('parseAmount: formatos europeus e sinais', () => {
  assert.equal(parseAmount('1.234,56'), 1234.56); assert.equal(parseAmount('-12,50'), -12.5); assert.equal(parseAmount('(12,50)'), -12.5);
  assert.equal(parseAmount('12,50-'), -12.5); assert.equal(parseAmount('€ 3.5'), 3.5); assert.equal(parseAmount('1,234.50'), 1234.5);
  assert.equal(parseAmount('1.234'), 1234); assert.equal(parseAmount('-0,99 EUR'), -0.99);
  assert.ok(Number.isNaN(parseAmount(''))); assert.ok(Number.isNaN(parseAmount('abc')));
});
t('parseDate: formatos comuns e datas impossíveis', () => {
  assert.equal(parseDate('03-05-2026'), '2026-05-03'); assert.equal(parseDate('3/5/2026'), '2026-05-03'); assert.equal(parseDate('03.05.26'), '2026-05-03');
  assert.equal(parseDate('2026-05-03 10:20'), '2026-05-03'); assert.equal(parseDate('31-02-2026'), null); assert.equal(parseDate('Total'), null);
});
t('parseCSV: aspas, ponto e vírgula dentro do texto, quebras CRLF, BOM', () => {
  const r = parseCSV('﻿a;b;c\r\n"x;y";"he said ""hi""";3\r\n\r\n');
  assert.deepEqual(r, [['a', 'b', 'c'], ['x;y', 'he said "hi"', '3']]);
});
const BANCO = [
  'Extrato da conta; ; ;', 'Titular: Fulano Exemplo;;;', '',
  'Data mov.;Data valor;Descrição;Montante;Saldo',
  '05-03-2026;05-03-2026;COMPRA LOJA EXEMPLO 1234;-23,40;1.000,00',
  '06-03-2026;06-03-2026;SALARIO EMPRESA X;1.500,00;2.500,00',
  '07-03-2026;07-03-2026;PAG RENDA MARCO;-650,00;1.850,00',
  'Total;;;;',
].join('\n');
t('extrato com texto antes do cabeçalho: acha as colunas, ignora rodapé', () => {
  const r = parseStatement(BANCO);
  assert.equal(r.error, null); assert.equal(r.rows.length, 3); assert.equal(r.skipped, 1);
  assert.deepEqual(r.rows[0], { date: '2026-03-05', amount: -23.4, desc: 'COMPRA LOJA EXEMPLO 1234' });
  assert.equal(r.rows[1].amount, 1500);
});
t('colunas de débito e crédito separadas', () => {
  const r = parseStatement('Data;Descritivo;Débito;Crédito\n01/04/2026;Loja A;10,00;\n02/04/2026;Estorno;;4,00');
  assert.deepEqual(r.rows.map(x => x.amount), [-10, 4]);
});
t('sem cabeçalho reconhecível: erro "columns"; com override funciona, inclusive invertendo o sinal', () => {
  const csv = 'A;B;C\n01/04/2026;Loja A;10,00\n02/04/2026;Loja B;5,00';
  const r = parseStatement(csv); assert.equal(r.error, 'columns'); assert.deepEqual(r.headers, ['A', 'B', 'C']);
  const o = parseStatement(csv, { headerIndex: 0, date: 0, desc: 1, amount: 2, invert: true });
  assert.deepEqual(o.rows.map(x => x.amount), [-10, -5]);
});
t('decodeText cai para Windows-1252 quando não é UTF-8', () => {
  assert.equal(decodeText(new Uint8Array([0x43, 0x61, 0x66, 0xe9])), 'Café'); assert.equal(decodeText(new TextEncoder().encode('Café')), 'Café');
});
console.log(`\n${n} passed`);

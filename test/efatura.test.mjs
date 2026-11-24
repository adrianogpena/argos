import assert from 'node:assert/strict';
import { parseMoney, parseRow, isVoid, matchInvoices, merchantSuggestions, invoiceRecord, merchantRecords, nextBatches, recordBatch } from '../lib/efatura.js';

assert.equal(parseMoney('1.234,50 €'.replace('.', '')), 1234.5);
assert.equal(parseMoney('127,23 €'), 127.23);

const row = ['Saúde', '500000001 - Farmácia Exemplo, Lda', 'FR A1/55 / ABCD1234-55', 'Fatura-recibo', '2026-03-10', '12,50 €', '2,34 €', '10,16 €', 'Registado', 'X', ''];
const inv = parseRow(row);
assert.deepEqual(inv, { id: '500000001-ABCD1234-55', nif: '500000001', name: 'Farmácia Exemplo, Lda', setor: 'Saúde', num: 'FR A1/55', atcud: 'ABCD1234-55', tipo: 'Fatura-recibo', date: '2026-03-10', total: 12.5, vat: 2.34, base: 10.16, sit: 'Registado' });
const old = parseRow([...row.slice(0, 2), 'FS 203/703440', ...row.slice(3)]);
assert.deepEqual([old.id, old.atcud, old.num], ['500000001-FS_203_703440', '', 'FS 203/703440']);
assert.equal(parseRow(['x']), null);
assert.equal(parseRow([...row.slice(0, 1), 'sem nif', ...row.slice(2)]), null);
assert.equal(isVoid({ ...inv, sit: 'Documento Anulado pelo Emitente' }), true);
assert.equal(isVoid({ ...inv, tipo: 'Nota de crédito' }), true);
assert.equal(isVoid(inv), false);

const mk = (n, date, total, name = 'Mercearia Exemplo, Lda', nif = '500000002') => parseRow(['', `${nif} - ${name}`, `FS 1/${n} / ZZ-${n}`, 'Fatura simplificada', date, String(total).replace('.', ',') + ' €', '0,00 €', '0,00 €', 'Registado']);
const invs = [mk(1, '2026-03-01', 10), mk(2, '2026-03-02', 20), mk(3, '2026-03-20', 30.5), mk(4, '2026-04-01', 7.77)];
const exps = [
  { id: 'a', date: '2026-03-02', amount: 10, category: 'Mercado', label: 'Supermercado', note: 'COMPRA 5061 MERCEARIA EXEMPLO' },
  { id: 'b', date: '2026-03-03', amount: 20, category: 'Mercado', label: 'Supermercado', note: 'COMPRA 5061 MERCEARIA EXEMPLO' },
  { id: 'c', date: '2026-04-10', amount: 30.5, category: 'Mercado', label: 'Supermercado', note: 'DD MERCEARIA EXEMPLO 123' },
  { id: 'd', date: '2026-04-20', amount: 7.77, category: 'Transporte', label: 'Táxi', note: 'COMPRA 5061 UBER TRIP' },
];
const link = matchInvoices(invs, exps);
assert.equal(link.get(invs[0].id).xid, 'a');
assert.equal(link.get(invs[1].id).xid, 'b');
assert.equal(link.get(invs[2].id).tag, 'wide');
assert.equal(link.has(invs[3].id), false);

assert.equal(matchInvoices([{ ...invs[0], sit: 'Documento Anulado pelo Emitente' }], exps).size, 0);

const sug = merchantSuggestions(invs, link, exps);
assert.equal(sug.length, 1);
assert.deepEqual({ nif: sug[0].nif, lk: sug[0].lk, n: sug[0].n, category: sug[0].category, label: sug[0].label, conf: sug[0].conf }, { nif: '500000002', lk: 3, n: 4, category: 'Mercado', label: 'Supermercado', conf: 'alta' });
assert.deepEqual(merchantRecords(sug, []), [{ id: '500000002', name: 'Mercearia Exemplo, Lda', category: 'Mercado' }]);
assert.deepEqual(merchantRecords(sug, ['500000002']), []);
assert.deepEqual(merchantRecords([{ ...sug[0], generic: true }], []), []);

assert.equal(invoiceRecord(invs[0], link.get(invs[0].id)).expenseId, 'a');
assert.equal('expenseId' in invoiceRecord(invs[3], undefined), false);

const plan = { 'qr-merchants': [{ id: 'm1' }, { id: 'm2' }], efatura: Array.from({ length: 10 }, (_, i) => ({ id: 'f' + i })) };
let state = {};
let b = nextBatches(plan, state, '2026-11-25', 5, 3);
assert.deepEqual(b.map(x => [x.collection, x.items.length]), [['qr-merchants', 2], ['efatura', 3]]);
for (const x of b) state = recordBatch(state, '2026-11-25', x.collection, x.items);
assert.equal(state.days['2026-11-25'], 5);
assert.deepEqual(nextBatches(plan, state, '2026-11-25', 5, 3), []);
b = nextBatches(plan, state, '2026-11-26', 5, 3);
assert.deepEqual(b.map(x => [x.collection, x.items.map(y => y.id).join()]), [['efatura', 'f3,f4,f5'], ['efatura', 'f6,f7']]);

console.log('efatura: ok');

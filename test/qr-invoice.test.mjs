import assert from 'node:assert/strict';
import { parseQr, QrError } from '../lib/qr-invoice.js';

const normal = 'A:500000000*B:123456789*C:PT*D:FT*E:N*F:20260115*G:FT 2026A/123*H:ABCD1234-123*I1:0.00*I7:10.00*I8:2.30*N:2.30*O:12.30*Q:AbCd*R:1234';
const multi = 'A:500000000*B:123456789*C:PT*D:FS*E:N*F:20261231*G:FS 1/9*H:XYZ-9*I1:5.00*I3:10.00*I4:0.60*I5:20.00*I6:1.20*I7:30.00*I8:6.90*N:8.70*O:73.70*Q:Zz9x*R:99';
const consumer = 'A:500000000*B:999999990*C:PT*D:FR*E:N*F:20260301*G:FR 1/2*H:0-2*N:0*O:5.50*Q:abcd*R:1';

let rec = parseQr(normal);
assert.deepEqual({ ...rec, raw: undefined }, { id: '500000000-ABCD1234-123', nif: '500000000', date: '2026-01-15', type: 'FT', number: 'FT 2026A/123', atcud: 'ABCD1234-123', totalNet: 10, totalVat: 2.3, total: 12.3, raw: undefined });
assert.equal(rec.raw, normal);

rec = parseQr(multi);
assert.equal(rec.total, 73.7); assert.equal(rec.totalVat, 8.7); assert.equal(rec.totalNet, 65); assert.equal(rec.date, '2026-12-31');

rec = parseQr(consumer);
assert.equal(rec.total, 5.5); assert.equal(rec.totalNet, 5.5); assert.equal(rec.type, 'FR');

rec = parseQr('A:500000000*F:20260115*G:X 1*H:Z-1*O:3.00');
assert.equal(rec.totalVat, null); assert.equal(rec.totalNet, null); assert.equal(rec.type, null);

const bad = (s, re) => assert.throws(() => parseQr(s), e => e instanceof QrError && re.test(e.message));
bad('', /vazio/);
bad('https://exemplo.pt/x', /Campo desconhecido/);
bad('texto solto', /Não é um QR/);
bad(normal + '*Z:1', /desconhecido/);
bad(normal.replace('*H:ABCD1234-123', ''), /obrigatório H/);
bad(normal.replace('O:12.30', 'O:12,30'), /inválido em O/);
bad(normal.replace('F:20260115', 'F:20260230'), /Data inválida/);
bad(normal.replace('A:500000000', 'A:5000'), /NIF/);
bad(normal + '*A:500000000', /repetido/);
console.log('qr-invoice: ok');

const { linkQr } = await import('../lib/qr-invoice.js');
const q = (id, date, total, extra = {}) => ({ id, date, total, ...extra });
const ex = (id, date, amount) => ({ id, date, amount, category: 'Mercado' });
let m = linkQr([q('a', '2026-01-10', 12.3), q('b', '2026-01-10', 12.3)], [ex('e1', '2026-01-12', 12.3), ex('e2', '2026-01-20', 12.3)]);
assert.equal(m.get('a').id, 'e1'); assert.equal(m.has('b'), false);
m = linkQr([q('a', '2026-01-10', 12.3, { expenseId: 'e1' }), q('b', '2026-01-10', 12.3)], [ex('e1', '2026-01-10', 12.3), ex('e3', '2026-01-11', 12.3)]);
assert.equal(m.get('a').id, 'e1'); assert.equal(m.get('b').id, 'e3');
m = linkQr([q('a', '2026-01-10', 12.3)], [ex('e1', '2026-01-10', 12.3)], ['e1']);
assert.equal(m.size, 0);
console.log('linkQr: ok');

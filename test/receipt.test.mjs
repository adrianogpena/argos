// node test/receipt.test.mjs  (faturas e valores fictícios)
import assert from 'node:assert/strict';
import { parseReceipt, receiptRecords, categorize, linkExpenses, summarize, priceVolume, productKey, UNCAT } from '../lib/receipt.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

const PINGO = `EXEMPLO
Artigos
MERCEARIA + PET FOOD
E ARROZ EXEMPLO 1KG 1,50
Poupança Imediata (0,30)
LEITE
C LT UHT EXEMPLO PD 6 5,40
TALHO
C FRANGO EXEMPLO PD 0,500 X 6,00 3,00
PADARIA/PASTELARIA
E PÃO DE QUEIJO UN 3 X 0,30 0,90
BEBIDAS
E ºCOLA ZERO LATA 33 0,90
DEPÓSITO VOLTA
I ºVALOR DEPÓSITO 0,10
------------------------------------------------
ºTotal Depósito Volta = 0,10
------------------------------------------------
Resumo
TOTAL 11,80
TOTAL POUPANÇA (0,30)
TOTAL A PAGAR 11,50
Pagamentos
TOTAL PAGO 11,50
Multibanco 11,50
Resumo IVA
Taxa Valor s/IVA Valor IVA Valor c/IVA
C 6% 7,92 0,48 8,40
E 23% 2,27 0,52 2,79
I 0% 0,10 0,00 0,10
003304 2026-03-05 18:10 0765 0065 0730
------------------------------------------------
PINGO DOCE
730-EXEMPLO
Terminal Pagamento Automático: 00000000
26-03-05 18:09:53 Per074 Tr005 Msg996
CARTAO: ****1234 TC:AAAA
Visa Credit
Fatura Simplificada FS 07300652603050929/000001`;

const INTER = `INTERMARCHE EXEMPLO
FATURA SIMPLIFICADA
DOCUMENTO No:FS 0X0000000/0001
ARTIGO(S) Preço IVA
 ART# 0000000000001
*MACA EXEMPLO KG
0,500 kg X 2,00EURO/kg Eur1,00 A
 ART# 0000000000002
*PAO FORMA C/CODEA 82 Eur1,50 A
 ART# 0000000000003
COCA-COLA S/ACUC LAT Eur1,00 B
DEPOSITO LATA 1 UN. Eur0,10 C
 4 Art., COM TOTAL DE Eur3,60
 MULTIBANCO Eur3,60
TROCO Eur0,00
 NUMERARIO Eur0,00
RECAPITULATIVO IVA
COD. TAXA Iliqui. IVA Liquido
A 6,00% 2,36 0,14 2,50
B 23,00% 0,81 0,19 1,00
9:11:06 2026-03- 7
CARTAO: ****1234 TC:BBBB
A0000000031010 Visa Debit`;

t('Pingo Doce: itens, quantidade, peso, desconto, depósito e conferência do total', () => {
  const r = parseReceipt(PINGO);
  assert.equal(r.store, 'Pingo Doce'); assert.equal(r.branch, 'Exemplo'); assert.equal(r.date, '2026-03-05'); assert.equal(r.time, '18:10');
  assert.equal(r.doc, '07300652603050929/000001'); assert.equal(r.paid, 11.5); assert.equal(r.gross, 11.8); assert.equal(r.savings, 0.3);
  assert.equal(r.card, '1234'); assert.equal(r.cardType, 'Credit'); assert.equal(r.payment, 'Multibanco');
  assert.equal(r.items.length, 6); assert.ok(r.check.ok); assert.deepEqual(r.warnings, []);
  const [arroz, leite, frango, pao, cola, dep] = r.items;
  assert.equal(arroz.discount, 0.3); assert.equal(arroz.net, 1.2); assert.equal(arroz.vat, 23);
  assert.equal(leite.name, 'LT UHT EXEMPLO PD 6'); assert.equal(leite.vat, 6);
  assert.equal(frango.weightKg, 0.5); assert.equal(frango.unit, 6);
  assert.equal(pao.qty, 3); assert.equal(pao.unit, 0.3);
  assert.equal(cola.name, 'COLA ZERO LATA 33'); assert.equal(dep.kind, 'deposit'); assert.equal(dep.vat, 0);
});
t('Intermarché: peso, depósito, data com zeros omitidos e conferência', () => {
  const r = parseReceipt(INTER);
  assert.equal(r.store, 'Intermarché'); assert.equal(r.branch, 'Exemplo'); assert.equal(r.date, '2026-03-07'); assert.equal(r.time, '09:11');
  assert.equal(r.doc, '0X0000000/0001'); assert.equal(r.paid, 3.6); assert.equal(r.payment, 'Multibanco'); assert.equal(r.card, '1234'); assert.equal(r.cardType, 'Debit');
  assert.equal(r.items.length, 4); assert.ok(r.check.ok);
  assert.deepEqual([r.items[0].name, r.items[0].weightKg, r.items[0].unit, r.items[0].net], ['MACA EXEMPLO KG', 0.5, 2, 1]);
  assert.equal(r.items[3].kind, 'deposit'); assert.equal(r.items[1].vat, 6);
});
t('fatura que não fecha é marcada; texto vazio ou de outra loja vira null', () => {
  const r = parseReceipt(PINGO.replace('TOTAL PAGO 11,50', 'TOTAL PAGO 12,50'));
  assert.ok(!r.check.ok); assert.equal(r.check.diff, -1);
  assert.equal(parseReceipt(''), null); assert.equal(parseReceipt('outra loja\nArtigos'), null);
});
t('desconto extra de refeição abate o total', () => {
  const txt = `Artigos\nRESTAURAÇÃO\nD PRATO EXEMPLO 5,00\nD SOBREMESA EXEMPLO 2,00\nDescontos Extra\nACOMPANHAMENTO (1,50)\nResumo\nTOTAL 7,00\nTOTAL PAGO 5,50\nPINGO DOCE\n1-X\n26-03-05 12:00:00 Per1\n003 2026-03-05 12:00 0\nFS 1/1`;
  const r = parseReceipt(txt); assert.ok(r.check.ok); assert.equal(r.items[2].kind, 'discount'); assert.equal(r.items[2].net, -1.5);
});
t('categorize: ordem das regras e seção da loja', () => {
  const c = (name, sec = '') => categorize(name, sec).category;
  assert.equal(c('PAO DE QUEIJO UN'), 'Pastelaria e salgados'); assert.equal(c('PAO DE LEITE 8 UNID.'), 'Pão'); assert.equal(c('BRASILEIRO 100G', 'PADARIA/PASTELARIA'), 'Pão'); assert.equal(c('MANTEIGA COM SAL 250'), 'Lácteos e ovos');
  assert.equal(c('COCA-COLA ZERO 33CL', 'RESTAURAÇÃO'), 'Refeições na loja'); assert.equal(c('VINAGRE VINHO 500ML'), 'Mercearia');
  assert.equal(c('TAB.CHOC. LEITE 200G'), 'Doces e snacks'); assert.equal(c('JOGO QUALQUER'), 'Lazer e brinquedos'); assert.equal(c('PIZZA ATUM PD 350G'), 'Refeições prontas');
  assert.equal(c('XPTO DESCONHECIDO'), UNCAT); assert.equal(c('XPTO DESCONHECIDO', 'BAZAR'), 'Casa e bazar');
  assert.equal(categorize('ARROZ AGULHA 1KG').need, 'essential'); assert.equal(categorize('COLA ZERO LATA 33').need, 'flexible'); assert.equal(categorize('XPTO').need, '');
});
t('receiptRecords: ids estáveis, linhas com tudo e soma das linhas = total pago', () => {
  const a = receiptRecords(parseReceipt(PINGO)), b = receiptRecords(parseReceipt(PINGO));
  assert.equal(a.receipt.id, b.receipt.id); assert.deepEqual(a.lines.map(l => l.id), b.lines.map(l => l.id)); assert.equal(new Set(a.lines.map(l => l.id)).size, 6);
  assert.equal(a.receipt.month, '2026-03'); assert.equal(a.lines[0].rid, a.receipt.id); assert.equal(a.lines[2].weightKg, 0.5); assert.ok(a.lines.every(l => l.auto === true));
  const s = summarize(a.lines); assert.equal(s.total, 11.5); assert.equal(s.need.essential + s.need.flexible + s.need[''], 11.5);
  assert.notEqual(a.receipt.id, receiptRecords(parseReceipt(INTER)).receipt.id);
});
t('linkExpenses: mesmo valor até 5 dias, um gasto por fatura, prefere o mesmo dia', () => {
  const rc = [{ id: 'r1', date: '2026-03-05', paid: 11.5 }, { id: 'r2', date: '2026-03-07', paid: 11.5 }, { id: 'r3', date: '2026-03-09', paid: 3.6 }];
  const ex = [{ id: 'e1', date: '2026-03-06', amount: 11.5, category: 'Mercado' }, { id: 'e2', date: '2026-03-07', amount: 11.5, category: 'Mercado' }, { id: 'e3', date: '2026-03-20', amount: 3.6 }];
  const k = linkExpenses(rc, ex);
  assert.deepEqual(k.pairs.map(p => [p.receiptId, p.expenseId]), [['r1', 'e1'], ['r2', 'e2']]); assert.deepEqual(k.unmatched.map(r => r.id), ['r3']);
});
t('priceVolume: preço + quantidade + novos − deixados = diferença', () => {
  const L = (name, qty, net, extra = {}) => ({ kind: 'item', store: 'X', pkey: productKey(name), name, qty, net, ...extra });
  const A = [L('Leite', 2, 4), L('Pão', 1, 1), L('Doce', 1, 2)], B = [L('Leite', 3, 7.5), L('Pão', 1, 1), L('Chocolate', 1, 1), L('Arroz', 0, 0, { kind: 'deposit', net: 5 })];
  const r = priceVolume(A, B);
  assert.equal(r.totalA, 7); assert.equal(r.totalB, 9.5); assert.equal(r.diff, 2.5);
  assert.equal(r.price, 1.5); assert.equal(r.volume, 2); assert.equal(r.newProducts, 1); assert.equal(r.dropped, -2);
  assert.equal(Math.round((r.price + r.volume + r.newProducts + r.dropped) * 100) / 100, r.diff);
  assert.equal(r.common[0].name, 'Leite');
});
console.log(`\n${n} grupos ok`);

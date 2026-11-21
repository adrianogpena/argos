// node test/card-month.test.mjs  (dados fictícios; texto no formato do `pdftotext -raw`)
import assert from 'node:assert/strict';
import { parseCardText, checkStatement, lineRecords, statementRecord, linkPayments, cardEntries, buildCardRecords, cardReport, impliedTan, kindOf, CARD_PAYMENT_KEYS } from '../lib/card-month.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

// Layout antigo: datas AAAA/MM/DD, uma linha por movimento. Saldo 100,00 + débitos 51,00 − créditos 30,00 = 121,00.
const OLD = `EXTRATO VISA CLASSIC ACTIVOBANK N. 2030/001
RESUMO DA CONTA
Extrato de: 2030/03/01 a 2030/03/31 Moeda: EUR
Emissão do Extrato Anterior: 2030/02/28 Data de Pagamento: 2030/04/11
Emissão do Extrato Atual: 2030/03/30 Opção de Pagamento: 15 %
Conta Cartão: 000000-0000000-00-0 Total a Pagar: 50.00
Mínimo a Pagar: 10.00
Limite de Crédito: 1 500.00
TAN Pagamento Percentual: 16.000%
RESUMO DE MOVIMENTOS
Saldo em Dívida à Data do
Extrato Anterior
Créditos Débitos Saldo em Dívida à Data do
Extrato Atual
100.00 30.00 51.00 121.00
IMPUTAÇÃO DOS VALORES PAGOS NO PERÍODO EXTRATADO
Amortização
de Capital
Juros Imposto do Selo
/IVA
Comissões
/Despesas
Valor Total
Pagamento 30.00
Pagamento Percentual 28.50 1.20 0.30 0.00 30.00
DETALHE DE MONTANTES EM DÍVIDA
Pagamento Percentual Valor Total
121.00 121.00
INFORMAÇÃO SOBRE O PRÓXIMO PAGAMENTO
Amortização
de Capital
Juros Imposto do Selo
/IVA
Comissões
/Despesas
Valor Total
Total a Pagar 48.00 1.00 0.04 0.96 50.00
Pagamento Percentual 48.00 1.00 0.04 0.96 50.00
Pagamento Percentual: Até 8 dias antes da data do débito pode alterar a sua 'opção de pagamento'
DETALHE DOS MOVIMENTOS
Data
Movimento
Data
Valor Descritivo Rede Débito Crédito
2030/03/02 2030/03/03 COMPRA 1234 MERCADO EXEMPLO PORTO 40.00
VIS
2030/03/01 2030/03/10 >PAGAMENTO CARTAO DE CREDITO 30.00
2030/03/15 2030/03/15 PAGSERV AGUA EXEMPLO 12345/678 IFTH 9.00
2030/03/20 2030/03/20 TAXA LIMITE EXCEDIDO 0.96
2030/03/31 2030/03/30 DEBITO JUROS 1.00
2030/03/31 2030/03/30 IMPOSTO DO SELO S/CRED 863.08 0.04
Banco ActivoBank, S.A. - Sede: Rua Exemplo
`;
// Layout novo: datas MM/DD e descrição quebrada em duas linhas, rodapé de página no meio.
const NEW = `EXTRATO VISA CLASSIC ACTIVOBANK N. 2030/002
RESUMO DA CONTA
Extrato de: 2030/04/01 a 2030/04/30 Moeda: EUR
Emissão do Extrato Anterior: 2030/03/30 Data de Pagamento: 2030/05/11
Emissão do Extrato Atual: 2030/04/29 Opção de Pagamento: 15 %
Total a Pagar: 20.00
TAN Pagamento Percentual: 17.400%
RESUMO DE MOVIMENTOS
Créditos Débitos Saldo em Dívida à Data
do Extrato Atual
1 121.00 50.00 25.50 1 096.50
DETALHE DOS MOVIMENTOS
Data
Mov.
Data
Valor
Descritivo Rede Débito Crédito
04/02 04/03 COMPRA 1234 CAFE EXEMPLO
LISBOA
VIS 15.50
Banco ActivoBank, S.A. - Sede: Rua Exemplo
Pág. 4 / 5
DETALHE DOS MOVIMENTOS
Data
Mov.
Data
Valor
Descritivo Rede Débito Crédito
04/05 04/06 COMPRA 1234 TUI 1 TUI VIS 10.00
04/01 04/10 >PAGAMENTO CARTAO CREDITO 50.00
`;

t('parse layout antigo: cabeçalho, imputação, próximo pagamento e linhas', () => {
  const [s] = parseCardText(OLD);
  assert.equal(s.stmt, '2030-03'); assert.equal(s.n, '2030/001'); assert.equal(s.tan, 16); assert.equal(s.limit, 1500); assert.equal(s.optionPct, 15);
  assert.equal(s.payDate, '2030-04-11'); assert.equal(s.issue, '2030-03-30'); assert.equal(s.totalDue, 50); assert.equal(s.minDue, 10);
  assert.deepEqual([s.prevBalance, s.credits, s.debits, s.balance], [100, 30, 51, 121]);
  assert.deepEqual(s.paid, { capital: 28.5, interest: 1.2, stamp: 0.3, fees: 0, total: 30 });
  assert.deepEqual(s.next.total, { capital: 48, interest: 1, stamp: 0.04, fees: 0.96, total: 50 });
  assert.deepEqual(s.debtDetail, { percent: 121, total: 121 });
  assert.deepEqual(s.lines.map(l => [l.desc, l.amount, l.credit]), [['COMPRA 1234 MERCADO EXEMPLO PORTO', 40, false], ['PAGAMENTO CARTAO DE CREDITO', 30, true], ['PAGSERV AGUA EXEMPLO 12345/678 IFTH', 9, false], ['TAXA LIMITE EXCEDIDO', 0.96, false], ['DEBITO JUROS', 1, false], ['IMPOSTO DO SELO S/CRED 863.08', 0.04, false]]);
  assert.equal(s.lines[1].valueDate, '2030-03-10');
});
t('parse layout novo: datas MM/DD, descrição em duas linhas, rodapé e cabeçalho repetidos', () => {
  const [s] = parseCardText(NEW);
  assert.equal(s.tan, 17.4); assert.deepEqual([s.prevBalance, s.credits, s.debits, s.balance], [1121, 50, 25.5, 1096.5]);
  assert.deepEqual(s.lines.map(l => [l.date, l.desc, l.amount]), [['2030-04-02', 'COMPRA 1234 CAFE EXEMPLO LISBOA', 15.5], ['2030-04-05', 'COMPRA 1234 TUI 1 TUI', 10], ['2030-04-01', 'PAGAMENTO CARTAO CREDITO', 50]]);
});
t('texto com dois extratos vira dois registros', () => { assert.equal(parseCardText(OLD + NEW).length, 2); });
t('kindOf', () => {
  assert.deepEqual(['COMPRA 1 X', 'DEBITO JUROS', 'JUROS PAG FRACIONADO', 'IMPOSTO DO SELO - JUROS', 'TAXAS POSTOS COMBUSTIVEL', 'PAGAMENTO CARTAO DE CREDITO', 'LIMITE EXCEDIDO NO CARTAO DE CREDITO', 'CRED. 7565 LOJA', 'CASHBACK CAMPANHA X', 'PAG.IGCP -123'].map(kindOf),
    ['purchase', 'interest', 'interest', 'stamp', 'fee', 'payment', 'payment', 'refund', 'refund', 'service']);
});
t('checkStatement: saldo, soma das linhas e imputação fecham; linha perdida é detectada', () => {
  const [s] = parseCardText(OLD), c = checkStatement(s);
  assert.ok(c.ok && c.balance && c.lines && c.imputation);
  const lost = { ...s, lines: s.lines.slice(0, 2) }, c2 = checkStatement(lost);
  assert.ok(!c2.ok && c2.balance && !c2.lines);
  assert.ok(!checkStatement({ ...s, balance: 121.05 }).balance);
});
t('lineRecords: ids estáveis e kind; statementRecord não leva as linhas', () => {
  const [s] = parseCardText(OLD), a = lineRecords(s), b = lineRecords(s);
  assert.deepEqual(a.map(x => x.id), b.map(x => x.id)); assert.equal(new Set(a.map(x => x.id)).size, a.length);
  assert.deepEqual(a.map(x => x.kind), ['purchase', 'payment', 'service', 'fee', 'interest', 'stamp']);
  const r = statementRecord(s, { file: 'x.pdf', status: 'arquivado' });
  assert.equal(r.lines, undefined); assert.equal(r.nLines, 6); assert.ok(r.check.ok); assert.equal(r.id, '2030-03'); assert.equal(r.tan, 16);
});
t('cardEntries: compra e serviço na data; juros/selo/taxa como itens próprios; pagamento não é gasto', () => {
  const { entries } = cardEntries(lineRecords(parseCardText(OLD)[0]));
  assert.deepEqual(entries.map(e => [e.kind, e.amount, e.label || '']), [['purchase', 40, ''], ['service', 9, ''], ['fee', 0.96, 'Taxa de limite excedido'], ['interest', 1, 'Juros do cartão'], ['stamp', 0.04, 'Imposto do selo do cartão']]);
});
t('cardEntries: estorno abate a compra do mesmo comerciante; sem compra fica informativo', () => {
  const L = [{ date: '2030-05-01', desc: 'COMPRA 1 LOJA EXEMPLO', amount: 12, kind: 'purchase' }, { date: '2030-05-05', desc: 'CRED. 1 LOJA EXEMPLO', amount: 5, kind: 'refund', credit: true }, { date: '2030-05-06', desc: 'CASHBACK CAMPANHA', amount: 2, kind: 'refund', credit: true }];
  const r = cardEntries(L);
  assert.equal(r.entries[0].amount, 7); assert.equal(r.unmatchedRefunds.length, 1);
});
t('buildCardRecords: fixos confirmados, compras auto, regra vence, skip e duplicados', () => {
  const { entries } = cardEntries(lineRecords(parseCardText(OLD)[0]));
  const a = buildCardRecords(entries);
  assert.equal(a.records.length, 5); assert.ok(a.records.every(r => r.source === 'card' && r.card && r.id.startsWith('k')));
  assert.deepEqual(a.records.filter(r => r.ck).map(r => [r.ck, r.category, r.auto]), [['fee', 'Cartão de crédito', false], ['interest', 'Cartão de crédito', false], ['stamp', 'Cartão de crédito', false]]);
  assert.ok(a.records.find(r => r.kind === undefined && r.amount === 40).auto);
  const key = a.records.find(r => r.amount === 40).key;
  const b = buildCardRecords(entries, new Set([a.records[0].id]), new Map([[key, { category: 'Mercado', need: 'essential', tag: 'Supermercado' }]]));
  assert.equal(b.duplicates, 1);
  const c = buildCardRecords(entries, new Set(), new Map([[key, { category: 'Mercado', need: 'essential', tag: 'Supermercado' }]]));
  assert.deepEqual(c.records.find(r => r.amount === 40), { ...c.records.find(r => r.amount === 40), category: 'Mercado', need: 'essential', label: 'Supermercado', auto: false });
  assert.equal(buildCardRecords(entries, new Set(), new Map([[key, { skip: true }]])).skipped, 1);
});
t('linkPayments: liga por valor e data (até 7 dias), 1 para 1; pagamentos parciais no mês', () => {
  const card = [{ id: 'k1', kind: 'payment', amount: 30, valueDate: '2030-03-10', stmt: '2030-03' }, { id: 'k2', kind: 'payment', amount: 30, valueDate: '2030-03-20', stmt: '2030-03' }, { id: 'k3', kind: 'payment', amount: 99, valueDate: '2030-03-21', stmt: '2030-03' }];
  const bank = [{ id: 'b1', account: 'SIMPLES', amount: -30, date: '2030-03-12', desc: 'VIS PAGAMENTO CARTAO DE CREDITO', seq: 1 }, { id: 'b2', account: 'SIMPLES', amount: -30, date: '2030-03-20', desc: 'VIS PAGAMENTO CARTAO CREDITO', seq: 2 },
    { id: 'b3', account: 'SIMPLES', amount: -5, date: '2030-03-25', desc: 'VIS LIMITE EXCEDIDO NO CARTAO DE CREDITO', seq: 3 }, { id: 'b4', account: 'POUP', amount: -99, date: '2030-03-21', desc: 'PAGAMENTO CARTAO CREDITO', seq: 4 }];
  const r = linkPayments(card, bank);
  assert.deepEqual(r.pairs.map(p => [p.cardLineId, p.bankLineId]), [['k1', 'b1'], ['k2', 'b2']]);
  assert.deepEqual(r.unmatchedCard.map(x => x.id), ['k3']); assert.deepEqual(r.unmatchedBank.map(x => x.id), ['b3']);
});
t('CARD_PAYMENT_KEYS é a chave que o descKey gera para o pagamento no banco', async () => {
  const { descKey } = await import('../lib/classify.js');
  for (const d of ['VIS PAGAMENTO CARTAO DE CREDITO', 'VIS PAGAMENTO CARTAO CREDITO', 'VIS LIMITE EXCEDIDO NO CARTAO DE CREDITO']) assert.ok(CARD_PAYMENT_KEYS.includes(descKey(d)), d);
});
t('cardReport: esperado x Gastos, pagamentos ligados', () => {
  const s = parseCardText(OLD)[0], lines = lineRecords(s), { entries } = cardEntries(lines), { records } = buildCardRecords(entries);
  const link = linkPayments(lines, [{ id: 'b1', account: 'SIMPLES', amount: -30, date: '2030-03-11', desc: 'VIS PAGAMENTO CARTAO DE CREDITO', seq: 1 }]);
  const r = cardReport(s, lines, records, link);
  assert.ok(r.check.ok); assert.equal(r.expected, 51); assert.equal(r.inVault.total, 51); assert.equal(r.inVault.pending, 2); assert.equal(r.payments.linked, 1); assert.deepEqual(r.byKind.purchase, { n: 1, total: 40 });
});
t('impliedTan: juros ÷ saldo médio diário', () => {
  const s = { prevBalance: 1000, prevIssue: '2030-01-01', issue: '2030-01-31', from: '2030-01-01', to: '2030-01-31', plans: [] };
  const r = impliedTan(s, [{ kind: 'interest', amount: 10, credit: false, date: '2030-01-30', valueDate: '2030-01-30', desc: 'DEBITO JUROS' }]);
  assert.ok(Math.abs(r.rate - 10 / (1000 * 30 / 365) * 100) < 1e-9);
  assert.equal(impliedTan({ ...s, plans: [{}] }, []), null);
});
console.log(`${n} grupos ok`);

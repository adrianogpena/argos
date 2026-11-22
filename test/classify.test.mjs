// node test/classify.test.mjs  (dados fictícios)
import assert from 'node:assert/strict';
import { descKey, bankId, buildRecords, pendingGroups, applyDecisions, applyLabels, merchantGroups, keyGroups, displayName, searchUrl, inferBranch, recurrenceHint, isIntermediary, canonMotivo, UNCAT } from '../lib/classify.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('descKey ignora números, datas e palavras de banco', () => {
  assert.equal(descKey('COMPRA 1234 Loja Exemplo Lda 05-03'), 'loja-exemplo');
  assert.equal(descKey('Compra Loja Exemplo 9999'), descKey('COMPRA 1234 Loja Exemplo Lda'));
  assert.equal(descKey('123 456'), 'sem-descricao');
  assert.equal(descKey('COMPRA 5061 730-CARVALHOS 2238 -V N CONTACTLESS'), descKey('COMPRA 7565 PINGO DOCE 2238 -V NV DE')); // código da loja = Pingo Doce
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

const M = (id, key, amount, date, note, o = {}) => ({ id, date, amount, category: UNCAT, need: '', note, source: 'bank', auto: true, key, ...o });
const MX = [
  M('m1', 'casa-exemplo-pedros', 20, '2024-01-05', 'COMPRA 5061 CASA EXEMPLO 4415-230 PEDROS'),
  M('m2', 'casa-exemplo-contactless', 30, '2024-02-09', 'COMPRA 5061 CASA EXEMPLO330 CONTACTLESS'),
  M('m3', 'padaria-ficticia', 3, '2024-01-06', 'COMPRA 5061 PADARIA FICTICIA CONTACTLESS'),
  M('m4', 'hipay-exemplo', 50, '2024-01-07', 'COMPRA 5061 HIPAY EXEMPLO'),
  M('m5', 'trf', 9, '2024-01-08', 'TRF P/ PESSOA EXEMPLO'),
];
t('keyGroups: une localidade/sufixo e nome truncado, mas não palavras genéricas nem gateways', () => {
  const g = keyGroups(['expoente-pedros', 'expoente-contactless', 'schlicht-soa-obri', 'schlichting-soarestel-contactless', 'partilha-conceitos-contactless', 'partilha-conceitos-pedroso',
    'google-play-apps', 'google-payment-ireland', 'sumup-a', 'sumup-b', 'cafe-a', 'cafe-b', 'curto-a', 'curto-b', 'loja-x']);
  assert.equal(g.get('expoente-pedros'), 'expoente'); assert.equal(g.get('expoente-contactless'), 'expoente');
  assert.equal(g.get('schlicht-soa-obri'), g.get('schlichting-soarestel-contactless'));
  assert.equal(g.get('partilha-conceitos-pedroso'), g.get('partilha-conceitos-contactless'));
  for (const k of ['google-play-apps', 'google-payment-ireland', 'sumup-a', 'sumup-b', 'cafe-a', 'cafe-b', 'curto-a', 'curto-b', 'loja-x']) assert.equal(g.get(k), k);
});
t('merchantGroups: merge unifica, month filtra mantendo o id do grupo, ordena por total; sem opções nada muda', () => {
  assert.equal(pendingGroups(MX).length, 5);
  assert.equal(pendingGroups(MX, { merge: true }).length, 5);                  // 'casa' é genérica: não une
  const Y = [M('y1', 'bazar-exemplo-pedros', 20, '2024-01-05', 'BAZAR EXEMPLO PEDROS'), M('y2', 'bazar-exemplo-contactless', 30, '2024-02-09', 'BAZAR EXEMPLO'),
    M('y3', 'bazar-exemplo-lisboa', 5, '2024-03-01', 'BAZAR EXEMPLO LISBOA'), M('y4', 'outro-lugar', 99, '2024-01-02', 'OUTRO LUGAR')];
  const g = pendingGroups(Y, { merge: true });
  const b = g.find(x => x.key === 'bazar'); assert.deepEqual([b.n, b.total, b.from, b.to, b.avg, b.keys.length], [3, 55, '2024-01-05', '2024-03-01', 18.33, 3]);
  const jan = pendingGroups(Y, { merge: true, month: '2024-01' });
  assert.equal(jan.find(x => x.key === 'bazar').n, 1);                         // id estável apesar do filtro
  assert.deepEqual(jan.map(x => x.total), [99, 20]);
});
t('displayName e searchUrl: nome limpo, sem cartão/contactless/números; link só com o nome', () => {
  assert.equal(displayName('COMPRA 5061 CASA EXEMPLO4415-230 PEDROS'), 'CASA EXEMPLO PEDROS');
  assert.equal(displayName('COMPRA 5061 BAR FICTICIO CONTACTLESS'), 'BAR FICTICIO');
  assert.equal(displayName('PAG SERV 12101/273840846 HIPAY SAS'), 'HIPAY SAS');
  assert.equal(searchUrl('BAR FICTICIO PORTO'), 'https://www.google.com/search?q=BAR+FICTICIO+PORTO');
});
t('inferBranch: só quando o texto do banco declara o ramo; nunca intermediário nem transferência', () => {
  assert.deepEqual(inferBranch('COMPRA 5061 PASTELARIA FICTICIA PORTO'), { category: 'Restaurantes', need: 'flexible', label: 'Café' });
  assert.equal(inferBranch('COMPRA 5061 SUPERMERCADO EXEMPLO').label, 'Supermercado');
  assert.equal(inferBranch('COMPRA 5061 LOJA EXEMPLO'), null);
  assert.equal(inferBranch('COMPRA 5061 HIPAY RESTAURANTE'), null);
  assert.equal(inferBranch('TRF P/ RESTAURANTE', 'trf'), null);
});
t('recurrenceHint: só apoio (n>=3 e média baixa)', () => {
  assert.ok(recurrenceHint({ n: 4, avg: 2.5 })); assert.equal(recurrenceHint({ n: 2, avg: 2 }), ''); assert.equal(recurrenceHint({ n: 5, avg: 30 }), '');
});
t('motivo: canonMotivo aceita sem acento; intermediário reconhecido', () => {
  assert.equal(canonMotivo('intermediario'), 'intermediário'); assert.equal(canonMotivo('homonimos'), 'homónimos'); assert.equal(canonMotivo('xyz'), '');
  assert.ok(isIntermediary('https-hipay-com')); assert.ok(!isIntermediary('loja-exemplo'));
});
t('applyDecisions: motivo gravado na dúvida e limpo ao confirmar; recusa motivo+confirm, intermediário, motivo inválido; avisa dúvida sem motivo', () => {
  const r = applyDecisions(MX, [
    { key: 'hipay-exemplo', category: 'Compras', confirm: false, motivo: 'intermediário' },
    { key: 'trf', category: 'Outros', confirm: false, motivo: 'pessoa' },
    { key: 'padaria-ficticia', category: 'Restaurantes', confirm: false }]);
  assert.equal(r.errors.length, 1);                                            // 'trf' é chave genérica
  assert.equal(r.updates.find(u => u.id === 'm4').motivo, 'intermediário'); assert.equal(r.warnings.length, 1);
  assert.deepEqual(r.byMotivo, { 'intermediário': 1, '(sem motivo)': 1 });
  const bad = applyDecisions(MX, [{ key: 'hipay-exemplo', category: 'Compras', confirm: true }, { key: 'padaria-ficticia', category: 'Restaurantes', confirm: true, motivo: 'homónimos' }, { key: 'padaria-ficticia', category: 'Restaurantes', confirm: false, motivo: 'zzz' }]);
  assert.equal(bad.errors.length, 3); assert.equal(bad.updates.length, 0);
  const prev = MX.map(x => x.id === 'm3' ? { ...x, motivo: 'ramo-ambíguo' } : x);
  const ok = applyDecisions(prev, [{ key: 'padaria-ficticia', category: 'Restaurantes', need: 'flexible', label: 'Café', confirm: true }]);
  assert.ok(!('motivo' in ok.updates[0]) && !('auto' in ok.updates[0]));
});
t('applyDecisions: decisão no id do grupo vale para todas as chaves (uma regra por chave crua); keys explícitas unem o resto', () => {
  const G = [M('g1', 'bazar-exemplo-pedros', 10, '2024-01-01', 'COMPRA BAZAR EXEMPLO PEDROS'), M('g2', 'bazar-exemplo-contactless', 12, '2024-02-01', 'COMPRA BAZAR EXEMPLO'), M('g3', 'outra-grafia', 7, '2024-03-01', 'OUTRA GRAFIA')];
  const r = applyDecisions(G, [{ key: 'bazar', keys: ['outra-grafia'], category: 'Compras', need: 'flexible', label: 'Casa', confirm: true }]);
  assert.equal(r.confirmed, 3); assert.deepEqual(r.rules.map(x => x.id).sort(), ['bazar-exemplo-contactless', 'bazar-exemplo-pedros', 'outra-grafia']);
  assert.ok(r.updates.every(u => u.key !== 'bazar' && !('auto' in u)));         // chave crua preservada (ids e regras seguem valendo)
  assert.ok(r.rules.every(x => x.tag === 'Casa'));
});
t('applyDecisions: Outros confirmado vale para intermediário e transferência (esta sem regra); outra categoria continua recusada', () => {
  const r = applyDecisions(MX, [
    { key: 'hipay-exemplo', category: 'Outros', label: 'Pagamento online', confirm: true },
    { key: 'trf', category: 'Outros', label: 'Transferência', confirm: true }]);
  assert.equal(r.errors.length, 0);
  assert.ok(r.updates.length >= 2 && r.updates.every(u => !u.auto && u.category === 'Outros'));
  assert.deepEqual(r.rules.map(x => x.id), ['hipay-exemplo']);                 // 'trf' confirma os lançamentos mas não vira regra
  assert.equal(applyDecisions(MX, [{ key: 'trf', category: 'Compras', confirm: true }]).errors.length, 1);
});
console.log(`\n${n} passed`);

// node test/expenses.test.mjs
import assert from 'node:assert/strict';
import { expenseRecord, needSplit, monthly, byCategory, monthTotal, delta, categoriesIn, categoryOptions, canonicalCategory, byLabel, labelOptions, cleanLabel } from '../lib/expenses-core.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const E = (date, amount, category) => ({ id: date + amount, date, amount, category });

t('expenseRecord validates', () => {
  assert.ok(expenseRecord({ id: 'a', date: '2026-05-02', amount: '12,50', category: 'Mercado' }).ok);
  assert.equal(expenseRecord({ id: 'a', date: '2026-05-02', amount: '0', category: 'x' }).error, 'amount');
  assert.equal(expenseRecord({ id: 'a', date: '2026-05-02', amount: '5', category: ' ' }).error, 'category');
  assert.equal(expenseRecord({ id: 'a', date: 'hoje', amount: '5', category: 'x' }).error, 'date');
});
t('expenseRecord keeps the bank fields and rejects an unknown need', () => {
  const r = expenseRecord({ id: 'a', date: '2026-05-02', amount: '9', category: 'Mercado', need: 'essential', source: 'bank', auto: true, key: 'loja-exemplo' }).rec;
  assert.deepEqual([r.need, r.source, r.auto, r.key], ['essential', 'bank', true, 'loja-exemplo']);
  const m = expenseRecord({ id: 'b', date: '2026-05-02', amount: '9', category: 'Mercado', need: 'xyz' }).rec;
  assert.equal(m.need, ''); assert.ok(!('auto' in m) && !('source' in m));
});
t('needSplit separates essential, flexible and undefined in the month', () => {
  const items = [{ ...E('2026-05-01', 100, 'Moradia'), need: 'essential' }, { ...E('2026-05-02', 20, 'Lazer'), need: 'flexible' }, E('2026-05-03', 5, 'x'), { ...E('2026-04-03', 99, 'x'), need: 'essential' }];
  assert.deepEqual(needSplit(items, '2026-05'), { essential: 100, flexible: 20, none: 5 });
});
t('monthly fills empty months and keeps order', () => {
  const m = monthly([E('2026-03-10', 5, 'a'), E('2026-03-20', 7, 'a'), E('2026-05-01', 3, 'a')], 4, new Date(2026, 4, 15));
  assert.deepEqual(m, [{ month: '2026-02', total: 0 }, { month: '2026-03', total: 12 }, { month: '2026-04', total: 0 }, { month: '2026-05', total: 3 }]);
});
t('monthly crosses a year boundary', () => {
  assert.deepEqual(monthly([], 3, new Date(2026, 0, 31)).map(x => x.month), ['2025-11', '2025-12', '2026-01']);
});
t('byCategory sorts, shares add to 1, month filter works', () => {
  const items = [E('2026-05-01', 30, 'Mercado'), E('2026-05-09', 70, 'Moradia'), E('2026-04-09', 100, 'Lazer')];
  const c = byCategory(items, '2026-05');
  assert.deepEqual(c.map(x => x.category), ['Moradia', 'Mercado']); assert.equal(c[0].share, 0.7);
  assert.equal(byCategory(items, null).length, 3); assert.deepEqual(byCategory([], '2026-05'), []);
});
t('delta against previous month, including January', () => {
  const items = [E('2025-12-10', 100, 'a'), E('2026-01-10', 150, 'a')];
  assert.equal(delta(items, '2026-01'), 0.5); assert.equal(delta(items, '2025-12'), null);
  assert.equal(monthTotal(items, '2026-01'), 150);
});
t('categoriesIn keeps defaults and adds custom ones once', () => {
  const c = categoriesIn([E('2026-01-01', 1, 'Pets'), E('2026-01-02', 1, 'Mercado')]);
  assert.ok(c.includes('Pets')); assert.equal(c.filter(x => x === 'Mercado').length, 1);
});
t('categoryOptions: sem repetir por caixa/acento, sem "Sem categoria", Outros por último', () => {
  const o = categoryOptions([E('2026-01-01', 1, 'mercado'), E('2026-01-01', 1, 'Pets'), E('2026-01-01', 1, 'Sem categoria'), E('2026-01-01', 1, ' ')]);
  assert.equal(o.filter(x => x.toLowerCase() === 'mercado').length, 1); assert.ok(o.includes('Pets'));
  assert.ok(!o.includes('Sem categoria')); assert.equal(o.at(-1), 'Outros');
  assert.deepEqual(o.slice(0, -1), [...o.slice(0, -1)].sort((a, b) => a.localeCompare(b, 'pt')));
});
t('canonicalCategory: reaproveita a grafia existente, ignorando caixa e acento', () => {
  const o = ['Saúde', 'Mercado'];
  assert.equal(canonicalCategory('saude', o), 'Saúde'); assert.equal(canonicalCategory('  MERCADO ', o), 'Mercado');
  assert.equal(canonicalCategory('Pets  e   Bichos', o), 'Pets e Bichos');
});
t('rótulo: expenseRecord limpa e limita; byLabel agrupa por categoria > rótulo; labelOptions prioriza a categoria', () => {
  const r = expenseRecord({ id: 'x', date: '2026-03-01', amount: 5, category: 'Transporte', label: '  Combustível  ' });
  assert.equal(r.rec.label, 'Combustível'); assert.equal('label' in expenseRecord({ id: 'x', date: '2026-03-01', amount: 5, category: 'A' }).rec, false);
  assert.equal(cleanLabel('x'.repeat(50)).length, 30);
  const it = [{ ...E('2026-03-01', 10, 'Transporte'), label: 'Combustível' }, { ...E('2026-03-02', 4, 'Transporte'), label: 'Estacionamento' }, E('2026-03-03', 2, 'Transporte'), { ...E('2026-03-04', 20, 'Saúde'), label: 'Farmácia' }, { ...E('2026-02-04', 99, 'Saúde'), label: 'Dentista' }];
  const b = byLabel(it, '2026-03');
  assert.deepEqual(b.map(c => [c.category, c.amount]), [['Saúde', 20], ['Transporte', 16]]);
  assert.deepEqual(b[1].labels, [{ label: 'Combustível', amount: 10 }, { label: 'Estacionamento', amount: 4 }, { label: '', amount: 2 }]);
  assert.deepEqual(labelOptions(it, 'Saúde').slice(0, 2).sort(), ['Dentista', 'Farmácia']);
});
console.log(`\n${n} passed`);

// --- cartão de crédito: parcelamento (dados fictícios)
import { instText } from '../lib/expenses-core.js';
{
  const base = { id: 'c1', date: '2026-01-31', amount: 1.14, category: 'Cartão de crédito', source: 'card', card: true };
  const r = expenseRecord({ ...base, inst: { n: 2, of: 6, left: 133.564, last: false } });
  assert.ok(r.ok); assert.equal(r.rec.card, true); assert.deepEqual(r.rec.inst, { of: 6, n: 2, left: 133.56 });
  assert.equal(instText(r.rec.inst), 'Parcela 2/6 · faltam 133,56 €');
  const l = expenseRecord({ ...base, inst: { n: 6, of: 6, left: 0, last: true } }).rec.inst;
  assert.equal(l.last, true); assert.equal(instText(l), 'Última parcela (6/6) · quitado');
  assert.equal(instText({ n: 0, of: 6, left: 199 }), 'Compra em 6x · faltam 199,00 €');
  assert.equal(expenseRecord({ ...base, inst: { n: 9, of: 6 } }).rec.inst, undefined);   // parcela fora do plano: ignora
  assert.equal(expenseRecord({ ...base }).rec.inst, undefined);
  console.log('ok  cartão: parcelamento (inst) e texto');
}

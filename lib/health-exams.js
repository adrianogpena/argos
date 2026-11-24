// Pure logic for lab exams in the health module: result records, reference status, history per test, plain-language explanations.
// No DOM, no network: tested by test/health-exams.test.mjs. The data themselves live only in the vault (`health-exams`, `health-results`).
import { parseNum } from './car-core.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = v => (v === '' || v == null ? null : parseNum(v));
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/** Known tests, in display order. `info.what` = what it measures; `info.read` = how to read the number. */
export const TESTS = {
  hba1c: { name: 'Hemoglobina glicada (HbA1c)', short: 'HbA1c', section: 'Sangue', unit: '%', decimals: 1,
    what: 'Fração da hemoglobina (a proteína dos glóbulos vermelhos) que está "açucarada". Como os glóbulos vivem uns 3 meses, mostra a média da glicose nesse período. Não precisa de jejum.',
    read: 'Sem diabetes: abaixo de 5,7%. De 5,7% a 6,4%: pré-diabetes. A partir de 6,5%: faixa de diabetes (critérios da ADA). Em quem trata diabetes, a meta (muitas vezes perto de 7%) é definida pelo médico.' },
  ifcc: { name: 'Hemoglobina glicada (IFCC)', short: 'HbA1c IFCC', section: 'Sangue', unit: 'mmol/mol', decimals: 0,
    what: 'O mesmo exame da HbA1c, na unidade internacional (mmol/mol) em vez de %. Alguns países só usam esta.',
    read: 'Referência do laudo: abaixo de 39. Equivalências: 39 ≈ 5,7% e 48 ≈ 6,5%. Os dois valores do laudo podem divergir por arredondamento; o que importa é a tendência.' },
  gme: { name: 'Glicose média estimada (GME)', short: 'Glicose média', section: 'Sangue', unit: 'mg/dL', decimals: 0,
    what: 'Conta feita a partir da HbA1c (fórmula da ADA: 28,7 × HbA1c − 46,7) para dizer, em mg/dL, qual seria a glicose média dos últimos ~3 meses. Não é uma glicemia medida.',
    read: 'Não tem faixa própria. Para comparar: glicemia normal em jejum fica abaixo de 100 mg/dL.' },
  insulin: { name: 'Insulina', short: 'Insulina', section: 'Sangue', unit: 'µU/mL', decimals: 1,
    what: 'Hormônio do pâncreas que leva a glicose do sangue para dentro das células.',
    read: 'Só faz sentido junto com a glicose em jejum. Insulina alta com glicose normal sugere resistência à insulina; baixa com glicose alta sugere pâncreas produzindo pouco. A nota do laudo diz que o índice HOMA (resistência à insulina, calculado com insulina e glicose) só sai quando há glicose no mesmo laudo, o que não é o caso aqui.' },
  cpeptide: { name: 'Peptídeo C', short: 'Peptídeo C', section: 'Sangue', unit: 'ng/mL', decimals: 2,
    what: 'Pedaço que o pâncreas libera junto com cada molécula de insulina. Mostra quanta insulina o próprio corpo ainda produz, mesmo para quem aplica insulina.',
    read: 'Dentro da faixa: o pâncreas continua produzindo insulina. Muito baixo: produção quase parada (típico do tipo 1 avançado). Alto: costuma acompanhar resistência à insulina.' },
  ica: { name: 'Anticorpos anti-ilhéus de Langerhans (IgG)', short: 'Anti-ilhéus', section: 'Sangue', unit: '', decimals: 0,
    what: 'Procura autoanticorpos contra as ilhotas de Langerhans, as células do pâncreas que fazem insulina.',
    read: 'Negativo (abaixo de 1/10): não há sinal de ataque autoimune ao pâncreas. Positivo aponta para diabetes tipo 1 ou LADA. Junto com o peptídeo C, ajuda o médico a separar os tipos de diabetes.' },
  ucrea: { name: 'Creatinina na urina', short: 'Creatinina (urina)', section: 'Urina', unit: 'mg/dL', decimals: 0,
    what: 'Resíduo do músculo que sai pela urina em ritmo quase constante.',
    read: 'Sozinha diz pouco e não tem faixa fixa: serve para saber o quão concentrada está a urina e corrigir a conta da razão albumina/creatinina.' },
  albu: { name: 'Albuminúria', short: 'Albuminúria', section: 'Urina', unit: 'mg/dL', decimals: 1,
    what: 'Albumina (uma proteína do sangue) na urina. Rim saudável quase não a deixa passar.',
    read: '"<0,3" é o limite mínimo que o método detecta: praticamente nada. Depende da diluição da urina, por isso o laudo traz também a razão com a creatinina.' },
  acr: { name: 'Razão albumina/creatinina', short: 'Alb./creatinina', section: 'Urina', unit: 'mg/g', decimals: 1,
    what: 'Albumina dividida pela creatinina na urina: corrige a diluição e é o principal rastreio de lesão no rim causada por diabetes ou pressão alta.',
    read: 'Abaixo de 30 mg/g: normal. De 30 a 300: microalbuminúria (rim começando a deixar passar proteína). Acima de 300: macroalbuminúria.' },
};
export const TEST_KEYS = Object.keys(TESTS);
export const SECTIONS = ['Sangue', 'Urina'];

// The Worker accepts ids of up to 40 characters [A-Za-z0-9_-]: short test keys and a compact date keep the member id (up to ~20) inside.
const compact = d => String(d).replace(/-/g, '');
const ID = /^[A-Za-z0-9_-]{1,40}$/;
export const resultId = (member, test, date) => `${test}-${compact(date)}-${member}`;
export const examId = (member, date, episode) => `x-${compact(date)}-${String(episode || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8)}-${member}`;

/**
 * One result of one test on one day. Numeric (`value`, with `cmp: '<'` when the lab printed "<0.3") or qualitative (`text`, e.g. "Negativo").
 * `low`/`high` = reference range as printed; `highExcl` = the range is "<high", so the value must be strictly below it.
 * `flag` ('ok'|'high'|'low') overrides the computed status, for qualitative results.
 */
export function resultRecord(r) {
  if (!TESTS[r.test]) return { ok: false, error: 'test' };
  if (!r.member) return { ok: false, error: 'member' };
  const date = String(r.date || '');
  if (!DATE.test(date)) return { ok: false, error: 'date' };
  const value = num(r.value), text = String(r.text || '').trim().slice(0, 40);
  if (value == null && !text) return { ok: false, error: 'value' };
  if (value != null && !Number.isFinite(value)) return { ok: false, error: 'value' };
  const low = num(r.low), high = num(r.high);
  if ((low != null && !Number.isFinite(low)) || (high != null && !Number.isFinite(high))) return { ok: false, error: 'ref' };
  if (r.flag && !['ok', 'high', 'low'].includes(r.flag)) return { ok: false, error: 'flag' };
  const id = resultId(r.member, r.test, date);
  if (!ID.test(id)) return { ok: false, error: 'id' };
  return { ok: true, rec: clean({
    id, member: r.member, test: r.test, date, value: value ?? undefined, cmp: r.cmp === '<' || r.cmp === '>' ? r.cmp : undefined, text: text || undefined,
    unit: String(r.unit ?? TESTS[r.test].unit).slice(0, 12), low: low ?? undefined, high: high ?? undefined, highExcl: high != null && r.highExcl ? true : undefined,
    refText: String(r.refText || '').trim().slice(0, 40), flag: r.flag, source: r.source }) };
}

/** One lab report (the PDF), so the list of reports and the "where did this come from" link survive. */
export function examRecord(e) {
  const date = String(e.date || ''), issued = String(e.issued || '');
  if (!e.member) return { ok: false, error: 'member' };
  if (!DATE.test(date)) return { ok: false, error: 'date' };
  if (issued && !DATE.test(issued)) return { ok: false, error: 'issued' };
  const id = examId(e.member, date, e.episode);
  if (!ID.test(id)) return { ok: false, error: 'id' };
  return { ok: true, rec: clean({ id, member: e.member, date, issued, lab: String(e.lab || '').slice(0, 60), place: String(e.place || '').slice(0, 60), episode: String(e.episode || '').slice(0, 20), notes: String(e.notes || '').slice(0, 300) }) };
}

/** 'ok' | 'high' | 'low' | null (no way to judge: no reference range printed). */
export function status(r) {
  if (!r) return null;
  if (r.flag) return r.flag;
  if (r.value == null || r.cmp) return null;
  if (r.low != null && r.value < r.low) return 'low';
  if (r.high != null && (r.highExcl ? r.value >= r.high : r.value > r.high)) return 'high';
  return r.low != null || r.high != null ? 'ok' : null;
}

/** Results of one member and test, oldest first. */
export const testSeries = (results, member, test) => results.filter(x => x.member === member && x.test === test).sort((a, b) => a.date.localeCompare(b.date));

/** The reference range of the newest result that prints one (older columns of a report carry none). */
export const refOf = s => { for (let i = s.length - 1; i >= 0; i--) if (s[i].refText || s[i].low != null || s[i].high != null) return s[i]; return null; };

/** The numeric value as the lab printed it: "<0,3", "5,7", or the text of a qualitative result. */
export function shown(r, locale = 'pt-BR') {
  if (r.value == null) return r.text || '';
  const d = TESTS[r.test]?.decimals ?? 1;
  return (r.cmp || '') + r.value.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: d });
}

/** One row per test the member has, in catalogue order: the newest result, the one before, the change and the status. */
export function overview(results, member) {
  const rows = [];
  for (const test of TEST_KEYS) {
    const s = testSeries(results, member, test);
    if (!s.length) continue;
    const last = s[s.length - 1], prev = s.length > 1 ? s[s.length - 2] : null, ref = refOf(s);
    const change = prev && last.value != null && prev.value != null && !last.cmp && !prev.cmp ? Math.round((last.value - prev.value) * 1e3) / 1e3 : null;
    const own = last.low != null || last.high != null || last.flag;
    rows.push({ test, def: TESTS[test], last, prev, change, ref, status: status(own || !ref ? last : { ...last, low: ref.low, high: ref.high, highExcl: ref.highExcl }), count: s.length });
  }
  return rows;
}

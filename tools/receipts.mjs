#!/usr/bin/env node
// Faturas de supermercado (Pingo Doce, Intermarché) -> cofre. Roda no computador do dono; dados nunca vão para o git. Lógica em lib/receipt.js.
//
//   node tools/receipts.mjs import <fatura.pdf|.txt>... [--apply]   lê (pdftotext -raw), confere o total de cada fatura, liga ao gasto correspondente em Gastos e grava `receipts` + `receipt-lines`
//   node tools/receipts.mjs report [AAAA-MM]                        totais por categoria e por tipo (essencial x flexível), faturas sem gasto ligado
//   node tools/receipts.mjs compare AAAA-MM AAAA-MM                 diferença do mês B sobre o A: quanto veio de PREÇO, de QUANTIDADE e de produtos novos/deixados
//   node tools/receipts.mjs lines AAAA-MM [categoria]               itens do mês (para revisar a categoria)
//   node tools/receipts.mjs set <categoria> <essential|flexible> <trecho do nome>... [--apply]   corrige categoria/tipo dos itens cujo nome contém o trecho (auto:false, a reimportação não desfaz)
//
// Gastos NÃO é alterado: as faturas só detalham o lançamento genérico do mercado. VAULT_URL e VAULT_TOKEN vêm do ambiente
// (ou de ~/.argos-vault.env carregado dentro do comando); o token nunca é escrito nem exibido.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseReceipt, receiptRecords, linkExpenses, summarize, priceVolume, productKey, NEED_OF, UNCAT } from '../lib/receipt.js';

const args = process.argv.slice(2), cmd = args[0], rest = args.slice(1), flags = rest.filter(a => a.startsWith('--')), pos = rest.filter(a => !a.startsWith('--'));
const apply = flags.includes('--apply');
const url = (process.env.VAULT_URL || '').replace(/\/$/, ''), token = process.env.VAULT_TOKEN;
const need = () => { if (!/^https:\/\//.test(url) || !token) { console.error('Defina VAULT_URL (https://...) e VAULT_TOKEN no ambiente.'); process.exit(1); } };
async function call(method, path, body) {
  let res;
  for (let t = 1; t <= 5; t++) {
    try { res = await fetch(url + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); } catch { res = null; }
    if (res && res.status < 500) break;
    await new Promise(r => setTimeout(r, 1000 * t));
  }
  if (!res || !res.ok) throw new Error(`cofre respondeu ${res ? res.status : 'sem rede'} em ${method} ${path}`);
  return res.json();
}
const get = async c => (await call('GET', '/v1/c/' + c)).items;
const post = async (c, items) => { for (let i = 0; i < items.length; i += 200) await call('POST', '/v1/c/' + c, { items: items.slice(i, i + 200) }); };
const eur = n => (n ?? 0).toFixed(2) + ' €';
const dry = () => { console.log('\nSimulação: nada foi enviado. Acrescente --apply para gravar.'); process.exit(0); };
const isMonth = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');
const NEEDS = { essential: 'essencial', flexible: 'flexível', '': '?' };

if (cmd === 'import' && pos.length) {
  need();
  const parsed = [], unreadable = [];
  for (const f of pos) {
    const text = /\.pdf$/i.test(f) ? execFileSync('pdftotext', ['-raw', '-enc', 'UTF-8', f, '-'], { encoding: 'utf8', maxBuffer: 1e8 }) : readFileSync(f, 'utf8');
    const r = parseReceipt(text);
    if (!r || !r.date) unreadable.push(f.split(/[\\/]/).pop()); else parsed.push({ r, file: f.split(/[\\/]/).pop() });
  }
  parsed.sort((a, b) => a.r.date.localeCompare(b.r.date) || a.r.time.localeCompare(b.r.time));
  const expenses = await get('expenses');
  const recs = [...new Map(parsed.map(({ r, file }) => receiptRecords(r, { file })).map(x => [x.receipt.id, x])).values()];   // o mesmo talão baixado duas vezes (ex.: "(1).pdf") vira um só
  const link = linkExpenses(recs.map(x => x.receipt), expenses), byR = new Map(link.pairs.map(p => [p.receiptId, p]));
  let bad = 0;
  console.log('# data hora | loja filial | itens | total pago | conferência | gasto ligado em Gastos');
  for (const { receipt: x } of recs) {
    const p = byR.get(x.id); if (!x.check.ok) bad++;
    console.log([`${x.date} ${x.time}`, `${x.store} ${x.branch}`, x.nLines, eur(x.paid), x.check.ok ? 'OK' : `FALHA (soma ${eur(x.check.sum)})`, p ? `${p.expenseDate} ${p.category}` : 'SEM GASTO'].join(' | '));
    if (p) x.expenseId = p.expenseId;
  }
  const lines = recs.flatMap(x => x.lines);
  const uncat = [...new Set(lines.filter(l => l.category === UNCAT).map(l => l.name))];
  console.log(`\n${recs.length} faturas, ${lines.length} linhas, ${bad} com falha de conferência, ${link.unmatched.length} sem gasto ligado, ${uncat.length} produtos sem categoria${unreadable.length ? `, ${unreadable.length} ilegível(is): ${unreadable.join(', ')}` : ''}.`);
  if (uncat.length) console.log('Sem categoria (classifique em lib/receipt.js ou com `set`):', uncat.join(' | '));
  if (bad) { console.error('Há faturas que não fecham: confira o texto (`pdftotext -raw`) antes de gravar. Nada foi enviado.'); process.exit(1); }
  const s = summarize(lines);
  console.log(`Total ${eur(s.total)} | essencial ${eur(s.need.essential)} | flexível ${eur(s.need.flexible)}`);
  if (!apply) dry();
  const [oldR, oldL] = await Promise.all([get('receipts'), get('receipt-lines')]);
  const keep = new Map(oldL.filter(l => l.auto === false).map(l => [l.id, l]));   // categoria corrigida à mão vence a reimportação
  const outL = lines.map(l => keep.has(l.id) ? { ...l, category: keep.get(l.id).category, need: keep.get(l.id).need, auto: false } : l);
  await post('receipts', recs.map(x => x.receipt)); await post('receipt-lines', outL);
  console.log(`Gravadas ${recs.length} faturas em receipts e ${outL.length} linhas em receipt-lines (já havia ${oldR.length} faturas e ${oldL.length} linhas).`);
} else if (cmd === 'report') {
  need();
  const month = pos[0]; if (month && !isMonth(month)) { console.error('Mês no formato AAAA-MM.'); process.exit(1); }
  const [rc, ln] = await Promise.all([get('receipts'), get('receipt-lines')]);
  const R = rc.filter(r => !month || r.month === month), L = ln.filter(l => !month || l.month === month);
  const months = [...new Set(R.map(r => r.month))].sort();
  for (const m of months) {
    const Rm = R.filter(r => r.month === m), Lm = L.filter(l => l.month === m), s = summarize(Lm);
    console.log(`\n## ${m} | ${Rm.length} faturas | pago ${eur(Rm.reduce((a, r) => a + r.paid, 0))} | linhas ${eur(s.total)} | essencial ${eur(s.need.essential)} (${(100 * s.need.essential / s.total).toFixed(0)}%) | flexível ${eur(s.need.flexible)}${s.need[''] ? ` | sem tipo ${eur(s.need[''])}` : ''}`);
    console.log('categoria | tipo | itens | valor | descontos');
    for (const c of s.categories) console.log([c.category, NEEDS[c.need], c.n, eur(c.net), eur(c.discount)].join(' | '));
    const semGasto = Rm.filter(r => !r.expenseId);
    if (semGasto.length) console.log(`Sem gasto ligado em Gastos: ${semGasto.map(r => `${r.date} ${eur(r.paid)}`).join(', ')}`);
  }
} else if (cmd === 'compare' && isMonth(pos[0]) && isMonth(pos[1])) {
  need();
  const ln = await get('receipt-lines'), A = ln.filter(l => l.month === pos[0]), B = ln.filter(l => l.month === pos[1]);
  if (!A.length || !B.length) { console.error('Sem linhas em um dos meses.'); process.exit(1); }
  const c = priceVolume(A, B), sg = n => (n >= 0 ? '+' : '') + eur(n);
  console.log(`${pos[0]} ${eur(c.totalA)}  ->  ${pos[1]} ${eur(c.totalB)}  (${sg(c.diff)})\n  preço dos mesmos produtos: ${sg(c.price)}\n  quantidade dos mesmos produtos: ${sg(c.volume)}\n  produtos novos: ${sg(c.newProducts)}\n  produtos que deixou de comprar: ${sg(c.dropped)}`);
  console.log('\nmaiores efeitos de preço (produto | qtd A -> B | preço A -> B | efeito preço):');
  for (const x of c.common.slice(0, 15)) console.log([x.name, `${x.qA} -> ${x.qB}`, `${eur(x.pA)} -> ${eur(x.pB)}`, sg(x.priceEffect)].join(' | '));
} else if (cmd === 'lines' && isMonth(pos[0])) {
  need();
  const ln = (await get('receipt-lines')).filter(l => l.month === pos[0] && (!pos[1] || l.category === pos[1])).sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq);
  console.log('data | loja | item | qtd | valor | categoria | tipo');
  for (const l of ln) console.log([l.date, l.store, l.name, l.weightKg != null ? l.weightKg + ' kg' : l.qty, eur(l.net), l.category, NEEDS[l.need]].join(' | '));
} else if (cmd === 'set' && pos.length >= 3) {
  need();
  const [category, n, ...frag] = pos;
  if (!['essential', 'flexible'].includes(n)) { console.error('Tipo: essential ou flexible.'); process.exit(1); }
  if (!NEED_OF[category]) console.log(`Aviso: "${category}" não está na lista de categorias de lib/receipt.js (será gravada mesmo assim).`);
  const keys = frag.map(productKey), ln = await get('receipt-lines');
  const hit = ln.filter(l => keys.some(k => l.pkey.includes(k)) && (l.category !== category || l.need !== n));
  for (const l of hit) console.log(`${l.date} | ${l.name} | ${l.category} ${NEEDS[l.need]} -> ${category} ${NEEDS[n]}`);
  console.log(`${hit.length} linhas.`);
  if (!apply) dry();
  await post('receipt-lines', hit.map(l => ({ ...l, category, need: n, auto: false, updatedAt: Date.now() })));
  console.log('Gravado.');
} else {
  console.error(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n').replace(/^\/\/ ?/gm, ''));
  process.exit(1);
}

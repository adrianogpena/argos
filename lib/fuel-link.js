// Liga cada abastecimento do Carro ao lançamento de Gastos de mesmo valor (0 a 5 dias) e o recategoriza como combustível.
// Serve para postos dentro de supermercado (o banco só traz o nome da loja). Não soma nada: o carro continua fora de Gastos.
const day = s => Date.parse(s + 'T00:00:00Z') / 864e5;
const isFuel = x => x.category === 'Transporte' && x.label === 'Combustível';

export function fuelLinks(fuels, expenses, maxDays = 5) {
  const taken = new Set(), updates = [], missing = [];
  let already = 0;
  for (const f of [...fuels].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const total = Number(f.total);
    if (!(total > 0) || !f.date) continue;
    const near = expenses
      .filter(e => !taken.has(e.id) && Math.abs(e.amount - total) < 0.015 && Math.abs(day(e.date) - day(f.date)) <= maxDays)
      .sort((a, b) => Math.abs(day(a.date) - day(f.date)) - Math.abs(day(b.date) - day(f.date)) || (isFuel(b) - isFuel(a)));
    const e = near[0];
    if (!e) { missing.push(f); continue; }
    taken.add(e.id);
    if (isFuel(e)) { already++; continue; }
    const { auto, motivo, ...rest } = e;
    updates.push({ ...rest, category: 'Transporte', need: 'essential', label: 'Combustível' });
  }
  return { updates, already, missing };
}

/** Abastecimentos do mês (AAAA-MM) ainda sem lançamento de combustível: `toLink` = achou lançamento de outra categoria (rode `fuel`); `missing` = sem lançamento de mesmo valor. */
export function fuelPending(fuels, expenses, month) {
  const { updates, missing } = fuelLinks(fuels, expenses);
  const inMonth = f => String(f.date || '').slice(0, 7) === month;
  const byId = new Map(expenses.map(e => [e.id, e]));
  return { toLink: updates.filter(u => u.date.slice(0, 7) === month).map(u => ({ date: u.date, amount: u.amount, note: u.note, category: byId.get(u.id).category })), missing: missing.filter(inMonth).map(f => ({ date: f.date, total: Number(f.total), station: f.station || '' })) };
}

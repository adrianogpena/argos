// Apresentação da Início (Argos): números prontos para os mostradores e o gráfico. Puro, sem DOM; testado em test/home-view.test.mjs.

export const GAUGE_LEN = 220;   // comprimento do arco do mostrador (raio 70, meia volta)
export const TANK_L = 45;       // capacidade do tanque em litros

/** Valor de stroke-dasharray do mostrador para uma fração 0..1 (fora da faixa ou inválida é limitada). */
export function gaugeDash(frac) {
  const f = Number.isFinite(frac) ? Math.min(1, Math.max(0, frac)) : 0;
  return `${(f * GAUGE_LEN).toFixed(1)} ${GAUGE_LEN}`;
}

/** Quantos dias do mês entram no gráfico: até hoje no mês corrente, o mês inteiro nos passados. */
export function daysShown(month, today) {
  if (today.slice(0, 7) === month) return +today.slice(8, 10);
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Gasto de cada dia do mês (índice 0 = dia 1), de 1 até `days`. */
export function dailyTotals(items, month, days) {
  const out = new Array(days).fill(0);
  for (const x of items) {
    if (!x.date || !x.date.startsWith(month)) continue;
    const d = +x.date.slice(8, 10);
    if (d >= 1 && d <= days) out[d - 1] += x.amount;
  }
  return out;
}

/** Pontos do gráfico de linha (viewBox w x h, base em h - pad). Devolve texto de polyline, de polygon (área), máximo e último ponto. */
export function chartPoints(values, w = 400, h = 100, pad = 8) {
  const n = values.length, max = Math.max(0, ...values), base = h - pad, top = pad;
  const pts = values.map((v, i) => [n > 1 ? +(i / (n - 1) * w).toFixed(1) : w / 2, +(base - (max ? v / max : 0) * (base - top)).toFixed(1)]);
  const line = pts.map(p => p.join(',')).join(' ');
  const area = pts.length ? `${pts[0][0]},${base} ${line} ${pts[pts.length - 1][0]},${base}` : '';
  return { line, area, max, maxDay: max ? values.indexOf(max) + 1 : 0, last: pts[pts.length - 1] || null, base };
}

/** Última leitura do nível do tanque (abastecimento ou leitura do odômetro): { level, date, range } ou null. */
export function lastTank(fuels = [], statuses = []) {
  const all = [...fuels.map(f => ({ ...f, k: 0 })), ...statuses.map(s => ({ ...s, k: 1 }))]
    .filter(x => x.fuelLevel != null && x.fuelLevel >= 0 && x.fuelLevel <= 100 && x.date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.k - b.k);
  const r = all[all.length - 1];
  return r ? { level: r.fuelLevel, date: r.date, liters: r.fuelLevel / 100 * TANK_L, range: r.dashRange ?? null } : null;
}

/** Gastos do banco/cartão com palpite ainda não confirmado (auto), para o aviso "para revisar". */
export const pendingReview = items => items.filter(x => x.auto).length;

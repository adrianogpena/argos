// Aba "Unir" dos ônibus: todos os ônibus de uma parada salva, por horário (não só os das viagens salvas).
// Lógica pura; a busca dos horários é feita por quem chama (createUnir.unirStop).

/** Ids das paradas usadas nas linhas UNIR do setup, sem repetir, na ordem em que aparecem. */
export function savedStops(setup) {
  const seen = new Set(), out = [];
  const add = id => { if (typeof id === 'string' && id && !seen.has(id)) { seen.add(id); out.push(id); } };
  for (const l of setup?.lines || []) {
    if (l.kind !== 'unir') continue;
    for (const r of l.routes || []) { add(r.from); (r.to || []).forEach(add); (r.est || []).forEach(add); }
    add(l.target);
  }
  return out;
}

/** Rótulo da parada: apelido, senão o nome oficial da UNIR, senão o id. */
export function stopLabel(id, names, official) {
  const a = names && typeof names[id] === 'string' ? names[id].trim() : '';
  return a || String(official || '').trim() || id;
}

const hms = t => { const [h, m, s = 0] = String(t).split(':').map(Number); return h * 60 + m + s / 60; };

/**
 * Todos os ônibus de uma parada a partir de `now`, em ordem de horário.
 * `days` = [{ date: 'AAAA-MM-DD', stop }] com `stop` = resposta de get_horarios_prg (horarios[]).
 * Horas além de 24:00 pertencem ao dia de serviço anterior e entram na data certa.
 * Linhas repetidas no mesmo minuto (mesmo trip_id) aparecem uma só vez.
 */
export function stopDepartures(days, now, limit = 40) {
  const seen = new Set(), rows = [];
  for (const { date, stop } of days) {
    const [y, mo, d] = date.split('-').map(Number), base = new Date(y, mo - 1, d).getTime();
    for (const x of stop?.horarios || []) {
      const depAt = base + Math.round(hms(x.chegada) * 60000);
      if (depAt < now) continue;
      const k = `${x.trip_id}@${Math.round(depAt / 60000)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({ tripId: x.trip_id, line: String(x.linha), headsign: String(x.destino || '').trim(), depAt });
    }
  }
  rows.sort((a, b) => a.depAt - b.depAt || a.line.localeCompare(b.line, 'pt', { numeric: true }));
  return rows.slice(0, limit);
}

// Aba "Unir" dos ônibus: todos os ônibus de uma parada salva, por horário (não só os das viagens salvas).
// Lógica pura; a busca dos horários é feita por quem chama (createUnir.unirStop).

/** Ids das paradas usadas nas linhas UNIR do setup, mais as avulsas em `unirStops`, sem repetir, na ordem em que aparecem. */
export function savedStops(setup) {
  const seen = new Set(), out = [];
  const add = id => { if (typeof id === 'string' && id && !seen.has(id)) { seen.add(id); out.push(id); } };
  for (const l of setup?.lines || []) {
    if (l.kind !== 'unir') continue;
    for (const r of l.routes || []) { add(r.from); (r.to || []).forEach(add); (r.est || []).forEach(add); }
    add(l.target);
  }
  (setup?.unirStops || []).forEach(add);   // paradas avulsas, sem viagem salva (setup.unirStops)
  return out;
}

/** Rótulo da parada: apelido, senão o nome oficial da UNIR, senão o id. */
export function stopLabel(id, names, official) {
  const a = names && typeof names[id] === 'string' ? names[id].trim() : '';
  return a || String(official || '').trim() || id;
}

const hms = t => { const [h, m, s = 0] = String(t).split(':').map(Number); return h * 60 + m + s / 60; };

const norm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Todos os ônibus de uma parada (a origem) a partir de `now`, em ordem de horário.
 * `days` = [{ date: 'AAAA-MM-DD', stop }] com `stop` = resposta de get_horarios_prg (horarios[]).
 * Horas além de 24:00 pertencem ao dia de serviço anterior e entram na data certa.
 * Linhas repetidas no mesmo minuto (mesmo trip_id) aparecem uma só vez.
 *
 * `dest` (opcional) = o mesmo formato, para a parada de destino. Cada ônibus ganha:
 *   serves  = para no destino depois da origem (mesmo trip_id no mesmo dia de serviço);
 *   arrAt / rideMin = chegada ao destino e minutos de viagem;
 *   ends    = o destino é o fim da linha (só lista partidas, sem horário de chegada): serve, mas sem hora.
 * Quem não serve continua na lista (serves:false); a tela só o esmaece.
 */
export function stopDepartures(days, now, limit = 10, dest = null) {
  const seen = new Set(), rows = [];
  const destAt = new Map(), destName = norm(dest?.find(d => d.stop?.designa)?.stop.designa);
  for (const { date, stop } of dest || []) for (const x of stop?.horarios || []) destAt.set(`${date}|${x.trip_id}`, hms(x.chegada));
  for (const { date, stop } of days) {
    const [y, mo, d] = date.split('-').map(Number), base = new Date(y, mo - 1, d).getTime();
    for (const x of stop?.horarios || []) {
      const depAt = base + Math.round(hms(x.chegada) * 60000);
      if (depAt < now) continue;
      const k = `${x.trip_id}@${Math.round(depAt / 60000)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const row = { tripId: x.trip_id, line: String(x.linha), headsign: String(x.destino || '').trim(), depAt };
      if (dest) {
        const t = destAt.get(`${date}|${x.trip_id}`);
        if (t != null && t > hms(x.chegada)) Object.assign(row, { serves: true, arrAt: base + Math.round(t * 60000), rideMin: Math.round(t - hms(x.chegada)) });
        else if (!destAt.has(`${date}|${x.trip_id}`) && destName && norm(x.destino) === destName) Object.assign(row, { serves: true, ends: true });
        else row.serves = false;
      }
      rows.push(row);
    }
  }
  rows.sort((a, b) => a.depAt - b.depAt || a.line.localeCompare(b.line, 'pt', { numeric: true }));
  return rows.slice(0, limit);
}

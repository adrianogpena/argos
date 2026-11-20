// "Próximo ônibus" da home: puro, sem DOM. A rede entra por funções injetadas, então é testável em Node.
// `setup` é o estado guardado no cofre (coleção bus-setup, registro "setup"): { lines: [...] }.
import Core from './bus-core.js';

/** Linhas que a home acompanha: UNIR (horário) e STCP com parada definida. O exemplo que vem de fábrica fica de fora. */
export function busTargets(setup) {
  const out = [];
  for (const l of (setup && setup.lines) || []) {
    if (l.example) continue;
    if (l.kind === 'unir') { if (Array.isArray(l.routes) && l.routes.length) out.push({ kind: 'unir', line: l }); continue; }
    const d = l.dirs && (l.dirs[l.activeDir] || l.dirs[0]);
    const stop = d && d.stops && d.stops.find(s => s.id === d.myStop);
    if (stop) out.push({ kind: 'stcp', line: l, dir: d, stop });
  }
  return out;
}

/**
 * Uma linha de resultado por alvo. Falha de um não derruba os outros (`err: true`).
 * fetchStcp(stopId) -> resposta /realtime;  unirUpcoming(line) -> Core.unirNext(...).
 */
export async function nextBuses(setup, { fetchStcp, unirUpcoming }, now = Date.now()) {
  const targets = busTargets(setup);
  const res = await Promise.allSettled(targets.map(async t => {
    if (t.kind === 'unir') {
      const list = await unirUpcoming(t.line);
      const o = list.find(x => !x.beaten) || list[0];
      const label = t.line.name || t.line.short;
      if (!o) return { kind: 'unir', label, empty: true };
      return { kind: 'unir', label, line: o.line, depAt: o.depAt, minutes: Math.max(0, Math.round((o.depAt - now) / 60000)), to: o.toName, doneAt: o.doneAt, arrive: t.line.arrive || '', est: !!o.est };
    }
    const j = await fetchStcp(t.stop.id);
    const mins = [...Core.lineArrivals(j && j.arrivals, t.line.short).values()].map(a => a._m).sort((a, b) => a - b).slice(0, 2);
    return { kind: 'stcp', label: `${t.line.short} → ${t.dir.name || ''}`.trim(), line: t.line.short, stop: t.stop.name || t.stop.code || '', minutesList: mins, empty: !mins.length };
  }));
  return res.map((r, i) => r.status === 'fulfilled' ? r.value : { kind: targets[i].kind, label: targets[i].line.name || targets[i].line.short, err: true });
}

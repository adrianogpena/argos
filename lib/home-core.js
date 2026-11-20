// Resumo da home do Argos: puro, sem DOM, testável em Node.
import { summary, reminders } from './car-core.js';
import { monthTotal, delta, withCar } from './expenses-core.js';

/** { month, total, delta, reminders } a partir dos registros do cofre. `today` é 'AAAA-MM-DD'. */
export function homeSummary({ expenses = [], fuels = [], services = [], statuses = [] }, today) {
  const month = today.slice(0, 7), items = withCar(expenses, fuels, services);
  const odo = (fuels.length || services.length || statuses.length) ? summary(fuels, services, statuses).lastOdo : 0;
  const rem = reminders(services, odo, today).filter(r => r.state !== 'ok');
  return { month, total: monthTotal(items, month), delta: delta(items, month), reminders: rem };
}

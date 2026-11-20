// Client for the private vault Worker (vault/worker.js).
// The URL and the token live only in this browser's localStorage, never in the repository.
// Records are cached on this device so the app opens offline; edits made offline are queued and sent later.

export class VaultError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }   // 'auth' | 'network' | 'server' | 'config'
}

const memoryStorage = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), keys: () => [...m.keys()] }; };

export function createVault({ storage, fetchFn } = {}) {
  const store = storage || (() => { try { const s = globalThis.localStorage; return { getItem: k => s.getItem(k), setItem: (k, v) => s.setItem(k, v), removeItem: k => s.removeItem(k), keys: () => Object.keys(s) }; } catch (e) { return memoryStorage(); } })();
  const doFetch = fetchFn || ((...a) => globalThis.fetch(...a));
  const P = 'vault.';
  const read = (k, d) => { try { const v = JSON.parse(store.getItem(P + k)); return v ?? d; } catch (e) { return d; } };
  const write = (k, v) => { try { store.setItem(P + k, JSON.stringify(v)); } catch (e) {} };

  const config = () => ({ url: String(read('url', '')).replace(/\/+$/, ''), token: read('token', '') });
  const configured = () => { const c = config(); return !!(c.url && c.token); };
  function configure(url, token) { write('url', String(url || '').trim().replace(/\/+$/, '')); write('token', String(token || '').trim()); }

  async function call(method, path, body) {
    const { url, token } = config();
    if (!url || !token) throw new VaultError('config', 'Vault not set up');
    let res;
    try {
      res = await doFetch(url + path, { method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { throw new VaultError('network', 'Cannot reach the vault'); }
    if (res.status === 401) throw new VaultError('auth', 'Wrong token');
    if (res.status === 429) throw new VaultError('auth', 'Too many wrong attempts, wait 15 minutes');
    if (!res.ok) throw new VaultError('server', `Vault answered ${res.status}`);
    return res.json();
  }

  const queue = () => read('queue', []);
  const setQueue = q => write('queue', q);

  async function flush() {
    let q = queue();
    while (q.length) {
      const op = q[0];
      await call(op.method, `/v1/c/${op.col}/${op.id}`, op.record);   // throws on network/auth error and keeps the queue
      const cached = read('cache.' + op.col, []).filter(r => r.id !== op.id);   // keep the offline copy in step
      write('cache.' + op.col, op.method === 'DELETE' ? cached : [...cached, op.record]);
      q = q.slice(1); setQueue(q);
    }
  }

  // Apply queued edits on top of the server copy, so the screen shows what the user did even before it is sent.
  function overlay(items, col) {
    const map = new Map(items.map(r => [r.id, r]));
    for (const op of queue()) if (op.col === col) { if (op.method === 'DELETE') map.delete(op.id); else map.set(op.id, op.record); }
    return [...map.values()];
  }

  async function list(col) {
    try { await flush(); } catch (e) { if (e.kind === 'auth' || e.kind === 'config') throw e; }
    try {
      const d = await call('GET', `/v1/c/${col}`);
      write('cache.' + col, d.items);
      return { items: overlay(d.items, col), stale: queue().length > 0 };
    } catch (e) {
      if (e.kind !== 'network') throw e;
      return { items: overlay(read('cache.' + col, []), col), stale: true };
    }
  }

  async function mutate(col, id, method, record) {
    const q = queue().filter(o => !(o.col === col && o.id === id));
    q.push({ col, id, method, record });
    setQueue(q);
    try { await flush(); return { sent: true }; }
    catch (e) { if (e.kind === 'network') return { sent: false }; throw e; }
  }
  const put = (col, record) => mutate(col, record.id, 'PUT', record);
  const del = (col, id) => mutate(col, id, 'DELETE');

  // Grava muitos registros de uma vez (importação de extrato). Precisa de rede: não entra na fila offline.
  async function putMany(col, records) {
    await flush();
    let n = 0;
    for (let i = 0; i < records.length; i += 200) {
      const part = records.slice(i, i + 200);
      await call('POST', `/v1/c/${col}`, { items: part });
      const ids = new Set(part.map(r => r.id));
      write('cache.' + col, [...read('cache.' + col, []).filter(r => !ids.has(r.id)), ...part]);
      n += part.length;
    }
    return { sent: true, n };
  }

  const ping = () => call('GET', '/v1/ping');
  const pending = () => queue().length;

  // Remove everything this browser keeps (token, cache, queue). Server data is untouched.
  function forget() { for (const k of (store.keys ? store.keys() : [])) if (k.startsWith(P)) store.removeItem(k); }

  return { configure, configured, config, ping, list, put, putMany, del, flush, pending, forget };
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

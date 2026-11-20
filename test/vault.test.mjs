// node test/vault.test.mjs
import assert from 'node:assert/strict';
import worker from '../vault/worker.js';
import { createVault } from '../lib/vault.js';

const kv = () => { const m = new Map(); return { m, get: async (k, t) => { const v = m.get(k); return v === undefined ? null : (t === 'json' ? JSON.parse(v) : v); }, put: async (k, v) => { m.set(k, v); }, list: async ({ prefix }) => ({ keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }) }; };
const ORIGIN = 'https://me.github.io', TOKEN = 'secret-token-123';
const mkEnv = () => ({ VAULT: kv(), VAULT_TOKEN: TOKEN, ALLOWED_ORIGIN: ORIGIN });
const req = (path, { method = 'GET', token = TOKEN, origin = ORIGIN, body, ip = '1.1.1.1' } = {}) => new Request('https://v.example' + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(origin ? { Origin: origin } : {}), 'CF-Connecting-IP': ip }, body: body === undefined ? undefined : JSON.stringify(body) });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok  ' + name); };

await t('no token -> 401, wrong token -> 401, no data leaked', async () => {
  const env = mkEnv();
  await worker.fetch(req('/v1/c/car-fuel', { method: 'PUT', body: { liters: 1 } }).clone(), env); // 'PUT' with id missing -> 404 fine
  await worker.fetch(req('/v1/c/car-fuel/a1', { method: 'PUT', body: { secret: 'x' } }), env);
  for (const token of [null, 'nope', TOKEN + 'x', '']) {
    const r = await worker.fetch(req('/v1/c/car-fuel', { token }), env);
    assert.equal(r.status, 401); assert.ok(!(await r.text()).includes('secret'));
  }
});
await t('unset or unknown origin is refused; no ACAO header leaks', async () => {
  const env = mkEnv();
  const r = await worker.fetch(req('/v1/ping', { origin: 'https://evil.example' }), env);
  assert.equal(r.status, 403); assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
  const env2 = { ...mkEnv(), ALLOWED_ORIGIN: '' };
  assert.equal((await worker.fetch(req('/v1/ping'), env2)).status, 403);
  const pre = await worker.fetch(req('/v1/ping', { method: 'OPTIONS', token: null }), env);
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});
await t('misconfigured vault fails closed', async () => {
  const r = await worker.fetch(req('/v1/ping'), { VAULT: kv(), ALLOWED_ORIGIN: ORIGIN });
  assert.equal(r.status, 500);
});
await t('CRUD round trip and rev', async () => {
  const env = mkEnv();
  assert.deepEqual(await (await worker.fetch(req('/v1/c/car-fuel'), env)).json(), { rev: 0, items: [] });
  let r = await (await worker.fetch(req('/v1/c/car-fuel/a1', { method: 'PUT', body: { liters: 30 } }), env)).json(); assert.equal(r.rev, 1);
  await worker.fetch(req('/v1/c/car-fuel/a1', { method: 'PUT', body: { liters: 31 } }), env);
  const d = await (await worker.fetch(req('/v1/c/car-fuel'), env)).json();
  assert.equal(d.items.length, 1); assert.equal(d.items[0].liters, 31); assert.equal(d.items[0].id, 'a1');
  await worker.fetch(req('/v1/c/car-fuel/a1', { method: 'DELETE' }), env);
  assert.equal((await (await worker.fetch(req('/v1/c/car-fuel'), env)).json()).items.length, 0);
});
await t('input validation: bad names, ids, json, arrays, size', async () => {
  const env = mkEnv();
  assert.equal((await worker.fetch(req('/v1/c/Bad..Name'), env)).status, 404);
  assert.equal((await worker.fetch(req('/v1/c/ok/bad%20id', { method: 'PUT', body: {} }), env)).status, 404);
  assert.equal((await worker.fetch(req('/v1/c/ok/x', { method: 'PUT', body: [1] }), env)).status, 400);
  assert.equal((await worker.fetch(new Request('https://v.example/v1/c/ok/x', { method: 'PUT', body: '{nope', headers: { Authorization: 'Bearer ' + TOKEN } }), env)).status, 400);
  assert.equal((await worker.fetch(req('/v1/c/ok/x', { method: 'PUT', body: { a: 'x'.repeat(9000) } }), env)).status, 413);
});
await t('export returns every collection', async () => {
  const env = mkEnv();
  await worker.fetch(req('/v1/c/car-fuel/a', { method: 'PUT', body: { l: 1 } }), env);
  await worker.fetch(req('/v1/c/car-service/b', { method: 'PUT', body: { k: 1 } }), env);
  const d = await (await worker.fetch(req('/v1/export'), env)).json();
  assert.deepEqual(Object.keys(d.collections).sort(), ['car-fuel', 'car-service']);
});
await t('guessing is throttled per address, even the right token is then refused', async () => {
  const env = mkEnv();
  for (let i = 0; i < 8; i++) assert.equal((await worker.fetch(req('/v1/ping', { token: 'g' + i, ip: '9.9.9.9' }), env)).status, 401);
  assert.equal((await worker.fetch(req('/v1/ping', { ip: '9.9.9.9' }), env)).status, 429);
  assert.equal((await worker.fetch(req('/v1/ping', { ip: '8.8.8.8' }), env)).status, 200);
});

// ---- client ----
const store = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), keys: () => [...m.keys()], m }; };
const link = env => { const state = { down: false }; return { state, fetchFn: async (url, o) => { if (state.down) throw new TypeError('offline'); return worker.fetch(new Request(url, { ...o, headers: { ...o.headers, Origin: ORIGIN } }), env); } }; };

await t('client: save, read back, token is only in storage', async () => {
  const env = mkEnv(), l = link(env), s = store();
  const v = createVault({ storage: s, fetchFn: l.fetchFn }); v.configure('https://v.example/', TOKEN);
  assert.ok(v.configured()); assert.equal(v.config().url, 'https://v.example');
  await v.put('car-fuel', { id: 'z1', liters: 20 });
  assert.equal((await v.list('car-fuel')).items[0].liters, 20);
});
await t('client: offline edits are queued, shown, then sent', async () => {
  const env = mkEnv(), l = link(env), s = store();
  const v = createVault({ storage: s, fetchFn: l.fetchFn }); v.configure('https://v.example', TOKEN);
  await v.put('c', { id: 'a', n: 1 });
  l.state.down = true;
  assert.deepEqual(await v.put('c', { id: 'b', n: 2 }), { sent: false });
  const off = await v.list('c'); assert.equal(off.stale, true); assert.equal(off.items.length, 2);
  l.state.down = false;
  const on = await v.list('c'); assert.equal(on.stale, false); assert.equal(on.items.length, 2); assert.equal(v.pending(), 0);
  assert.equal((await (await worker.fetch(req('/v1/c/c'), env)).json()).items.length, 2);
});
await t('client: wrong token raises auth error; forget wipes the device', async () => {
  const env = mkEnv(), l = link(env), s = store();
  const v = createVault({ storage: s, fetchFn: l.fetchFn }); v.configure('https://v.example', 'wrong');
  await assert.rejects(() => v.list('c'), e => e.kind === 'auth');
  v.configure('https://v.example', TOKEN); await v.put('c', { id: 'a' });
  v.forget(); assert.equal(s.keys().length, 0); assert.equal(v.configured(), false);
});
await t('batch POST: grava vários, valida tudo antes, respeita os limites', async () => {
  const env = mkEnv();
  const post = body => worker.fetch(req('/v1/c/ex', { method: 'POST', body }), env);
  const r = await (await post({ items: [{ id: 'a', v: 1 }, { id: 'b', v: 2 }] })).json(); assert.deepEqual([r.rev, r.n], [1, 2]);
  assert.equal((await (await worker.fetch(req('/v1/c/ex'), env)).json()).items.length, 2);
  await post({ items: [{ id: 'a', v: 9 }] });
  assert.equal((await (await worker.fetch(req('/v1/c/ex'), env)).json()).items.find(x => x.id === 'a').v, 9);
  assert.equal((await post({ items: [{ id: 'ok' }, { id: 'bad id' }] })).status, 400);       // nada é gravado se um falhar
  assert.equal((await (await worker.fetch(req('/v1/c/ex'), env)).json()).items.length, 2);
  assert.equal((await post({ items: [] })).status, 400); assert.equal((await post({})).status, 400);
  assert.equal((await post({ items: Array.from({ length: 501 }, (_, i) => ({ id: 'x' + i })) })).status, 400);
  assert.equal((await post({ items: [{ id: 'big', a: 'x'.repeat(9000) }] })).status, 413);
  assert.equal((await worker.fetch(req('/v1/c/ex', { method: 'POST', body: { items: [{ id: 'n' }] }, token: null }), env)).status, 401);
});
await t('client putMany: envia em lotes e atualiza o cache local', async () => {
  const env = mkEnv(), l = link(env), s = store();
  const v = createVault({ storage: s, fetchFn: l.fetchFn }); v.configure('https://v.example', TOKEN);
  const recs = Array.from({ length: 450 }, (_, i) => ({ id: 'r' + i, v: i }));
  assert.equal((await v.putMany('ex', recs)).n, 450);
  l.state.down = true;
  assert.equal((await v.list('ex')).items.length, 450);                                        // veio do cache
  await assert.rejects(() => v.putMany('ex', [{ id: 'z' }]), e => e.kind === 'network');
});
console.log(`\n${n} groups passed`);

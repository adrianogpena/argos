// Private data vault: a Cloudflare Worker + one KV namespace.
//
// The app (public, on Cloudflare Pages) holds no data. Personal records live here and are only
// served to a caller that sends the secret token:  Authorization: Bearer <VAULT_TOKEN>
//
// Secrets and bindings (never in the repository):
//   VAULT_TOKEN      secret   `npx wrangler secret put VAULT_TOKEN`
//   VAULT            KV       namespace binding, see wrangler.toml
//   ALLOWED_ORIGIN   var      exact origin(s) of the app, comma separated. No default: unset = every browser call is refused.
//
// API (all JSON, all need the token):
//   GET    /v1/ping                      -> {ok:true}
//   GET    /v1/c/:collection             -> {rev, items:[...]}
//   PUT    /v1/c/:collection/:id         body = the record  -> {rev}
//   DELETE /v1/c/:collection/:id         -> {rev}
//   POST   /v1/c/:collection             body = {items:[record,...]} (até 500, cada um com id) -> {rev, n}   (importações)
//   GET    /v1/export                    -> {collections:{name:[...]}}   (backup)

const COLLECTION = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_BODY = 8 * 1024;          // one record
const MAX_BATCH = 500, MAX_BATCH_BODY = 1024 * 1024;   // import em lote: registros e bytes por chamada
const MAX_ITEMS = 20000;            // per collection
const MAX_FAILS = 8, FAIL_WINDOW = 900;   // failed tokens per client per 15 min

const enc = new TextEncoder();

// Compare without leaking where the strings differ: hash both, then compare the digests.
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([a, b].map(async s => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))));
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

function corsFor(request, env) {
  const origin = request.headers.get('Origin') || '';
  const list = String(env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = origin && list.includes(origin);
  return {
    ok, origin,
    headers: {
      ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    },
  };
}

export default {
  async fetch(request, env) {
    const cors = corsFor(request, env);
    const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
      status, headers: { ...cors.headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: cors.ok ? 204 : 403, headers: cors.headers });
    // A browser from any other site is refused before the token is even looked at.
    if (cors.origin && !cors.ok) return json({ error: 'origin not allowed' }, 403);

    if (!env.VAULT_TOKEN || !env.VAULT) return json({ error: 'vault is not configured' }, 500);

    // Throttle guessing, per client address.
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const failKey = 'fail:' + ip;
    const fails = Number(await env.VAULT.get(failKey)) || 0;
    if (fails >= MAX_FAILS) return json({ error: 'too many attempts, try later' }, 429, { 'Retry-After': String(FAIL_WINDOW) });

    const m = /^Bearer (.{1,256})$/.exec(request.headers.get('Authorization') || '');
    if (!m || !(await sameSecret(m[1], env.VAULT_TOKEN))) {
      await env.VAULT.put(failKey, String(fails + 1), { expirationTtl: FAIL_WINDOW });
      return json({ error: 'unauthorized' }, 401);
    }

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);        // ['v1','c',name,id]
    if (parts[0] !== 'v1') return json({ error: 'not found' }, 404);

    if (parts[1] === 'ping' && parts.length === 2 && request.method === 'GET') return json({ ok: true });

    if (parts[1] === 'export' && parts.length === 2 && request.method === 'GET') {
      const out = {};
      let cursor;
      do {
        const page = await env.VAULT.list({ prefix: 'c:', cursor });
        for (const k of page.keys) { const d = await env.VAULT.get(k.name, 'json'); out[k.name.slice(2)] = d ? Object.values(d.items) : []; }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return json({ collections: out });
    }

    if (parts[1] === 'c' && COLLECTION.test(parts[2] || '')) {
      const key = 'c:' + parts[2];
      const doc = (await env.VAULT.get(key, 'json')) || { rev: 0, items: {} };

      if (parts.length === 3 && request.method === 'GET') return json({ rev: doc.rev, items: Object.values(doc.items) });

      if (parts.length === 3 && request.method === 'POST') {
        const text = await request.text();
        if (text.length > MAX_BATCH_BODY) return json({ error: 'batch too large' }, 413);
        let body; try { body = JSON.parse(text); } catch (e) { return json({ error: 'bad json' }, 400); }
        const list = body && body.items;
        if (!Array.isArray(list) || !list.length || list.length > MAX_BATCH) return json({ error: 'items must be 1..' + MAX_BATCH + ' records' }, 400);
        for (const r of list) {
          if (!r || typeof r !== 'object' || Array.isArray(r) || !ID.test(String(r.id))) return json({ error: 'each record needs a valid id' }, 400);
          if (JSON.stringify(r).length > MAX_BODY) return json({ error: 'record too large' }, 413);
        }
        const fresh = new Set(list.map(r => r.id).filter(id => !(id in doc.items)));
        if (Object.keys(doc.items).length + fresh.size > MAX_ITEMS) return json({ error: 'collection full' }, 413);
        const now = Date.now();
        for (const r of list) doc.items[r.id] = { ...r, updatedAt: now };
        doc.rev += 1;
        await env.VAULT.put(key, JSON.stringify(doc));
        return json({ rev: doc.rev, n: list.length });
      }

      if (parts.length === 4 && ID.test(parts[3])) {
        const id = parts[3];
        if (request.method === 'PUT') {
          const text = await request.text();
          if (text.length > MAX_BODY) return json({ error: 'record too large' }, 413);
          let rec; try { rec = JSON.parse(text); } catch (e) { return json({ error: 'bad json' }, 400); }
          if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return json({ error: 'record must be an object' }, 400);
          if (!(id in doc.items) && Object.keys(doc.items).length >= MAX_ITEMS) return json({ error: 'collection full' }, 413);
          doc.items[id] = { ...rec, id, updatedAt: Date.now() };
        } else if (request.method === 'DELETE') {
          delete doc.items[id];
        } else return json({ error: 'method not allowed' }, 405);
        doc.rev += 1;
        await env.VAULT.put(key, JSON.stringify(doc));
        return json({ rev: doc.rev });
      }
    }
    return json({ error: 'not found' }, 404);
  },
};

# Argos

A personal dashboard (buses, car, expenses). The bus module follows Porto STCP bus lines. You set your stop, and it shows the next one to three buses on their way to it, how many stops away each one is, and how late it is. Positions are inferred from STCP's arrival estimates, because the API publishes no GPS.

```
index.html             home: summary (month spending, car reminders) and links to the modules
transporte.html            bus module: one file, no build step
manifest.webmanifest   home-screen install (optional)
sw.js                  offline app shell (optional; works over https or localhost only)
icon.svg / icon-*.png  icons
proxy/worker.js        Cloudflare Worker that adds CORS (free tier)
proxy/wrangler.toml    config for the Worker
proxy/local_proxy.py   local alternative to the Worker: Python, standard library only
test/core.test.mjs     tests for the bus-locating logic: node test/core.test.mjs
carro.html             car log (fuel, services, reminders); its data lives in the private vault
lib/                   vault client and car maths (ES modules)
vault/                 private data vault: Cloudflare Worker + KV, token protected. See vault/README.md
gastos.html            expenses with monthly and per-category charts (view/edit only; statements are loaded by Claude with the importar-extrato skill)
lib/classify.js        merchant key and deterministic ids for statement entries; tools/expenses.mjs pushes them to the vault
cartao.html            credit-card forecast: future installments with no new purchases, payoff date, increase vs paydown per statement (lib/card-forecast.js)
saude.html             weight and height of people and pets; data in the vault (health-members, health-measures)
lib/home-core.js       home summary maths
test/*.test.mjs        vault, car, expenses and home tests (node test/<name>.test.mjs)
```

## 1. Check whether you need a proxy

Phone browsers only let a page call stcp.pt directly if stcp.pt sends CORS headers. I couldn't test that from where this was built, so the app checks it for you:

- Open the app. If arrivals load, you don't need a proxy.
- If a red **Blocked by the browser** box appears, the browser refused the request, almost certainly because of CORS. Set up one of the two proxies below. It takes about five minutes.

Settings → **Test connection** checks every API address and tells you which one works.

## 2. Put it on your phone

Phones won't run a downloaded HTML file properly, so the app needs to be served from somewhere. Pick one option.

**A. Cloudflare Pages + Cloudflare Worker (free, works anywhere, recommended)**

Cloudflare Pages, not GitHub Pages: every `*.github.io` site of one user shares an origin, and so `localStorage`, where the vault token lives. On Pages, Argos gets its own origin (`https://argos-ejb.pages.dev` or similar).

1. Dashboard → Workers & Pages → Create → Pages → Connect to Git → pick this repository. Framework preset: *None*; build command empty; output directory `/`.
2. After the first deploy the app is at `https://<project>.pages.dev`. Put that origin (scheme + domain, no path) in `ALLOWED_ORIGIN` in `vault/wrangler.toml` and `proxy/wrangler.toml`, and redeploy both Workers.
3. On `pages.dev` the app uses the Worker named by `PAGES_PROXY` in `transporte.html` (`https://argos-proxy.<your-subdomain>.workers.dev`). Adjust it if your Worker URL differs, or open `https://<project>.pages.dev/transporte.html?api=<worker url>` once: the `?api=` value is saved.

**B. Your own computer on home Wi-Fi (no accounts)**

```
python3 proxy/local_proxy.py
```

On your phone, open `http://<your-computer's-IP>:8787` (on a Mac, find the IP under System Settings → Wi-Fi → Details). The local proxy serves the app and forwards the API, so CORS isn't an issue. This only works while the computer is on and you're on the same network. The service worker won't run over plain http on a LAN IP, so you get no offline shell with this option. Everything else works.

## 3. Proxy setup (only if CORS blocks direct calls)

The proxies forward only these read-only paths: `/api/stops/{id}`, `/api/stops/{id}/realtime`, `/api/stops/{id}/routes`, `/api/route/{id}/stops/direction?direction_id=0|1` and `/api/route/{id}/services`. Any other path gets a 404. Realtime answers are cached for 20 s and stop lists for an hour, so two devices refreshing at once don't double the load on STCP.

**Cloudflare Worker, dashboard only (no command line):**

1. Sign up at dash.cloudflare.com (free plan).
2. Workers & Pages → Create → Create Worker → name it `argos-proxy` → Deploy.
3. Edit code → replace everything with the contents of `proxy/worker.js` → Deploy.
4. Optional but recommended: Settings → Variables → add `ALLOWED_ORIGIN` = `https://<project>.pages.dev`, so only your app can use the proxy.
5. Copy the Worker URL (`https://argos-proxy.YOURNAME.workers.dev`) and paste it in Argos → Settings → API address → Test connection.

**Cloudflare Worker, command line:** `cd proxy && npx wrangler deploy`. Edit `ALLOWED_ORIGIN` in `wrangler.toml` first.

**Local Python proxy:** see 2B. Use `--port` to change the port. On macOS, if Python reports a certificate error, run *Install Certificates.command* from your Python folder once.

## 4. Add to home screen

- **iPhone (Safari):** open the app → Share → *Add to Home Screen*.
- **Android (Chrome):** open the app → ⋮ menu → *Add to Home screen* / *Install app*.

It then opens full screen like an app. With option A, the app shell is cached, so it opens offline and shows an *Offline* message until you reconnect.

## 5. Using it

- **Set your stop:** tap a stop in the timeline → *Set as my stop*.
- **Add a line:** + Add line.
  - *From STCP:* enter the line number and the code of any stop on it (e.g. line number + any stop code). The app finds the internal `route_id` through `/api/stops/<code>/routes` and then loads both directions. If you already know the route_id, you can enter it directly. stcp.pt/pt/linhas no longer puts route_ids in its HTML; to find one, open the line page with your browser's developer tools on the Network tab and look for a request to `/api/route/ID/stops`.
  - *Paste stops:* one stop per line, in order. `CODE Name`, `Name CODE`, `Name (CODE)` and the comma-separated format from your brief all work. A preview shows what was recognised.
- **Settings:** buses to follow (1–3), refresh interval (30 s minimum), how many stops back the app may poll, when a bus counts as not started (5, 10 or 15 min to its next stop), theme, API address, and copy/paste of your whole setup to move it to another device.

## How a bus is located

1. Fetch `/realtime` for **your stop**. Keep only arrivals for this line (`route_short_name`), drop negative minutes (buses that already passed), merge duplicate rows per `trip_id`, and take the soonest 1–3. Those are the buses being followed.
2. Walk **backwards** from your stop toward the start of the line, 3 stops at a time. A bus that has already passed a stop isn't listed there, so the first stop that doesn't list a trip is behind the bus. The walk stops as soon as every followed bus has been placed. With 1 bus followed that's usually 2–5 requests per refresh, never more than *Look back at most* + 1.
3. Then walk **forward** from your stop, 3 stops at a time and at most 6 stops, until a stop lists a trip your stop no longer lists. That's the last bus that passed, shown as a grey *Passed* marker. This adds 3 requests per refresh, or 6 when no bus passed recently.
4. A bus's **next stop** is the stop with its smallest `arrival_minutes` ≥ 0 among the consecutive stops that list it. The marker is drawn on the rail just above that stop.
5. States:
   - **At the first stop:** the first stop still lists the trip, so the bus hasn't left yet.
   - **Not started yet:** the bus's next stop is more than 10 minutes away. A real bus is never that far from the next stop, so this is a timetable entry with no bus behind it yet. This is how your "only listed at the last stops = not started" rule is generalised.
   - **N+ stops away:** the bus is beyond the look-back limit.

Polling pauses while the app is hidden and resumes when you return. Any failure (blocked, timeout, HTTP error, unexpected JSON) shows a clear error with *Try again*. If one stop fails mid-walk, the app shows the buses it could place and notes which stop it couldn't check.

## UNIR trips (timetable only)

UNIR (Área Metropolitana do Porto) buses publish planned times only, no positions or delays, so these tabs show the timetable from `paragens.amp.pt/acarto2/get_horarios_prg`. That API allows browser calls, so no proxy is needed.

Trips are personal (they reveal where you live and go), so **none ship in this repository**. Your trips live in your setup, which you keep in the private vault: Settings → *Save setup to vault* / *Load setup from vault*. The shape of a trip is documented above `unirDefaults()` in `index.html`.

- A trip is one or more routes, each from one stop to any of several stops. Every bus listed at the start stop and later at one of the end stops counts. The tab shows the next 6 buses by departure, from today or the following days.
- A trip with a `target` adds the walk from the drop-off stop to it: straight line + 30 %, at 80 m/min. **best** is the earliest arrival; **later is faster** marks a bus that a later one beats.
- The last stop of a line lists no arrivals. When a route ends at a terminus, the arrival is estimated from the ride in the other direction (`est`) and marked ≈.
- Each stop's timetable is fetched once per day and kept in `localStorage`.

## Tests

`node test/core.test.mjs` runs the logic from `transporte.html` (the `<script id="core">` block) against sample `/realtime` responses in the documented shape. Those responses are built by hand, not captured from STCP. The test cases cover trip_id grouping, other lines mixed in, a bus that already passed, duplicate rows, a bus waiting at the first stop, a timetable-only trip, the look-back limit, a failing stop, request counts, and the paste parser.

## Etiquette and caveats

This is for personal use. It sends one request per stop per refresh, every 30 s or slower, and only for the stops it needs. It doesn't store or redistribute STCP data. The API is unofficial and undocumented, so field names can change; when the app gets something unexpected, it says so instead of showing wrong buses. If a busy stop caps how many arrivals it lists, a bus missing from that list may just be cut off. When a list has 8 or more rows and ends before the time the bus would be due, the app does not take the missing bus as passed: it looks one stop further back, and the passed-bus marker ignores it.

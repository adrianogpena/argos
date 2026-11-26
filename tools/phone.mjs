#!/usr/bin/env node
// Abre o Argos numa janela sem borda (modo app do Chrome/Edge) com o tamanho do Samsung Galaxy M55 (412x915 px CSS).
// Uso: node tools/phone.mjs [pagina] [--landscape] [--port 8123]
//   ex.: npm run phone:gastos
// Fechar a janela encerra o servidor. O perfil do navegador é fixo, então o token do cofre
// digitado uma vez continua salvo nas próximas execuções.
import http from 'node:http';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const landscape = args.includes('--landscape');
const portIdx = args.indexOf('--port');
const port = portIdx >= 0 ? Number(args[portIdx + 1]) : 8123;
const page = args.find((a, i) => !a.startsWith('--') && i !== portIdx + 1) || 'index.html';

const W = landscape ? 915 : 412;
const H = landscape ? 412 : 915;
const TITLE_BAR = 32; // a janela em modo app inclui a barra de título
const url = `http://localhost:${port}/${page}`;

const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const browser = candidates.find((c) => existsSync(c));
if (!browser) {
  console.error('Chrome ou Edge não encontrado.');
  process.exit(1);
}

// O Worker do cofre só aceita a origem do site publicado (CORS). Aqui o servidor repassa /v1/* ao cofre,
// então na página basta usar http://localhost:PORTA como endereço do cofre (o token é o de sempre).
let envFile = '';
try { envFile = readFileSync(join(homedir(), '.argos-vault.env'), 'utf8'); } catch {}
const fromEnv = (k) => (process.env[k] || (envFile.match(new RegExp('^' + k + '=(.+)$', 'm')) || [])[1] || '').trim().replace(/^["']|["']$/g, '');
const vaultUrl = fromEnv('VAULT_URL').replace(/\/+$/, '');
const vaultToken = fromEnv('VAULT_TOKEN');
// Grava o endereço (este servidor) e o token no localStorage da página, só no navegador local; nada é impresso.
const seed = vaultUrl && vaultToken
  ? `<script>try{localStorage.setItem('vault.url',${JSON.stringify(JSON.stringify('http://localhost:' + port))});localStorage.setItem('vault.token',${JSON.stringify(JSON.stringify(vaultToken))})}catch(e){}</script>`
  : '';

async function proxy(req, res, path) {
  if (!vaultUrl) { res.writeHead(502); return res.end('VAULT_URL não definido'); }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = {};
  for (const h of ['authorization', 'content-type']) if (req.headers[h]) headers[h] = req.headers[h];
  try {
    const r = await fetch(vaultUrl + path, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.writeHead(502); res.end('cofre inacessível');
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/v1/')) return proxy(req, res, u.pathname + u.search);
  let rel = decodeURIComponent(u.pathname);
  if (rel === '/') rel = '/index.html';
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT + sep) || /[\\/](\.git|data|vault|node_modules)[\\/]/.test(file) || /\.(env|pem)$|backup-/.test(file)) {
    res.writeHead(403); return res.end('proibido');
  }
  try {
    let body = await readFile(file);
    if (seed && extname(file) === '.html') body = Buffer.from(seed + body.toString('utf8'));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('não encontrado');
  }
});

const portOpen = () => new Promise((ok) => {
  const s = net.connect(port, '127.0.0.1');
  s.once('connect', () => (s.destroy(), ok(true)));
  s.once('error', () => ok(false));
});

// O servidor roda neste mesmo processo: se o botão "stop" matar o script, o servidor morre junto
let listening = false;
if (!(await portOpen())) {
  await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
  listening = true;
  console.log(`Servindo ${ROOT} em http://localhost:${port}`);
}

const profile = join(tmpdir(), 'argos-phone-profile');
mkdirSync(profile, { recursive: true });
const win = args.includes('--no-open') ? null : spawn(browser, [
  `--app=${url}`,
  `--window-size=${W},${H + TITLE_BAR}`,
  `--user-data-dir=${profile}`,
  '--touch-events=enabled',
  '--hide-scrollbars',
  '--disable-features=Translate,TranslateUI,TranslateRPCs',
  '--lang=pt-BR',
  '--no-first-run',
  '--no-default-browser-check',
], { stdio: 'ignore' });
console.log(seed ? 'Cofre: URL e token lidos de ~/.argos-vault.env e aplicados na página.' : 'VAULT_URL/VAULT_TOKEN não encontrados: o cofre não vai responder.');
console.log(`Galaxy M55 ${W}x${H}: ${url}`);

const quit = () => { if (listening) server.close(); process.exit(0); };
win?.on('exit', quit);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { win?.kill(); quit(); });

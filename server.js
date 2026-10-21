// Raobot server: serves the three.js world, proxies LLM calls to Raon, records runs.
// The API key never reaches the browser. Endpoints:
//   POST /api/chat     {messages, max_tokens?, temperature?} -> {content, reasoning, usage, latency_ms}
//   POST /api/log      {run, event}          -> appends to runs/<run>/log.jsonl
//   POST /api/shot     {run, name, dataUrl}  -> saves runs/<run>/shots/<name>.png (interactive mode)
//   POST /api/summary  {run, summary}        -> writes runs/<run>/summary.json
//   GET  /api/lessons                        -> feedback/lessons.md (injected into Raon prompts)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(ROOT, 'web');
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
export const RUNS = path.join(ROOT, 'runs');
const LESSONS = path.join(ROOT, 'feedback', 'lessons.md');
const MODEL = 'raon-1-mini-preview';
const RUN_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}
const ENV = loadEnv();
const API_KEY = ENV.RAON_API_KEY;
const BASE_URL = (ENV.RAON_BASE_URL || 'https://raon-api.krafton.ai/v1').replace(/\/$/, '');

async function callRaon(messages, maxTokens = 600, temperature = 0.4, retries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    const t0 = Date.now();
    try {
      const r = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!r.ok) {
        const text = await r.text();
        if (r.status < 500 && r.status !== 429) throw Object.assign(new Error(`HTTP ${r.status}: ${text}`), { fatal: true });
        throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
      }
      const data = await r.json();
      const choice = data.choices[0];
      return {
        content: choice.message.content || '',
        reasoning: choice.message.reasoning || choice.message.reasoning_content || '',
        finish_reason: choice.finish_reason,
        usage: data.usage || {},
        latency_ms: Date.now() - t0,
      };
    } catch (e) {
      if (e.fatal) throw e;
      lastErr = e;
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    }
  }
  throw new Error(`Raon call failed after ${retries} attempts: ${lastErr}`);
}

function runDir(run) {
  if (!RUN_ID_RE.test(run || '')) throw new Error('bad run id');
  const d = path.join(RUNS, run);
  fs.mkdirSync(path.join(d, 'shots'), { recursive: true });
  return d;
}

function sendJson(res, code, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(data);
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(url.pathname);
  // /three/... is served straight from the installed three.js package (core + examples/jsm addons)
  const base = pathname.startsWith('/three/') ? THREE_DIR : WEB;
  let p = path.normalize(path.join(base, base === WEB ? pathname : pathname.slice('/three'.length)));
  if (!p.startsWith(base)) return sendJson(res, 403, { error: 'forbidden' });
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  fs.readFile(p, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/api/lessons') {
        return sendJson(res, 200, { lessons: fs.existsSync(LESSONS) ? fs.readFileSync(LESSONS, 'utf8') : '' });
      }
      if (req.method === 'GET') return serveStatic(req, res);
      const body = await readBody(req);
      switch (req.url) {
        case '/api/chat':
          return sendJson(res, 200, await callRaon(body.messages, body.max_tokens, body.temperature));
        case '/api/log':
          fs.appendFileSync(path.join(runDir(body.run), 'log.jsonl'), JSON.stringify(body.event) + '\n');
          return sendJson(res, 200, { ok: true });
        case '/api/shot': {
          const name = String(body.name).replace(/[^A-Za-z0-9_-]/g, '_');
          fs.writeFileSync(path.join(runDir(body.run), 'shots', `${name}.png`), Buffer.from(body.dataUrl.split(',')[1], 'base64'));
          return sendJson(res, 200, { ok: true });
        }
        case '/api/summary':
          fs.writeFileSync(path.join(runDir(body.run), 'summary.json'), JSON.stringify(body.summary, null, 2));
          return sendJson(res, 200, { ok: true });
        default:
          return sendJson(res, 404, { error: 'not found' });
      }
    } catch (e) {
      return sendJson(res, 500, { error: String(e.message || e) });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 8765);
  createServer().listen(port, '127.0.0.1', () => console.log(`Raobot server on http://localhost:${port}`));
}

// Minimal Raon (Krafton gateway, OpenAI-compatible) client. Key comes from ../.env.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')
  .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')]));
const BASE = (env.RAON_BASE_URL || 'https://raon-api.krafton.ai/v1').replace(/\/$/, '');
export const MODEL = 'raon-1-mini-preview';

export async function raon(messages, { max_tokens = 1500, temperature = 0.3, retries = 5 } = {}) {
  let last;
  for (let i = 0; i < retries; i++) {
    const t0 = Date.now();
    try {
      const r = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RAON_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, max_tokens, temperature }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`), { status: r.status });
      const d = await r.json();
      const m = d.choices[0].message;
      return { content: m.content || '', reasoning: m.reasoning || m.reasoning_content || '', usage: d.usage || {}, latency_ms: Date.now() - t0 };
    } catch (e) {
      last = e;
      // rate limit: back off properly (10 s, 20 s, 40 s, ...); other errors retry quickly
      await new Promise((res) => setTimeout(res, e.status === 429 ? 10_000 * 2 ** i : 1500 * (i + 1)));
    }
  }
  throw new Error(`Raon failed: ${last?.message}`);
}

export function extractJson(text) {
  if (!text) return null;
  const s = text.replace(/```(?:json)?/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

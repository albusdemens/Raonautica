// Visual QA: record short clips of key scenes in Godot, turn each into an MP4 + a contact sheet,
// and ask Codex to critique motion and visuals. Writes runs/visual-qa-<ts>/report.md (+ clips, sheets, JSON).
//   node harness-godot/visual-qa.js [--port 9078] [--only fish,school]
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GodotBridge } from './bridge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(opt('port', 9078));
const ONLY = opt('only', '') ? opt('only').split(',') : null;
const out = path.join(ROOT, 'runs', `visual-qa-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
fs.mkdirSync(out, { recursive: true });

// each scene: how to set it up, what SHOULD be seen (Codex checks against this)
const SCENES = [
  { name: 'fish', expect: 'A large round yellow Bubblefin (big white eyes at its FRONT, orange tail at its BACK) swimming slowly in a wandering loop; it must swim head-first, its tail wiggling, never sliding sideways or backwards.',
    setup: [['teleport', { who: 'sub', E: -360, N: -385, depth: 2, heading: 45 }], ['view', { mode: 'focus', item: 'F1', dist: 7, yaw: 70 }]] },
  { name: 'school', expect: 'A school of small blue fish circling. Each fish must swim head-first along its path (heads leading), tails wiggling.',
    setup: [['teleport', { who: 'sub', E: -360, N: -385, depth: 2, heading: 45 }], ['view', { mode: 'focus', E: -330, N: -310, depth: 12, dist: 16, yaw: 30 }]] },
  { name: 'sub_cruise', expect: 'The white submarine (glass dome at the FRONT, orange thruster rings at the BACK) seen from behind, cruising forward over coral shallows. Nose leads; no jitter; seabed visible and sandy; corals colourful.',
    setup: [['teleport', { who: 'sub', E: -340, N: -360, above_floor: 9, heading: 20 }], ['view', { mode: 'chase' }]], act: { turn_deg: 0, throttle: 1, vertical: 0, duration_s: 6, do: 'none' } },
  { name: 'diver_swim', expect: 'A diver (white suit, orange helmet at the FRONT, orange flippers at the BACK) swimming forward over coral, legs kicking; helmet leads.',
    setup: [['teleport', { who: 'diver', E: -326, N: -310, above_floor: 3, heading: 330 }], ['view', { mode: 'chase' }]], act: { turn_deg: 0, throttle: 1, vertical: 0, duration_s: 4, do: 'none' } },
  { name: 'kelp', expect: 'Inside a tall kelp forest: stalks rising from a sandy floor, leaves swaying gently, light from above.',
    setup: [['teleport', { who: 'diver', E: -326, N: 150, above_floor: 6, heading: 20 }], ['view', { mode: 'chase' }]] },
  { name: 'mushrooms', expect: 'A dark deep basin with giant purple glowing mushrooms, bioluminescent plants, drifting particles; the sub with headlights on.',
    setup: [['teleport', { who: 'sub', E: 200, N: 230, above_floor: 14, heading: 40 }], ['view', { mode: 'chase' }]] },
].filter((s) => !ONLY || ONLY.includes(s.name));

const SCHEMA = { type: 'object', additionalProperties: false, required: ['matches_expectation', 'issues', 'summary'],
  properties: {
    matches_expectation: { type: 'boolean' }, summary: { type: 'string' },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'what', 'evidence', 'likely_cause', 'suggested_fix'],
      properties: { severity: { type: 'string', enum: ['high', 'medium', 'low'] }, what: { type: 'string' }, evidence: { type: 'string' }, likely_cause: { type: 'string' }, suggested_fix: { type: 'string' } } } } } };
fs.writeFileSync(path.join(out, 'schema.json'), JSON.stringify(SCHEMA));

function codex(images, prompt, outFile) {
  return new Promise((ok, fail) => {
    const args = ['exec', '--skip-git-repo-check', '-s', 'read-only', '--output-schema', path.join(out, 'schema.json'), '-o', outFile];
    for (const i of images) args.push('-i', i);
    args.push('-');
    const p = spawn('codex', args, { cwd: out, stdio: ['pipe', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', (d) => { err += d; });
    p.on('close', (c) => (c === 0 && fs.existsSync(outFile) ? ok(JSON.parse(fs.readFileSync(outFile, 'utf8'))) : fail(new Error(err.slice(-300)))));
    p.stdin.end(prompt);
  });
}

const godot = spawn('godot', ['--path', path.join(ROOT, 'godot'), '--', `--port=${PORT}`], { stdio: ['ignore', 'ignore', 'pipe'] });
const g = new GodotBridge(PORT);
await g.connect();
const report = [`# Visual QA (${new Date().toISOString()})\n`];
for (const sc of SCENES) {
  for (const [cmd, a] of sc.setup) await g.call(cmd, a);
  await new Promise((r) => setTimeout(r, 1200));
  const frameDir = path.join(out, sc.name);
  const rec = g.call('record', { dir: frameDir, name: 'f', frames: 16, interval: 0.2 });
  if (sc.act) g.call('act', { action: sc.act, speed: 1 }).catch(() => {});
  await rec;
  const mp4 = path.join(out, `${sc.name}.mp4`), sheet = path.join(out, `${sc.name}_sheet.png`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '5', '-i', path.join(frameDir, 'f_%03d.png'), '-pix_fmt', 'yuv420p', '-vf', 'scale=960:-2', mp4]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(frameDir, 'f_%03d.png'), '-vf', 'select=not(mod(n\\,2)),scale=480:-1,tile=4x2:padding=4', '-frames:v', '1', sheet]);
  const prompt = `You are a visual QA engineer for a 3D underwater game (Godot). The image is a contact sheet: 8 frames of a short clip in reading order (left->right, top->bottom), 0.4 s apart. On-screen HUD panels and the minimap are intentional - ignore them.
EXPECTED: ${sc.expect}
Find what is WRONG: motion direction (e.g. creatures moving backwards/sideways relative to where their head points), popping, flicker, clipping/intersections, missing or invisible geometry, wrong scale, broken lighting/exposure, washed-out or unreadable areas, camera problems. Use the frame-to-frame change to judge motion. For each issue give concrete evidence (which frames, where) and a likely cause + fix in game-dev terms (e.g. "model yaw is off by 180 degrees", "fog too dense"). Do not invent issues; if it looks right, say so.`;
  const t0 = Date.now();
  try {
    const r = await codex([sheet], prompt, path.join(out, `${sc.name}_qa.json`));
    console.log(`${sc.name}: ${r.matches_expectation ? 'OK' : 'ISSUES'} (${((Date.now() - t0) / 1000).toFixed(0)}s) ${r.summary}`);
    report.push(`## ${sc.name} - ${r.matches_expectation ? '✅ matches' : '❌ issues'}\n![](${sc.name}_sheet.png)\n\n${r.summary}\n`);
    for (const i of r.issues) report.push(`- **[${i.severity}] ${i.what}**: ${i.evidence}. *Cause:* ${i.likely_cause}. *Fix:* ${i.suggested_fix}`);
    report.push('');
  } catch (e) {
    console.log(`${sc.name}: codex failed: ${e.message}`);
  }
}
fs.writeFileSync(path.join(out, 'report.md'), report.join('\n'));
await g.call('quit').catch(() => {});
g.close();
console.log('report:', path.join(out, 'report.md'));

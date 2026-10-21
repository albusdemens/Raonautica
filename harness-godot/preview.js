// Visual check without Raon/Codex: launches Godot (windowed), teleports to scenic spots, saves screenshots
// and VLM camera frames.   node harness-godot/preview.js [--port 9078]
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GodotBridge } from './bridge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1] || 9078);
const out = path.join(ROOT, 'runs', `godot-preview-${Date.now()}`);
fs.mkdirSync(out, { recursive: true });

const godot = spawn('godot', ['--path', path.join(ROOT, 'godot'), '--', `--port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
godot.stdout.on('data', (d) => process.stdout.write(`[godot] ${d}`));
godot.stderr.on('data', (d) => { const s = String(d); if (/ERROR|SCRIPT/.test(s)) process.stdout.write(`[godot!] ${s}`); });

const g = new GodotBridge(port);
await g.connect();
const spots = [
  ['shallows', 'sub', { E: -340, N: -360, above_floor: 9, heading: 20 }],
  ['coral_diver', 'diver', { E: -326, N: -310, above_floor: 3, heading: 330 }],
  ['kelp_canopy', 'sub', { E: -320, N: 100, depth: 3, heading: 0 }],
  ['kelp_inside', 'diver', { E: -326, N: 150, above_floor: 6, heading: 20 }],
  ['plateau', 'sub', { E: -60, N: 30, above_floor: 12, heading: 60 }],
  ['wreck', 'sub', { E: -20, N: -270, above_floor: 18, heading: 90 }],
  ['mushrooms', 'sub', { E: 200, N: 230, above_floor: 14, heading: 40 }],
  ['crevice', 'diver', { E: 395, N: -130, above_floor: 3, heading: 0 }],
];
for (const [name, who, pose] of spots) {
  const t0 = Date.now();
  await g.call('teleport', { who, depth: 0, ...pose });
  await new Promise((r) => setTimeout(r, 1500));   // let fog/particles settle
  await g.call('shot', { path: path.join(out, `${name}.png`) });
  if (name === 'shallows' || name === 'kelp_inside') await g.call('look', { dir: out, name });
  console.log(`${name}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
await g.call('quit').catch(() => {});
g.close();
console.log('saved to', out);

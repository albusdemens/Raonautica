// Headless harness: serves the game, lets Raon play one mission, saves screenshots + logs to runs/<id>/.
//   node harness.js [--steps 150] [--every 4] [--run name] [--preview] [--port 8766]
// --preview: no Raon calls; poses the sub/diver at scenic spots and screenshots them (visual check).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createServer, RUNS } from './server.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const PREVIEW = args.includes('--preview');
const PORT = Number(opt('port', 8766));
const RUN = opt('run', `${PREVIEW ? 'preview' : 'run'}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
const STEPS = Number(opt('steps', 150));
const dir = path.join(RUNS, RUN);
fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });

const server = createServer().listen(PORT, '127.0.0.1');
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log(`[page ${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));

let shots = 0;
await page.exposeFunction('raobotShot', async (name) => {
  const t0 = Date.now();
  await page.screenshot({ path: path.join(dir, 'shots', `${name}.png`), timeout: 600_000 });
  if (PREVIEW) console.log(`shot ${name}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  shots++;
});

await page.goto(`http://127.0.0.1:${PORT}/?mode=harness&run=${RUN}&maxSteps=${STEPS}`);
await page.waitForFunction(() => window.__raobotReady, null, { timeout: 600_000 });
console.log(`run ${RUN} -> ${dir}`);

if (PREVIEW) {
  // [name, body, pose, height above the seabed (overrides y when given)]
  const poses = [
    ['shallows', 'sub', { E: -340, N: -360, heading: 20 }, 9],
    ['coral_close', 'diver', { E: -326, N: -310, heading: 330 }, 3],
    ['kelp_canopy', 'sub', { E: -320, N: 90, y: -3, heading: 0 }],
    ['kelp_inside', 'diver', { E: -326, N: 150, heading: 20 }, 6],
    ['plateau', 'sub', { E: -60, N: 30, heading: 60 }, 12],
    ['wreck', 'sub', { E: -20, N: -270, heading: 90 }, 18],
    ['mushrooms', 'sub', { E: 200, N: 230, heading: 40 }, 14],
    ['canyon', 'sub', { E: 350, N: -60, heading: 100 }, 60],
    ['crevice', 'diver', { E: 380, N: -128, heading: 60 }, 3],
  ];
  for (const [name, who, pose, above] of poses) {
    await page.evaluate(([who, pose, above]) => {
      const sim = window.raobot.sim;
      if (above != null) pose.y = window.raobot.floorAt(pose.E, pose.N) + above;
      Object.assign(sim.sub, pose);
      if (who === 'diver') { sim.active = 'diver'; Object.assign(sim.diver, pose); sim.sub.E -= 8; sim.sub.y = Math.min(-1, sim.sub.y + 4); }
      else sim.active = 'sub';
      sim.updateSight();
    }, [who, pose, above]);
    await page.evaluate((n) => window.raobot.shot(n), name);
  }
  await page.evaluate(() => window.raobot.shot('overview', 'overview'));
} else {
  const t0 = Date.now();
  await page.evaluate(() => { window.__raobotStart(); });
  const timer = setInterval(async () => {
    try {
      const s = await page.evaluate(() => { const sim = window.raobot.sim, inv = sim.inventory();
        return `step ${sim.step} ${sim.active} depth ${(-sim.body.y).toFixed(1)} stored ${JSON.stringify(inv.stored)} carry ${sim.carry.join(',')}`; });
      console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${s} | shots ${shots}`);
    } catch {}
  }, 30_000);
  const summary = await page.waitForFunction(() => window.__raobotDone, null, { timeout: 0, polling: 1000 }).then((h) => h.jsonValue());
  clearInterval(timer);
  console.log('SUMMARY', JSON.stringify(summary, null, 2));
}

await browser.close();
server.close();
console.log(`done: ${shots} screenshots in ${path.join(dir, 'shots')}`);

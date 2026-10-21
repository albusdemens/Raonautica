// Godot harness: Codex sees, Raon decides, Godot executes.
//   node harness-godot/run.js [--steps 150] [--run name] [--port 9079] [--speed 3] [--vlm-every 3] [--attach] [--keep-open]
// --attach: use a Godot instance that is already running on --port instead of launching one.
// Writes runs/<run>/: log.jsonl, shots/*.png (main window incl. HUD), vlm/*.png + *_vlm.json, summary.json, godot.log
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GodotBridge } from './bridge.js';
import { raon, extractJson } from './raon.js';
import { look, describe, KIND_TO_ITEM, CAM_OFFSET } from './vlm.js';
import { s1System, s2System, s1Prompt, s2Prompt } from './prompts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes(`--${k}`);
const RUN = opt('run', `godot-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
const MAX_STEPS = Number(opt('steps', 150));
const PORT = Number(opt('port', 9079));
const SPEED = Number(opt('speed', 3));
const VLM_EVERY = Number(opt('vlm-every', 3));
const SHOT_EVERY = Number(opt('shot-every', 4));
const dir = path.join(ROOT, 'runs', RUN);
for (const d of ['shots', 'vlm']) fs.mkdirSync(path.join(dir, d), { recursive: true });
const LESSONS_FILE = path.join(ROOT, 'feedback', 'lessons-godot.md');

const logStream = fs.createWriteStream(path.join(dir, 'log.jsonl'), { flags: 'a' });
const log = (e) => logStream.write(JSON.stringify({ ...e, wall: Date.now() }) + '\n');
const say = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// ---------------------------------------------------------------- Godot

let godot = null;
if (!flag('attach')) {
  const glog = fs.createWriteStream(path.join(dir, 'godot.log'));
  godot = spawn('godot', ['--path', path.join(ROOT, 'godot'), '--', `--port=${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  godot.stdout.pipe(glog); godot.stderr.pipe(glog);
  godot.on('exit', (c) => say(`godot exited (${c})`));
}
const g = new GodotBridge(PORT);
await g.connect();
say(`connected to Godot on ${PORT}; run ${RUN}`);

// ---------------------------------------------------------------- state

const first = await g.call('state');
let S = first.state;
const zones = first.zones;
const spec = { sub: { speed: 12, vspeed: 5, r: 2.3, max_dur: 6 }, diver: { speed: 2, vspeed: 1.5, r: 0.5, max_dur: 4 } };
const lessons = (() => {
  const t = fs.existsSync(LESSONS_FILE) ? fs.readFileSync(LESSONS_FILE, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/^#.*$/m, '').trim() : '';
  return t ? `\n\nLESSONS FROM PREVIOUS RUNS (written by a supervisor who reviewed screenshots - follow them):\n${t}` : '';
})();
const SYS1 = s1System(spec) + lessons, SYS2 = s2System(spec) + lessons;

let plan = null, history = [], lastResult = null, lastS2Step = -99, pending = ['mission start'];
let lastLook = null, lastLookStep = -99, blockedStreak = 0, airWarned = false, shotN = 0;
const sightings = [];           // {id, kind, item, E, N, depth, count, last}
let nextSight = 1;
const stats = { s1: 0, s2: 0, looks: 0, s1ms: 0, s2ms: 0, lookms: 0, rejected: 0, parseFail: 0, errors: 0 };

const rad = (d) => (d * Math.PI) / 180;
const norm180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

function relFrom(s, q) {
  const p = s.pose;
  const dE = q.E - p.E, dN = q.N - p.N, hd = Math.hypot(dE, dN);
  const comp = ((Math.atan2(dE, dN) * 180) / Math.PI + 360) % 360;
  const dy = p.depth - q.depth;      // + = target above
  return { dist: +Math.hypot(hd, dy).toFixed(1), horiz: +hd.toFixed(1), rel: Math.round(norm180(comp - p.heading)), dy: +dy.toFixed(1) };
}

// turn a camera observation into an estimated world position and merge it into memory
const SIGHT_CONF = 0.6;
function remember(v, s) {
  const p = s.pose;
  const fresh = [], confirmed = new Set();
  for (const t of v.targets) {
    if (t.confidence < SIGHT_CONF) continue;
    const d = Math.max(0.5, t.distance_m);
    let horiz, dz;
    if (t.camera === 'down') { horiz = Math.max(1, d * 0.5); dz = d * 0.85; }
    else { horiz = d; dz = t.vertical === 'below' ? d * 0.3 : t.vertical === 'above' ? -d * 0.3 : 0; }
    const c = rad(p.heading + t.bearing_deg);
    const est = { E: p.E + Math.sin(c) * horiz, N: p.N + Math.cos(c) * horiz,
      depth: Math.max(0.5, Math.min(p.depth + p.floor_below_m - 0.3, p.depth + dz)) };
    const same = sightings.find((x) => x.kind === t.kind && Math.hypot(x.E - est.E, x.N - est.N) < 10);
    if (same) {
      const w = 0.6;   // trust the newest look more
      same.E = same.E * (1 - w) + est.E * w; same.N = same.N * (1 - w) + est.N * w; same.depth = same.depth * (1 - w) + est.depth * w;
      same.count++; same.last = s.step; same.misses = 0;
      confirmed.add(same.id);
    } else {
      const id = `V${nextSight++}`;
      sightings.push({ id, kind: t.kind, item: KIND_TO_ITEM[t.kind], ...est, count: 1, last: s.step, misses: 0 });
      fresh.push(id);
      confirmed.add(id);
    }
  }
  // ghosts: a sighting right next to us that fresh looks keep not seeing is probably not there
  const removed = [];
  for (const x of [...sightings]) {
    if (confirmed.has(x.id) || relFrom(s, x).dist > 7) continue;
    x.misses = (x.misses || 0) + 1;
    if (x.misses >= (x.item === 'fish' ? 3 : 2)) { sightings.splice(sightings.indexOf(x), 1); removed.push(x.id); }  // fish move: be patient
  }
  return { fresh, removed };
}

function whereAmI(s) {
  const p = s.pose;
  const inside = zones.map((z) => ({ z, d: Math.hypot(z.E - p.E, z.N - p.N) })).sort((a, b) => a.d - b.d)[0];
  return `${inside.d <= inside.z.r ? 'inside' : `${Math.round(inside.d)} m from`} ${inside.z.name} - ${inside.z.desc} Depth ${p.depth} m.`;
}

function sightingsView(s) {
  return sightings.map((v) => ({ ...v, dist: relFrom(s, v).dist })).sort((a, b) => a.dist - b.dist);
}

// tracking-sonar lock, accepted only when it agrees with a vision-confirmed sighting of the same kind
function visionLock(s) {
  const L = s.lock;
  if (!L) return null;
  const v = sightings.find((x) => x.item === L.kind && Math.hypot(x.E - L.E, x.N - L.N) < 15);
  if (!v) return null;
  v.E = L.E; v.N = L.N; v.depth = L.depth; v.locked = true;      // the lock refines the sighting
  return { ...L, sighting: v.id };
}

function targetOf(sg, s) {
  if (!sg) return null;
  let q = null, reach = 4, label = '', estimated = false;
  if (sg.type === 'sighting') {
    const v = sightings.find((x) => x.id === sg.id);
    if (!v) return null;
    q = v; reach = s.active === 'sub' ? 10 : 3; label = `${v.id} ${v.kind}`; estimated = !v.locked;
  } else if (sg.type === 'zone') {
    const z = zones.find((x) => x.id === sg.id);
    if (!z) return null;
    q = { E: z.E, N: z.N, depth: Number.isFinite(sg.depth) ? sg.depth : z.parkDepth }; reach = s.active === 'sub' ? 12 : 6; label = `${z.id} ${z.name}`;
  } else if (sg.type === 'sub') {
    q = s.sub; reach = 8; label = 'the sub';
  } else if (sg.type === 'waypoint' && Number.isFinite(sg.E) && Number.isFinite(sg.N)) {
    q = { E: sg.E, N: sg.N, depth: Number.isFinite(sg.depth) ? sg.depth : s.pose.depth }; label = `waypoint (${Math.round(sg.E)}, ${Math.round(sg.N)}, ${Math.round(q.depth)} m)`;
  } else return null;
  const rel = relFrom(s, q);
  return { label, rel, reach, reached: rel.dist <= reach, estimated };
}

function checkSubgoal(sg, s) {
  if (!sg || typeof sg !== 'object') return 'missing "subgoal" object.';
  if (sg.type === 'sighting') return sightings.some((x) => x.id === sg.id) ? null : `no sighting "${sg.id}" - only ids listed under SIGHTINGS exist. To find targets, move the sub to the zone where they live and look.`;
  if (sg.type === 'zone') {
    if (!zones.some((z) => z.id === sg.id)) return `no zone "${sg.id}" (valid: ${zones.map((z) => z.id).join(', ')}).`;
    return null;
  }
  if (sg.type === 'sub') return s.active === 'diver' ? null : 'the diver is already inside the sub.';
  if (sg.type === 'waypoint') return Number.isFinite(+sg.E) && Number.isFinite(+sg.N) ? null : 'waypoint needs numeric E and N.';
  return `unknown subgoal type "${sg.type}".`;
}

// ---------------------------------------------------------------- steps

// is a camera candidate just a re-sighting of something already confirmed? (then skip the zoom-confirm call)
function knownCandidate(t, at) {
  const p = at.pose, d = Math.max(0.5, t.distance_m);
  const c = rad(p.heading + t.bearing_deg + (CAM_OFFSET[t.camera] || 0));
  const horiz = t.camera === 'down' ? Math.max(1, d * 0.5) : d;
  const E = p.E + Math.sin(c) * horiz, N = p.N + Math.cos(c) * horiz;
  return sightings.some((x) => x.kind === t.kind && Math.hypot(x.E - E, x.N - N) < 12);
}

let lookInFlight = null;     // a background look (periodic looks don't block Raon)
async function doLook(reason) {
  const name = `s${String(S.step).padStart(3, '0')}_${S.active}`;
  await g.call('hud', { phase: `CODEX looking (${reason})…` });
  const r = await g.call('look', { dir: path.join(dir, 'vlm'), name });
  const at = r.state;          // pose when the frames were taken: estimates use this even if the result arrives late
  try {
    const v = await look(r.paths, at.active, path.join(dir, 'vlm'), name, whereAmI(at), (t) => knownCandidate(t, at));
    stats.looks++; stats.lookms += v.latency_ms;
    lastLook = v; lastLookStep = at.step;
    const { fresh, removed } = remember(v, at);
    if (removed.length) pending.push(`sighting(s) ${removed.join(', ')} not confirmed up close - removed (probably a false detection)`);
    log({ type: 'look', step: at.step, reason, pose: at.pose, active: at.active, images: r.paths, vlm: v, new_sightings: fresh, removed_sightings: removed });
    say(`look @${at.step} (${(v.latency_ms / 1000).toFixed(0)}s, ${v.confirm_calls ? 'confirmed' : 'single call'}): ${v.targets.map((t) => `${t.kind}@${Math.round(t.bearing_deg)}°/${Math.round(t.distance_m)}m`).join(', ') || 'no targets'}`);
    await g.call('hud', { vlm: describe(v).replace(/\n/g, '\n'), sightings: sightings.map((x) => ({ E: x.E, N: x.N })) });
    return fresh;
  } catch (e) {
    log({ type: 'look_error', step: S.step, message: String(e.message) });
    say('look failed:', e.message);
    return [];
  }
}

// close-range visual servoing: when the diver is near its target sighting, look every step
function closeRangeEvery() {
  if (S.active !== 'diver' || plan?.subgoal?.type !== 'sighting') return VLM_EVERY;
  if (visionLock(S)) return VLM_EVERY;        // the tracking sonar is exact: no need to re-look every step
  const t = targetOf(plan.subgoal, S);
  return t && t.rel.dist < 8 ? 1 : VLM_EVERY;
}

const lookText = () => (lastLook ? describe(lastLook, S.step - lastLookStep) : 'no look yet');

async function system2(trigger) {
  const user = s2Prompt(S, zones, sightingsView(S), plan, trigger, history, lookText());
  const messages = [{ role: 'system', content: SYS2 }, { role: 'user', content: user }];
  let res, parsed = null; const rejected = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await raon(messages, { max_tokens: 2500 });
    parsed = extractJson(res.content);
    if (!parsed) { stats.parseFail++; continue; }
    const problem = checkSubgoal(parsed.subgoal, S);
    if (!problem) break;
    rejected.push({ subgoal: parsed.subgoal, problem }); stats.rejected++;
    messages.push({ role: 'assistant', content: res.content }, { role: 'user', content: `REJECTED: ${problem} Reply again with corrected JSON only.` });
    parsed = null;
  }
  stats.s2++; stats.s2ms += res.latency_ms;
  if (parsed) {
    const sg = parsed.subgoal;
    for (const k of ['E', 'N', 'depth']) sg[k] = sg[k] == null ? null : Number(sg[k]);
    const same = plan && JSON.stringify(plan.subgoal) === JSON.stringify(sg);
    plan = { flagged: same && plan.flagged, assessment: parsed.assessment || '', plan: parsed.plan || '', subgoal: sg,
      // sightings/sub returns are always the diver's job (only the diver can grab)
      body: parsed.body === 'diver' || sg.type === 'sighting' || sg.type === 'sub' ? 'diver' : 'sub', guidance: String(parsed.guidance || ''), trigger, step: S.step };
  }
  lastS2Step = S.step;
  log({ type: 's2', step: S.step, trigger, prompt: user, content: res.content, reasoning: res.reasoning, latency_ms: res.latency_ms, usage: res.usage, parsed, rejected, plan });
  say(`S2 @${S.step} [${trigger.slice(0, 60)}] -> ${JSON.stringify(plan?.subgoal)} (${plan?.body})${rejected.length ? ` after ${rejected.length} rejection(s)` : ''}`);
  await g.call('hud', { s2: plan ? `[i]${trigger.slice(0, 80)}[/i]\nsubgoal: ${JSON.stringify(plan.subgoal)} · body [b]${plan.body}[/b]\nguidance: ${plan.guidance}\n${plan.plan.slice(0, 160)}` : 'no plan' });
}

async function system1() {
  const lock = S.active === 'diver' ? visionLock(S) : null;
  const target = plan ? targetOf(plan.subgoal, S) : null;   // also used by the approach limiter below
  const user = s1Prompt(S, plan, target, lookText(), lastResult, lock);
  const messages = [{ role: 'system', content: SYS1 }, { role: 'user', content: user }];
  let res, p = null;
  for (let attempt = 0; attempt < 3 && !p; attempt++) {
    res = await raon(messages, { max_tokens: 3000 });
    p = extractJson(res.content);
    if (!p) stats.parseFail++;
  }
  stats.s1++; stats.s1ms += res.latency_ms;
  p = p || { thought: '(unparseable reply - holding still)', duration_s: 1 };
  const clamp = (x, a, b) => Math.min(b, Math.max(a, Number.isFinite(+x) ? +x : 0));
  const action = {
    thought: String(p.thought || '').slice(0, 160),
    turn_deg: Math.round(clamp(p.turn_deg, -180, 180)),
    throttle: +clamp(p.throttle, 0, 1).toFixed(2),
    vertical: +clamp(p.vertical, -1, 1).toFixed(2),
    duration_s: +clamp(p.duration_s || 1, 0.5, spec[S.active].max_dur).toFixed(1),
    do: ['exit', 'enter', 'grab'].includes(p.do) ? p.do : 'none',
    replan: !!p.replan,
  };
  // approach limiter (low-level safety): don't drive past the target. Facing it (|turn - rel| < 60), cap the
  // forward distance at its horizontal distance + 2 m by shortening the move.
  if (target && action.throttle > 0 && Math.abs(norm180(action.turn_deg - target.rel.rel)) < 60) {
    const speed = spec[S.active].speed, fwd = speed * action.throttle * action.duration_s;
    const cap = Math.max(2, target.rel.horiz + 2);
    if (fwd > cap) { action.duration_s = +Math.max(0.5, cap / (speed * action.throttle)).toFixed(1); action.limited = true; }
  }
  log({ type: 's1', step: S.step, prompt: user, content: res.content, reasoning: res.reasoning, latency_ms: res.latency_ms, usage: res.usage, action });
  return action;
}

function notice(r) {
  if (r.event?.startsWith('BLACKOUT')) pending.push('diver blacked out');
  if (r.do?.ok && r.action.do === 'grab') {
    pending.push(`diver grabbed a ${r.do.kind}`);
    // forget the sighting just taken, and any duplicates of it (the same fish logged twice from different looks)
    for (const v of sightings.filter((x) => x.item === r.do.kind && relFrom(S, x).dist < 12)) sightings.splice(sightings.indexOf(v), 1);
  }
  if (r.do?.ok && r.action.do === 'exit') pending.push('diver just exited the sub');
  if (r.do?.ok && r.action.do === 'enter') pending.push('diver just entered the sub');
  if (r.action.replan) pending.push('SYSTEM 1 requested a replan');
  // sonar check: the tracking sonar sees every real target within 15 m. A sighting the diver is right next to,
  // with no sonar contact at all, cannot be real.
  if (S.active === 'diver' && !S.lock) {
    const ghosts = sightings.filter((v) => relFrom(S, v).dist < 8);
    for (const v of ghosts) sightings.splice(sightings.indexOf(v), 1);
    if (ghosts.length) pending.push(`sighting(s) ${ghosts.map((v) => v.id).join(', ')} removed: the diver is next to the spot and the tracking sonar shows nothing there (false or duplicate detection)`);
  }
  blockedStreak = r.blocked_by ? blockedStreak + 1 : 0;
  if (blockedStreak >= 3) { pending.push(`stuck: blocked by ${r.blocked_by} for 3 steps`); blockedStreak = 0; }
  if (S.active === 'diver' && S.air_s < 35 && !airWarned) { pending.push(`diver air low (${S.air_s} s)`); airWarned = true; }
  if (S.active === 'sub') airWarned = false;
  if (plan && !plan.flagged) {
    const t = targetOf(plan.subgoal, S);
    if (!t) { pending.push('current subgoal is not valid any more'); plan.flagged = true; }
    else if (t.reached && plan.subgoal.type !== 'sub' && !(plan.subgoal.type === 'sighting' && S.active === 'diver')) { pending.push(`subgoal reached (${t.label})`); plan.flagged = true; }
  }
  if (S.step - lastS2Step >= 10) pending.push('periodic check (10 steps since last plan)');
}

async function shot(label) {
  const p = path.join(dir, 'shots', `${String(shotN++).padStart(3, '0')}_s${S.step}_${label}.png`);
  await g.call('shot', { path: p });
}

// ---------------------------------------------------------------- main loop

log({ type: 'start', run: RUN, maxSteps: MAX_STEPS, vlmEvery: VLM_EVERY, lessons });
await shot('start');
let outcome = 'out of steps', consecutiveErrors = 0;
while (S.step < MAX_STEPS) {
  try {
    if (pending.length) {
      // planning needs a fresh view: wait for a running look, or take one if the last is stale
      let fresh = [];
      if (lookInFlight) fresh = await lookInFlight;
      else if (S.step - lastLookStep >= 2) fresh = await doLook('plan');
      const trigger = [...new Set(pending)].join('; ');
      pending = [];
      await g.call('hud', { phase: 'SYSTEM 2 (Raon) planning…' });
      await system2(fresh.length ? `${trigger}; new sightings: ${fresh.join(', ')}` : trigger);
      await shot('plan');
    } else if (!lookInFlight && S.step - lastLookStep >= closeRangeEvery()) {
      // background look: Raon keeps acting while Codex looks; results merge in when ready
      const atStep = S.step;
      lookInFlight = doLook('periodic').then((fresh) => {
        if (fresh.length && atStep - lastS2Step >= 2) pending.push(`new sightings: ${fresh.join(', ')}`);
        return fresh;
      }).finally(() => { lookInFlight = null; });
    }
    await g.call('hud', { phase: 'SYSTEM 1 (Raon) deciding…' });
    const action = await system1();
    await g.call('hud', { phase: 'executing', s1: `“${action.thought}”\nturn ${action.turn_deg}° · thr ${action.throttle} · vert ${action.vertical} · ${action.duration_s}s · do ${action.do}${action.replan ? ' · REPLAN' : ''}` });
    const r = await g.call('act', { action, speed: SPEED });
    S = r.state; lastResult = r.result; consecutiveErrors = 0;
    const a = r.result.action;
    history.push(`step ${S.step - 1} [${r.result.body}] "${a.thought}" -> moved ${r.result.moved_m} m` + (r.result.blocked_by ? `, blocked by ${r.result.blocked_by}` : '') +
      (r.result.do?.ok !== undefined ? `, ${a.do} ${r.result.do.ok ? 'OK' : 'FAILED (' + r.result.do.reason + ')'}` : '') + (r.result.event ? `, ${r.result.event}` : ''));
    log({ type: 'result', step: S.step - 1, result: r.result, pose: S.pose, active: S.active, air: S.air_s, inventory: S.inventory });
    if (r.result.do?.ok !== undefined || r.result.event) say(`step ${S.step - 1}: ${a.do} ${r.result.do?.ok ? 'OK ' + (r.result.do.info || '') : r.result.do?.reason || ''} ${r.result.event || ''}`);
    notice(r.result);
    const eventful = r.result.do?.ok !== undefined || r.result.event;
    if (eventful) await shot(r.result.event ? 'blackout' : `${a.do}${r.result.do.ok ? '' : '_fail'}`);
    else if (S.step % SHOT_EVERY === 0) await shot('step');
    if (S.inventory.done) { outcome = 'success'; break; }
  } catch (e) {
    stats.errors++;
    log({ type: 'error', step: S.step, message: String(e.message || e) });
    say('error:', e.message);
    if (++consecutiveErrors >= 5) { outcome = 'aborted (errors)'; break; }
    await new Promise((res) => setTimeout(res, 3000));
  }
}

const summary = { outcome, steps: S.step, sim_time_s: Math.round(S.t), inventory: S.inventory, blackouts: S.blackouts, sightings, stats,
  avg_ms: { s1: Math.round(stats.s1ms / Math.max(1, stats.s1)), s2: Math.round(stats.s2ms / Math.max(1, stats.s2)), look: Math.round(stats.lookms / Math.max(1, stats.looks)) } };
log({ type: 'end', ...summary });
fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
await g.call('hud', { phase: `END: ${outcome}` });
await shot('end');
say('SUMMARY', JSON.stringify(summary));
if (!flag('keep-open')) { await g.call('quit').catch(() => {}); }
g.close();
logStream.end();

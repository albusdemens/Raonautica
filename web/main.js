// Entry point: renderer, camera, render loop, and wiring between the sim, Raon agent, HUD and harness.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { setupFog, makeEnvironment, createPipeline } from './fx.js';
import { buildWorld, shared, floorAt, HALF } from './world.js';
import { createSub, createDiver } from './actors.js';
import { Sim, DT } from './sim.js';
import { Agent } from './agent.js';
import { Hud } from './hud.js';

const params = new URLSearchParams(location.search);
const HARNESS = params.get('mode') === 'harness';
const RUN = params.get('run') || `live-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
const MAX_STEPS = Number(params.get('maxSteps') || 200);
const QUALITY = params.get('quality') || 'high';
let timeScale = Number(params.get('speed') || 2);

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(HARNESS ? 1 : Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const dome = setupFog(scene);
scene.environment = makeEnvironment(renderer);
scene.environmentIntensity = 0.7;
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 600);

scene.add(new THREE.HemisphereLight('#bff6ff', '#10283c', 1.4));
const sun = new THREE.DirectionalLight('#fff4dc', 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 260 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(-0.25, 1, 0.15).normalize();

const world = buildWorld(scene);
const sim = new Sim(world);
const sub = createSub(scene);
const diver = createDiver(scene);
const hud = new Hud(sim);
const fx = createPipeline(renderer, scene, camera, { ao: QUALITY === 'high' });
window.raobot = { sim, world, scene, camera, fx, floorAt };

const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false;
let view = 'chase';

// ---------------------------------------------------------------- camera

const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function chaseTarget() {
  const b = sim.body, h = THREE.MathUtils.degToRad(b.heading);
  const fE = Math.sin(h), fN = Math.cos(h);
  const [back, up] = sim.active === 'sub' ? [11, 3.8] : [4.8, 1.6];
  // walk from the body toward the ideal camera spot, stopping before anything solid
  let k = 0.15;
  for (; k <= 1.0001; k += 0.05) {
    const c = { E: b.E - fE * back * k, N: b.N - fN * back * k, y: b.y + up * k };
    const insideSub = sim.active === 'diver' && sim.dist3(c, sim.sub) < 3.4;
    if (!sim.isFree(c, 0.35) || insideSub) { k -= 0.05; break; }
  }
  k = Math.max(0.15, Math.min(1, k));
  const pos = new THREE.Vector3(b.E - fE * back * k, b.y + up * k, -(b.N - fN * back * k));
  pos.y = Math.min(-0.4, Math.max(pos.y, floorAt(pos.x, -pos.z) + 0.6));
  const look = new THREE.Vector3(b.E + fE * 5, b.y + 0.3, -(b.N + fN * 5));
  return { pos, look };
}

function applyView(snap) {
  const overview = view === 'overview';
  if (overview) {
    camera.far = 4000;
    camera.position.set(-HALF * 1.25, 650, HALF * 1.35);
    camera.lookAt(40, -90, -40);
  } else {
    camera.far = 600;
    if (view === 'chase') {
      const t = chaseTarget();
      if (snap) { camPos.copy(t.pos); camLook.copy(t.look); }
      else { camPos.lerp(t.pos, 0.08); camLook.lerp(t.look, 0.12); }
      camera.position.copy(camPos);
      camera.lookAt(camLook);
    }
  }
  camera.updateProjectionMatrix();
  scene.fog.density = overview ? 0.0006 : 0.024;
  scene.getObjectByName('surface').visible = !overview;
  scene.getObjectByName('godrays').visible = !overview;
  dome.visible = !overview;
  dome.position.copy(camera.position);
  world.follow(camera, overview);
  // shadows cover the area around the camera's focus
  const focus = overview ? new THREE.Vector3(0, -60, 0) : new THREE.Vector3(sim.body.E, sim.body.y, -sim.body.N);
  sun.target.position.copy(focus);
  sun.position.copy(focus).addScaledVector(SUN_DIR, 120);
  sun.castShadow = !overview;
}

// ---------------------------------------------------------------- render loop

let current = null; // { gen, resolve } while an action is executing in real time
let last = performance.now();

function updateVisuals(t) {
  shared.uTime.value = t;
  for (const u of world.updaters) u(t);
  for (const it of world.items) {
    it.mesh.visible = it.state === 'world';
    if (it.mesh.visible) {
      const q = sim.itemPos(it);
      it.mesh.position.set(q.E, q.y, -q.N);
      if (it.kind === 'fish') {
        const q2 = it.posAt(sim.t + 0.2);
        it.mesh.rotation.y = Math.atan2(-(q2.E - q.E), (q2.N - q.N));
      } else it.mesh.rotation.y = t * 0.3;
    }
  }
  sub.update(sim.sub, t, -sim.sub.y);
  diver.setVisible(sim.active === 'diver');
  diver.update(sim.diver, t, -sim.diver.y, sim.moving && sim.active === 'diver');
}

function renderFrame(t) {
  fx.render(t, { overview: view === 'overview' });
}

function frame(now) {
  requestAnimationFrame(frame);
  if (HARNESS) return;                       // harness renders only when it takes a screenshot
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (current) {
    let n = Math.max(1, Math.round((dt * timeScale) / DT));
    while (n-- > 0) {
      const r = current.gen.next();
      if (r.done) { const c = current; current = null; c.resolve(r.value); break; }
    }
  }
  const t = now / 1000;
  updateVisuals(t);
  if (view === 'free') { controls.update(); applyView(false); }
  else applyView(false);
  hud.update(agent, view === 'overview' ? null : camera);
  renderFrame(t);
}

// ---------------------------------------------------------------- agent hooks

function log(event) {
  fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run: RUN, event }) }).catch(() => {});
}

function execute(action) {
  const gen = sim.execute(action);
  if (HARNESS) {
    let r;
    while (!(r = gen.next()).done);
    return Promise.resolve(r.value);
  }
  return new Promise((resolve) => { current = { gen, resolve }; });
}

async function shot(name, v = 'chase') {
  if (!HARNESS) {
    // live mode: don't yank the viewer's camera around; save what is on screen (3D only, no HUD)
    if (v !== 'chase') return;
    fetch('/api/shot', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run: RUN, name, dataUrl: renderer.domElement.toDataURL('image/png') }) }).catch(() => {});
    return;
  }
  const prev = view;
  view = v;
  updateVisuals(sim.t);
  applyView(true);
  hud.update(agent, v === 'chase' ? camera : null);
  document.body.classList.toggle('overview', v === 'overview');
  renderFrame(sim.t);
  await window.raobotShot(name);                                     // full-page screenshot incl. HUD
  document.body.classList.remove('overview');
  view = prev;
}

const agent = new Agent(sim, {
  execute, shot, log,
  onUpdate({ phase, action, summary }) {
    if (action) agent.currentAction = action;
    hud.setPhase({ s2: 'SYSTEM 2 thinking…', plan: 'plan ready', s1: 'SYSTEM 1 thinking…', act: 'executing', 'done-step': 'step done', end: `END: ${summary?.outcome}` }[phase] || phase);
    if (phase === 'end') {
      fetch('/api/summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run: RUN, summary }) });
      window.__raobotDone = summary;
    }
  },
}, { maxSteps: MAX_STEPS });

// ---------------------------------------------------------------- UI

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  fx.setSize(innerWidth, innerHeight);   // CSS pixels: the composer applies the pixel ratio itself
});

const ui = document.getElementById('controls');
if (HARNESS) ui.remove();
else {
  // live mode plays by itself: Raon starts as soon as the page loads
  document.getElementById('run').textContent = `run ${RUN}`;
  setTimeout(() => agent.run(), 800);
  document.getElementById('view').onchange = (e) => {
    view = e.target.value;
    controls.enabled = view === 'free';
    if (view === 'free') controls.target.set(sim.body.E, sim.body.y, -sim.body.N);
  };
  document.getElementById('speed').oninput = (e) => { timeScale = Number(e.target.value); };
  document.getElementById('speed').value = timeScale;
}

fx.setSize(innerWidth, innerHeight);
applyView(true);
document.getElementById('loading')?.remove();
requestAnimationFrame(frame);
window.raobot.shot = shot;
window.raobot.agent = agent;
window.__raobotReady = true;
if (HARNESS) window.__raobotStart = () => agent.run();

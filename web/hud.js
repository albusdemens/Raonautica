// HUD overlay: status, Raon's current plan and motor command, minimap, depth profile, item labels.
// Everything here is HTML so it shows up in the harness screenshots for review.
import * as THREE from 'three';
import { floorAt, HALF } from './world.js';
import { O2_MAX, NEEDS } from './sim.js';

const KIND_COLOR = { fish: '#ffcf3b', salad: '#8ee05a', mineral: '#c9a8ff' };
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export class Hud {
  constructor(sim) {
    this.sim = sim;
    this.el = {
      status: document.getElementById('status'),
      s2: document.getElementById('s2'),
      s1: document.getElementById('s1'),
      labels: document.getElementById('labels'),
      map: document.getElementById('minimap'),
      prof: document.getElementById('profile'),
    };
    this.labelEls = new Map();
    this.mapBg = this.renderMapBg();
    this.phase = 'idle';
  }

  renderMapBg() {
    const n = 200, cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const g = cv.getContext('2d'), img = g.createImageData(n, n);
    const shallow = new THREE.Color('#7fe0d0'), mid = new THREE.Color('#2a7fa8'), deep = new THREE.Color('#0b1838'), c = new THREE.Color();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const E = -HALF + (i + 0.5) * (2 * HALF / n), N = HALF - (j + 0.5) * (2 * HALF / n);
      const d = -floorAt(E, N);
      c.copy(shallow).lerp(mid, Math.min(1, d / 60)).lerp(deep, Math.max(0, Math.min(1, (d - 60) / 120)));
      const shade = 0.85 + 0.15 * Math.sin(d * 0.35);
      const k = (j * n + i) * 4;
      img.data[k] = c.r * 255 * shade; img.data[k + 1] = c.g * 255 * shade; img.data[k + 2] = c.b * 255 * shade; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return cv;
  }

  setPhase(p) { this.phase = p; }

  update(agent, camera) {
    const sim = this.sim, inv = sim.inventory(), p = sim.poseInfo();
    const check = (k) => `${inv.stored[k] >= NEEDS[k] ? '✅' : '⬜'} ${k} ${inv.stored[k]}/${NEEDS[k]}${inv.carried[k] ? ` <span class="dim">(+${inv.carried[k]} carried)</span>` : ''}`;
    const o2pct = Math.max(0, sim.o2 / O2_MAX);
    this.el.status.innerHTML = `
      <div class="title">RAON DIVE <span class="dim">step ${sim.step} · t ${Math.round(sim.t)}s</span></div>
      <div>Active: <b>${sim.active === 'sub' ? '🚤 SUB' : '🤿 DIVER'}</b> · depth <b>${p.depth} m</b> · hdg ${p.heading}°</div>
      <div>E ${p.E} · N ${p.N} · seabed −${p.floor_below_m} m</div>
      <div class="o2">O₂ <span class="bar"><span style="width:${o2pct * 100}%;background:${o2pct < 0.35 ? '#ff5a5a' : '#5fe0ff'}"></span></span> ${Math.round(sim.o2)}s</div>
      <div class="lunch">🍱 ${check('fish')} · ${check('salad')} · ${check('mineral')}</div>
      <div class="dim">phase: ${esc(this.phase)}${sim.blackouts ? ` · blackouts: ${sim.blackouts}` : ''}</div>`;

    const plan = agent?.plan;
    this.el.s2.innerHTML = plan ? `
      <div class="hdr">SYSTEM 2 · plan <span class="dim">(step ${plan.step}: ${esc(plan.trigger).slice(0, 90)})</span></div>
      <div><b>subgoal:</b> ${esc(JSON.stringify(plan.subgoal))} · body <b>${esc(plan.body)}</b></div>
      <div><b>guidance:</b> ${esc(plan.guidance)}</div>
      <div class="dim">${esc(plan.plan).slice(0, 220)}</div>` : '<div class="hdr">SYSTEM 2 · no plan yet</div>';

    const r = sim.lastResult;
    const a = agent?.currentAction || r?.action;
    this.el.s1.innerHTML = a ? `
      <div class="hdr">SYSTEM 1 · motor</div>
      <div>“${esc(a.thought)}”</div>
      <div class="mono">turn ${a.turn_deg}° · thr ${a.throttle} · vert ${a.vertical} · ${a.duration_s}s · do ${a.do}${a.replan ? ' · REPLAN' : ''}</div>
      ${r ? `<div class="dim">last: moved ${r.moved_m} m${r.blocked_by ? ` · <span class="warn">blocked: ${esc(r.blocked_by)}</span>` : ''}${r.do ? ` · ${esc(r.action.do)}: ${r.do.ok ? 'OK' : '<span class="warn">' + esc(r.do.reason) + '</span>'}` : ''}${r.event ? ` · <span class="warn">${esc(r.event)}</span>` : ''}</div>` : ''}` : '<div class="hdr">SYSTEM 1 · idle</div>';

    this.drawMap(agent);
    this.drawProfile();
    if (camera) this.drawLabels(camera);
  }

  drawMap(agent) {
    const sim = this.sim, cv = this.el.map, g = cv.getContext('2d'), S = cv.width;
    const px = (E) => ((E + HALF) / (2 * HALF)) * S, py = (N) => ((HALF - N) / (2 * HALF)) * S;
    g.drawImage(this.mapBg, 0, 0, S, S);
    g.font = '10px system-ui'; g.textAlign = 'center';
    for (const z of sim.world.zones) {
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.setLineDash([3, 3]);
      g.beginPath(); g.arc(px(z.E), py(z.N), (z.r / (2 * HALF)) * S, 0, 7); g.stroke();
      const rr = (z.r / (2 * HALF)) * S, ly = py(z.N) - rr - 3 < 12 ? py(z.N) + rr + 11 : py(z.N) - rr - 3;
      g.setLineDash([]); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillText(z.name, px(z.E), ly);
    }
    for (const it of sim.world.items) {
      if (it.state !== 'world') continue;
      const q = sim.itemPos(it), known = sim.known.has(it.id);
      g.fillStyle = known ? KIND_COLOR[it.kind] : 'rgba(255,255,255,0.18)';
      g.beginPath(); g.arc(px(q.E), py(q.N), known ? 3.5 : 2.5, 0, 7); g.fill();
      if (known) { g.fillStyle = '#fff'; g.fillText(it.id, px(q.E), py(q.N) - 6); }
    }
    for (const [k, color] of [['sub', '#ff9a3c'], ['diver', '#ffffff']]) {
      const tr = sim.trail[k];
      if (tr.length < 2) continue;
      g.strokeStyle = color; g.globalAlpha = 0.7; g.lineWidth = 1.5;
      g.beginPath(); tr.forEach((p, i) => (i ? g.lineTo(px(p.E), py(p.N)) : g.moveTo(px(p.E), py(p.N)))); g.stroke();
      g.globalAlpha = 1; g.lineWidth = 1;
    }
    const tgt = agent?.plan ? sim.targetOf(agent.plan.subgoal) : null;
    if (tgt) {
      g.strokeStyle = '#ff5fd2'; g.setLineDash([4, 3]);
      g.beginPath(); g.moveTo(px(sim.body.E), py(sim.body.N)); g.lineTo(px(tgt.E), py(tgt.N)); g.stroke(); g.setLineDash([]);
      g.strokeStyle = '#ff5fd2'; g.beginPath(); g.arc(px(tgt.E), py(tgt.N), 5, 0, 7); g.stroke();
    }
    const arrow = (p, color, size) => {
      g.save(); g.translate(px(p.E), py(p.N)); g.rotate((p.heading * Math.PI) / 180);
      g.fillStyle = color; g.strokeStyle = '#000'; g.beginPath(); g.moveTo(0, -size); g.lineTo(size * 0.7, size); g.lineTo(-size * 0.7, size); g.closePath(); g.fill(); g.stroke(); g.restore();
    };
    arrow(sim.sub, '#ff9a3c', 6);
    if (sim.active === 'diver') arrow(sim.diver, '#ffffff', 5);
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.textAlign = 'left'; g.fillText('N↑', 4, 12);
  }

  drawProfile() {
    // vertical slice West->East at the active body's North coordinate
    const sim = this.sim, cv = this.el.prof, g = cv.getContext('2d'), W = cv.width, H = cv.height;
    const px = (E) => ((E + HALF) / (2 * HALF)) * W, py = (d) => (d / 200) * H;
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#4fc6d6'); grd.addColorStop(0.35, '#1d6f96'); grd.addColorStop(1, '#06132b');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.fillStyle = '#c9b38a'; g.beginPath(); g.moveTo(0, H);
    for (let i = 0; i <= W; i += 2) g.lineTo(i, py(-floorAt(-HALF + (i / W) * 2 * HALF, sim.body.N)));
    g.lineTo(W, H); g.closePath(); g.fill();
    for (const it of sim.world.items) {
      if (it.state !== 'world' || !sim.known.has(it.id)) continue;
      const q = sim.itemPos(it);
      if (Math.abs(q.N - sim.body.N) > 40) continue;
      g.fillStyle = KIND_COLOR[it.kind]; g.beginPath(); g.arc(px(q.E), py(-q.y), 2.5, 0, 7); g.fill();
    }
    g.fillStyle = '#ff9a3c'; g.fillRect(px(sim.sub.E) - 4, py(-sim.sub.y) - 2.5, 8, 5);
    if (sim.active === 'diver') { g.fillStyle = '#fff'; g.beginPath(); g.arc(px(sim.diver.E), py(-sim.diver.y), 2.5, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = '10px system-ui';
    g.fillText(`depth profile W→E at N=${Math.round(sim.body.N)}`, 4, 11);
  }

  drawLabels(camera) {
    const sim = this.sim, v = new THREE.Vector3(), seen = new Set();
    const W = window.innerWidth, H = window.innerHeight;
    const add = (key, text, cls, pos) => {
      v.set(pos.E, pos.y + 1.2, -pos.N).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return;
      let el = this.labelEls.get(key);
      if (!el) { el = document.createElement('div'); this.el.labels.appendChild(el); this.labelEls.set(key, el); }
      el.className = `label ${cls}`; el.textContent = text;
      el.style.transform = `translate(${((v.x + 1) / 2) * W}px, ${((1 - v.y) / 2) * H}px) translate(-50%, -100%)`;
      seen.add(key);
    };
    for (const it of sim.world.items) {
      if (it.state !== 'world' || !sim.known.has(it.id)) continue;
      const q = sim.itemPos(it);
      if (sim.dist3(sim.body, q) > 60) continue;
      add(it.id, `${it.id} ${it.name}`, it.kind, q);
    }
    if (sim.active === 'diver') add('sub', 'SUB', 'sub', sim.sub);
    for (const [k, el] of this.labelEls) el.style.display = seen.has(k) ? '' : 'none';
  }
}

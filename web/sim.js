// Kinematic simulation + perception. Everything Raon knows comes from observe().
// Compass: 0° = North, 90° = East. Relative bearings: + = to the right. depth = -y (m below surface).
import { floorAt, HALF } from './world.js';

export const BODIES = {
  sub:   { r: 2.3, speed: 12, vspeed: 5, turn: 60, minDepth: 1.0, maxDur: 6, sonar: 45, scanner: 45 },
  diver: { r: 0.5, speed: 2, vspeed: 1.5, turn: 120, minDepth: 0.3, maxDur: 4, sonar: 20, scanner: 0 },
};
export const O2_MAX = 90;          // seconds of air for the diver
export const GRAB_R = 2.5;         // m
export const ENTER_R = 5;          // diver must be this close to the sub to board
export const CARRY_MAX = 3;
export const NEEDS = { fish: 3, salad: 1, mineral: 1 };
export const DT = 0.05;

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
export const norm180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
const r1 = (x) => Math.round(x * 10) / 10;

// how far you can see: bright shallows -> dark deep (the sub's scanner also finds items within 45 m)
export function sightRange(depth) { return Math.max(10, 32 - 0.12 * depth); }

// uniform grid over the world so collision and sonar only look at nearby colliders
const CELL = 10;
class Grid {
  constructor(colliders) {
    this.cells = new Map();
    for (const c of colliders) {
      const pad = c.r + 3;
      for (let i = Math.floor((c.E - pad) / CELL); i <= Math.floor((c.E + pad) / CELL); i++)
        for (let j = Math.floor((c.N - pad) / CELL); j <= Math.floor((c.N + pad) / CELL); j++) {
          const k = i * 100003 + j;
          if (!this.cells.has(k)) this.cells.set(k, []);
          this.cells.get(k).push(c);
        }
    }
  }
  at(E, N) { return this.cells.get(Math.floor(E / CELL) * 100003 + Math.floor(N / CELL)) || []; }
}

export class Sim {
  constructor(world) {
    this.world = world;
    this.grid = new Grid(world.colliders);
    const s = world.start;
    this.sub = { E: s.E, N: s.N, y: -s.depth, heading: s.heading };
    this.diver = { E: s.E, N: s.N, y: -s.depth, heading: s.heading };
    this.active = 'sub';                 // 'sub' | 'diver'
    this.o2 = O2_MAX;
    this.carry = [];                      // item ids held by the diver
    this.stored = [];                     // item ids aboard the sub
    this.known = new Set();
    this.t = 0;
    this.step = 0;
    this.trail = { sub: [{ ...this.sub }], diver: [] };
    this.blackouts = 0;
    this.moving = false;
    this.lastResult = null;
    this.updateSight();
  }

  get body() { return this[this.active]; }
  get spec() { return BODIES[this.active]; }

  fwd(h) { return { E: Math.sin(rad(h)), N: Math.cos(rad(h)) }; }
  bearingFrom(p, E, N) { return (deg(Math.atan2(E - p.E, N - p.N)) + 360) % 360; }
  hdist(p, q) { return Math.hypot(q.E - p.E, q.N - p.N); }
  dist3(p, q) { return Math.hypot(q.E - p.E, q.N - p.N, q.y - p.y); }

  itemPos(it) { return it.posAt(this.t); }
  worldItems() { return this.world.items.filter((it) => it.state === 'world'); }

  sightOf(p = this.body) { return Math.max(sightRange(-p.y), this.spec.scanner); }

  updateSight() {
    const p = this.body, range = this.sightOf(p);
    const fresh = [];
    for (const it of this.worldItems()) {
      if (!this.known.has(it.id) && this.dist3(p, this.itemPos(it)) <= range) { this.known.add(it.id); fresh.push(it.id); }
    }
    return fresh;
  }

  // ---- collisions ----
  collide(p, r) {
    let hit = null;
    for (const c of this.grid.at(p.E, p.N)) {
      if (c.type === 'cyl') {
        if (p.y < c.y0 - r || p.y > c.y1 + r) continue;
        const dx = p.E - c.E, dn = p.N - c.N, d = Math.hypot(dx, dn), m = c.r + r;
        if (d < m && d > 1e-6) { p.E = c.E + (dx / d) * m; p.N = c.N + (dn / d) * m; hit = c.label; }
      } else {
        const dx = p.E - c.E, dn = p.N - c.N, dy = p.y - c.y, d = Math.hypot(dx, dn, dy), m = c.r + r;
        if (d < m && d > 1e-6) { p.E = c.E + (dx / d) * m; p.N = c.N + (dn / d) * m; p.y = c.y + (dy / d) * m; hit = c.label; }
      }
    }
    const lim = HALF - 1;
    if (Math.abs(p.E) > lim || Math.abs(p.N) > lim) { hit = hit || 'edge of the dive area'; }
    p.E = Math.max(-lim, Math.min(lim, p.E));
    p.N = Math.max(-lim, Math.min(lim, p.N));
    return hit;
  }

  // Generator: yields once per DT so the caller can animate or fast-forward.
  *execute(a) {
    const who = this.active, b = this.body, spec = this.spec;
    const start = { ...b };
    const res = { body: who, planned_m: r1(spec.speed * a.throttle * a.duration_s), moved_m: 0, blocked_by: null, do: null };
    this.moving = true;

    let rem = a.turn_deg;
    while (Math.abs(rem) > 1e-3) {
      const d = Math.sign(rem) * Math.min(Math.abs(rem), spec.turn * DT);
      b.heading = (b.heading + d + 360) % 360; rem -= d;
      this.tick(DT);
      yield;
    }

    let blockedTicks = 0;
    for (let tt = 0; tt < a.duration_s - 1e-6; tt += DT) {
      if (this.active !== who) break; // blackout ended the dive
      const f = this.fwd(b.heading);
      const step = spec.speed * a.throttle * DT;
      const want = { E: b.E + f.E * step, N: b.N + f.N * step, y: b.y + spec.vspeed * a.vertical * DT };
      let hit = null;
      const floorAhead = floorAt(want.E, want.N) + spec.r;
      if (floorAhead > b.y + 0.4 && step > 0) { want.E = b.E; want.N = b.N; hit = 'seabed / rock wall ahead'; }
      want.y = Math.min(-spec.minDepth, Math.max(want.y, floorAt(want.E, want.N) + spec.r));
      hit = this.collide(want, spec.r) || hit;
      want.y = Math.min(-spec.minDepth, Math.max(want.y, floorAt(want.E, want.N) + spec.r));
      const moved = Math.hypot(want.E - b.E, want.N - b.N);
      if (hit && step > 0 && moved < step * 0.5) { blockedTicks++; res.blocked_by = hit; }
      Object.assign(b, { E: want.E, N: want.N, y: want.y });
      this.tick(DT);
      yield;
    }
    res.moved_m = r1(this.dist3(start, b));
    if (blockedTicks * DT < 0.25 * a.duration_s) res.blocked_by = null;

    if (this.active === who && a.do && a.do !== 'none') res.do = this.perform(a.do);
    this.trail[this.active].push({ ...this.body });
    this.moving = false;
    this.step++;
    res.new_items_seen = this.updateSight();
    if (this.lastEvent) { res.event = this.lastEvent; this.lastEvent = null; }
    this.lastResult = { action: a, ...res };
    return this.lastResult;
  }

  tick(dt) {
    this.t += dt;
    if (this.active === 'sub') { this.diver.E = this.sub.E; this.diver.N = this.sub.N; this.diver.y = this.sub.y; return; }
    if (-this.diver.y < 0.8) { this.o2 = O2_MAX; return; } // breathing at the surface
    this.o2 -= dt;
    if (this.o2 <= 0) this.blackout();
  }

  blackout() {
    this.blackouts++;
    for (const id of this.carry) this.world.items.find((x) => x.id === id).state = 'world';
    this.lastEvent = `BLACKOUT: diver ran out of air, was hauled back into the sub and dropped ${this.carry.length ? this.carry.join(', ') : 'nothing'} (items returned to where they were found)`;
    this.carry = [];
    this.o2 = O2_MAX;
    this.active = 'sub';
  }

  perform(what) {
    if (what === 'exit') {
      if (this.active !== 'sub') return { ok: false, reason: 'diver is already outside' };
      const s = this.sub, f = this.fwd(s.heading);
      const p = { E: s.E, N: s.N, y: s.y - 3.2, heading: s.heading };
      if (p.y < floorAt(p.E, p.N) + 0.6) { p.y = s.y; p.E = s.E + f.N * 3.2; p.N = s.N - f.E * 3.2; }
      this.collide(p, BODIES.diver.r);
      Object.assign(this.diver, p);
      this.active = 'diver';
      this.o2 = O2_MAX;
      this.trail.diver.push({ ...this.diver });
      return { ok: true, info: 'diver exited the sub (hatch is underneath)' };
    }
    if (what === 'enter') {
      if (this.active !== 'diver') return { ok: false, reason: 'diver is already inside' };
      const d = this.dist3(this.diver, this.sub);
      if (d > ENTER_R) return { ok: false, reason: `sub is ${r1(d)} m away (need <= ${ENTER_R} m)` };
      const delivered = [...this.carry];
      this.stored.push(...this.carry);
      for (const id of this.carry) this.world.items.find((x) => x.id === id).state = 'stored';
      this.carry = [];
      this.active = 'sub';
      this.o2 = O2_MAX;
      return { ok: true, info: `diver boarded the sub; stored ${delivered.length ? delivered.join(', ') : 'nothing'}; air refilled` };
    }
    if (what === 'grab') {
      if (this.active !== 'diver') return { ok: false, reason: 'the sub has no arm - only the diver can grab items' };
      if (this.carry.length >= CARRY_MAX) return { ok: false, reason: `hands full (${CARRY_MAX} items) - return to the sub to store them` };
      let best = null, bd = Infinity;
      for (const it of this.worldItems()) {
        const d = this.dist3(this.diver, this.itemPos(it));
        if (d < bd) { bd = d; best = it; }
      }
      if (best && bd <= GRAB_R) {
        best.state = 'carried';
        this.carry.push(best.id);
        return { ok: true, id: best.id, info: `grabbed ${best.id} (${best.name})` };
      }
      return { ok: false, reason: best ? `nearest item ${best.id} is ${r1(bd)} m away (need <= ${GRAB_R} m)` : 'nothing left' };
    }
    return { ok: false, reason: `unknown action ${what}` };
  }

  isFree(p, r) {
    if (floorAt(p.E, p.N) + r > p.y) return false;
    for (const c of this.grid.at(p.E, p.N)) {
      if (c.type === 'cyl') { if (p.y >= c.y0 - r && p.y <= c.y1 + r && Math.hypot(p.E - c.E, p.N - c.N) < c.r + r) return false; }
      else if (Math.hypot(p.E - c.E, p.N - c.N, p.y - c.y) < c.r + r) return false;
    }
    return true;
  }

  // ---- perception ----
  rays() {
    const p = this.body, r = this.spec.r, range = this.spec.sonar, out = [];
    for (let rel = -80; rel <= 80; rel += 20) {
      const h = (p.heading + rel + 360) % 360, f = this.fwd(h);
      let best = range, what = null;
      for (let s = 0.5; s < best; s += range > 30 ? 1.5 : 0.75) {
        const q = { E: p.E + f.E * s, N: p.N + f.N * s, y: p.y };
        if (Math.abs(q.E) > HALF - 1 || Math.abs(q.N) > HALF - 1) { best = s; what = 'edge of dive area'; break; }
        if (floorAt(q.E, q.N) + r > p.y + 0.4) { best = s; what = 'seabed rising / rock wall'; break; }
        for (const c of this.grid.at(q.E, q.N)) {
          let inside = false;
          if (c.type === 'cyl') inside = q.y >= c.y0 - r && q.y <= c.y1 + r && Math.hypot(q.E - c.E, q.N - c.N) < c.r + r;
          else inside = Math.hypot(q.E - c.E, q.N - c.N, q.y - c.y) < c.r + r;
          if (inside) { best = s; what = c.label; break; }
        }
        if (what) break;
      }
      out.push({ rel, dist: what ? r1(best) : null, what });
    }
    return out;
  }

  relInfo(p, q) {
    const hd = this.hdist(p, q);
    return { dist: r1(this.dist3(p, q)), horiz: r1(hd), rel: Math.round(norm180(this.bearingFrom(p, q.E, q.N) - p.heading)),
      compass: Math.round(this.bearingFrom(p, q.E, q.N)), dy: r1(q.y - p.y) };
  }

  itemInfo(it, p = this.body) {
    const q = this.itemPos(it);
    const info = { id: it.id, kind: it.kind, name: it.name, E: Math.round(q.E), N: Math.round(q.N), depth: r1(-q.y), ...this.relInfo(p, q) };
    if (it.kind === 'fish') info.moving = true;
    info.grabbable = this.active === 'diver' && info.dist <= GRAB_R;
    return info;
  }

  visibleItems() {
    const range = this.sightOf();
    return this.worldItems().map((it) => this.itemInfo(it)).filter((i) => i.dist <= range).sort((a, b) => a.dist - b.dist);
  }

  knownItems() {
    return this.worldItems().filter((it) => this.known.has(it.id)).map((it) => this.itemInfo(it)).sort((a, b) => a.dist - b.dist);
  }

  inventory() {
    const count = (ids, k) => ids.filter((id) => id[0] === { fish: 'F', salad: 'S', mineral: 'M' }[k]).length;
    const stored = {}, carried = {};
    for (const k of Object.keys(NEEDS)) { stored[k] = count(this.stored, k); carried[k] = count(this.carry, k); }
    const missing = Object.fromEntries(Object.entries(NEEDS).map(([k, n]) => [k, Math.max(0, n - stored[k])]));
    return { stored, carried, missing, done: Object.values(missing).every((v) => v === 0) };
  }

  targetOf(sg) {
    if (!sg) return null;
    if (sg.type === 'item') {
      const it = this.world.items.find((x) => x.id === sg.id);
      if (!it || it.state !== 'world' || !this.known.has(it.id)) return null;
      return { ...this.itemPos(it), reach: GRAB_R, label: `${it.id} ${it.name}`, item: true };
    }
    if (sg.type === 'zone') {
      const z = this.world.zones.find((x) => x.id === sg.id);
      if (!z) return null;
      const y = Number.isFinite(sg.depth) ? -sg.depth : -z.parkDepth;
      return { E: z.E, N: z.N, y, reach: this.active === 'sub' ? 12 : 6, label: `${z.id} ${z.name} @${-y}m` };
    }
    if (sg.type === 'sub') return { ...this.sub, reach: ENTER_R, label: 'the sub' };
    if (sg.type === 'waypoint' && Number.isFinite(sg.E) && Number.isFinite(sg.N)) {
      const y = Number.isFinite(sg.depth) ? -sg.depth : this.body.y;
      return { E: sg.E, N: sg.N, y, reach: 4, label: `waypoint (E${Math.round(sg.E)}, N${Math.round(sg.N)}, ${Math.round(-y)}m)` };
    }
    return null;
  }

  poseInfo(p = this.body) {
    return { E: r1(p.E), N: r1(p.N), depth: r1(-p.y), heading: Math.round(p.heading),
      floor_below_m: r1(p.y - floorAt(p.E, p.N)) };
  }
}

// The decision loop. SYSTEM 2 (planner) is called on events; SYSTEM 1 (motor) every step. Both are Raon.
import { S1_SYSTEM, S2_SYSTEM, s1Prompt, s2Prompt, lessonsBlock } from './prompts.js';
import { BODIES } from './sim.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, Number.isFinite(+x) ? +x : 0));

export function extractJson(text) {
  if (!text) return null;
  const s = text.replace(/```(?:json)?/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

async function chat(messages, max_tokens) {
  const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, max_tokens, temperature: 0.3 }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export class Agent {
  // hooks: { execute(action) -> Promise<result>, shot(name, view), log(event), onUpdate(state) }
  constructor(sim, hooks, opts = {}) {
    this.sim = sim;
    this.hooks = hooks;
    this.maxSteps = opts.maxSteps || 200;
    this.shotEvery = opts.shotEvery || 4;
    this.plan = null;
    this.history = [];
    this.lastS2Step = -99;
    this.pending = ['mission start'];
    this.blockedStreak = 0;
    this.airWarned = false;
    this.lastThought = '';
    this.stats = { s1Calls: 0, s2Calls: 0, s1ms: 0, s2ms: 0, parseFailures: 0, errors: 0 };
    this.shotN = 0;
  }

  async shot(label, view = 'chase') {
    const name = `${String(this.shotN++).padStart(3, '0')}_s${this.sim.step}_${label}${view === 'chase' ? '' : '_' + view}`;
    await this.hooks.shot(name, view);
  }

  async system2(trigger) {
    const user = s2Prompt(this.sim, this.plan, trigger, this.history);
    const messages = [{ role: 'system', content: S2_SYSTEM + this.lessons }, { role: 'user', content: user }];
    let res, parsed = null;
    const rejected = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await chat(messages, 2500);
      parsed = extractJson(res.content);
      if (!parsed) { this.stats.parseFailures++; continue; }
      const problem = this.checkSubgoal(parsed.subgoal);
      if (!problem) break;
      // bounce invalid plans straight back to SYSTEM 2 instead of letting SYSTEM 1 flail
      rejected.push({ subgoal: parsed.subgoal, problem });
      this.stats.rejectedPlans = (this.stats.rejectedPlans || 0) + 1;
      messages.push({ role: 'assistant', content: res.content },
        { role: 'user', content: `REJECTED: ${problem} Reply again with corrected JSON only.` });
      parsed = null;
    }
    this.stats.s2Calls++; this.stats.s2ms += res.latency_ms;
    if (parsed && parsed.subgoal) {
      const sg = parsed.subgoal;
      for (const k of ['E', 'N', 'depth']) sg[k] = sg[k] == null ? null : Number(sg[k]);
      const same = this.plan && JSON.stringify(this.plan.subgoal) === JSON.stringify(sg);
      this.plan = { flagged: same && this.plan.flagged, assessment: parsed.assessment || '', plan: parsed.plan || '', subgoal: sg,
        body: parsed.body === 'diver' ? 'diver' : 'sub', guidance: String(parsed.guidance || ''), trigger, step: this.sim.step };
    }
    this.lastS2Step = this.sim.step;
    this.hooks.log({ type: 's2', step: this.sim.step, t: this.sim.t, trigger, prompt: user, content: res.content,
      reasoning: res.reasoning, latency_ms: res.latency_ms, usage: res.usage, parsed, rejected, plan: this.plan });
  }

  checkSubgoal(sg) {
    const sim = this.sim;
    if (!sg || typeof sg !== 'object') return 'missing "subgoal" object.';
    if (sg.type === 'item') {
      const it = sim.world.items.find((x) => x.id === sg.id);
      if (!it) return `there is no item "${sg.id}".`;
      if (!sim.known.has(it.id)) return `${sg.id} has not been seen yet - you only know the items listed under KNOWN ITEMS. To find new ones, send the sub (or diver) to the zone where they live.`;
      if (it.state !== 'world') return `${sg.id} was already taken.`;
      return null;
    }
    if (sg.type === 'zone') {
      const z = sim.world.zones.find((x) => x.id === sg.id);
      if (!z) return `there is no zone "${sg.id}" (valid: ${sim.world.zones.map((x) => x.id).join(', ')}).`;
      const t = sim.targetOf({ ...sg, depth: Number.isFinite(sg.depth) ? sg.depth : null });
      const here = t && sim.dist3(sim.body, t) <= t.reach;
      const knownLeft = sim.knownItems().filter((i) => Math.hypot(i.E - z.E, i.N - z.N) <= z.r + 6);
      if (here && !knownLeft.length) return `the active body is already at ${z.name} and no known items remain there. Pick a different zone, or a known item.`;
      return null;
    }
    if (sg.type === 'sub') return sim.active === 'diver' ? null : 'the diver is already inside the sub.';
    if (sg.type === 'waypoint') return Number.isFinite(+sg.E) && Number.isFinite(+sg.N) ? null : 'waypoint needs numeric E and N.';
    return `unknown subgoal type "${sg.type}" (use zone, item, sub or waypoint).`;
  }

  async system1() {
    const user = s1Prompt(this.sim, this.plan);
    const messages = [{ role: 'system', content: S1_SYSTEM + this.lessons }, { role: 'user', content: user }];
    let res, p = null;
    for (let attempt = 0; attempt < 2 && !p; attempt++) {
      res = await chat(messages, 1500);
      p = extractJson(res.content);
      if (!p) this.stats.parseFailures++;
    }
    this.stats.s1Calls++; this.stats.s1ms += res.latency_ms;
    p = p || { thought: '(unparseable reply - holding still)', duration_s: 1 };
    const action = {
      thought: String(p.thought || '').slice(0, 160),
      turn_deg: Math.round(clamp(p.turn_deg, -180, 180)),
      throttle: +clamp(p.throttle, 0, 1).toFixed(2),
      vertical: +clamp(p.vertical, -1, 1).toFixed(2),
      duration_s: +clamp(p.duration_s || 1, 0.5, BODIES[this.sim.active].maxDur).toFixed(1),
      do: ['exit', 'enter', 'grab'].includes(p.do) ? p.do : 'none',
      replan: !!p.replan,
    };
    this.lastThought = action.thought;
    this.hooks.log({ type: 's1', step: this.sim.step, t: this.sim.t, prompt: user, content: res.content,
      reasoning: res.reasoning, latency_ms: res.latency_ms, usage: res.usage, action });
    return action;
  }

  notice(result) {
    const sim = this.sim, r = result;
    if (r.event?.startsWith('BLACKOUT')) this.pending.push('diver blacked out');
    if (r.do?.ok && r.action.do === 'grab') this.pending.push(`diver grabbed ${r.do.id}`);
    if (r.do?.ok && r.action.do === 'exit') this.pending.push('diver just exited the sub');
    if (r.do?.ok && r.action.do === 'enter') this.pending.push('diver just entered the sub');
    if (r.action.replan) this.pending.push('SYSTEM 1 requested a replan');
    this.blockedStreak = r.blocked_by ? this.blockedStreak + 1 : 0;
    if (this.blockedStreak >= 3) { this.pending.push(`stuck: blocked by ${r.blocked_by} for 3 steps`); this.blockedStreak = 0; }
    if (sim.active === 'diver' && sim.o2 < 35 && !this.airWarned) { this.pending.push(`diver air low (${Math.round(sim.o2)} s)`); this.airWarned = true; }
    if (sim.active === 'sub') this.airWarned = false;
    if (this.plan && !this.plan.flagged) {  // each plan raises at most one of these
      const tgt = sim.targetOf(this.plan.subgoal);
      const before = this.pending.length;
      if (!tgt && this.plan.subgoal?.type !== 'item') this.pending.push('current subgoal is not valid');
      else if (!tgt && this.plan.subgoal?.type === 'item' && !(r.do?.ok && r.action.do === 'grab')) this.pending.push(`subgoal item ${this.plan.subgoal.id} is unknown or gone`);
      else if (tgt && !tgt.item && this.plan.subgoal.type !== 'sub' && sim.dist3(sim.body, tgt) <= tgt.reach) this.pending.push(`subgoal reached (${tgt.label})`);
      if (this.pending.length > before) this.plan.flagged = true;
    }
    if (r.new_items_seen?.length && sim.step - this.lastS2Step >= 3) this.pending.push(`new items spotted: ${r.new_items_seen.join(', ')}`);
    if (sim.step - this.lastS2Step >= 10) this.pending.push('periodic check (10 steps since last plan)');
  }

  async run() {
    const sim = this.sim;
    try { this.lessons = lessonsBlock((await (await fetch('/api/lessons')).json()).lessons); } catch { this.lessons = ''; }
    this.hooks.log({ type: 'start', t: Date.now(), maxSteps: this.maxSteps, lessons: this.lessons });
    await this.shot('start', 'overview');
    let outcome = 'out of steps', consecutiveErrors = 0;

    while (sim.step < this.maxSteps) {
      try {
        if (this.pending.length) {
          const trigger = [...new Set(this.pending)].join('; ');
          this.pending = [];
          this.hooks.onUpdate?.({ phase: 's2', agent: this });
          await this.system2(trigger);
          this.hooks.onUpdate?.({ phase: 'plan', agent: this });
          await this.shot('plan');
        }
        this.hooks.onUpdate?.({ phase: 's1', agent: this });
        const action = await this.system1();
        this.hooks.onUpdate?.({ phase: 'act', agent: this, action });
        const result = await this.hooks.execute(action);
        consecutiveErrors = 0;
        const a = result.action;
        this.history.push(`step ${sim.step - 1} [${result.body}] "${a.thought}" -> moved ${result.moved_m} m` +
          (result.blocked_by ? `, blocked by ${result.blocked_by}` : '') +
          (result.do ? `, ${a.do} ${result.do.ok ? 'OK' : 'FAILED (' + result.do.reason + ')'}` : '') + (result.event ? `, ${result.event}` : ''));
        this.hooks.log({ type: 'result', step: sim.step - 1, t: sim.t, result, pose: sim.poseInfo(), active: sim.active, o2: sim.o2,
          carry: [...sim.carry], stored: [...sim.stored] });
        this.notice(result);
        this.hooks.onUpdate?.({ phase: 'done-step', agent: this });

        const eventful = result.do?.ok || result.event || (result.do && !result.do.ok);
        if (eventful) await this.shot(result.event ? 'blackout' : `${a.do}${result.do.ok ? '' : '_fail'}`);
        else if (sim.step % this.shotEvery === 0) await this.shot('step');

        if (sim.inventory().done) { outcome = 'success'; break; }
      } catch (e) {
        this.stats.errors++;
        this.hooks.log({ type: 'error', step: sim.step, message: String(e.message || e) });
        console.error('agent error', e);
        if (++consecutiveErrors >= 5) { outcome = 'aborted (API errors)'; break; }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    const summary = {
      outcome, steps: sim.step, sim_time_s: Math.round(sim.t), inventory: sim.inventory(), stored: sim.stored,
      blackouts: sim.blackouts, known_items: [...sim.known], stats: this.stats,
      avg_latency_ms: { s1: Math.round(this.stats.s1ms / Math.max(1, this.stats.s1Calls)), s2: Math.round(this.stats.s2ms / Math.max(1, this.stats.s2Calls)) },
    };
    this.hooks.log({ type: 'end', ...summary });
    this.hooks.onUpdate?.({ phase: 'end', agent: this, summary });
    await this.shot('end');
    await this.shot('end', 'overview');
    return summary;
  }
}

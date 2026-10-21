// Prompt text for Raon. SYSTEM 2 = slow planner, SYSTEM 1 = fast motor control. Both are Raon.
import { BODIES, O2_MAX, GRAB_R, ENTER_R, CARRY_MAX } from './sim.js';
import { HALF } from './world.js';

const WORLD_RULES = `WORLD
- Area: ${2 * HALF} m x ${2 * HALF} m (a big ocean), depth 0-190 m. Coordinates: E (east, -${HALF}..${HALF}), N (north, -${HALF}..${HALF}), depth in metres (positive = down). Compass: 0=N, 90=E, 180=S, 270=W.
- SUB "Minnow": ${BODIES.sub.speed} m/s forward, ${BODIES.sub.vspeed} m/s vertical, radius ${BODIES.sub.r} m, commands up to ${BODIES.sub.maxDur} s (so up to ${BODIES.sub.speed * BODIES.sub.maxDur} m per command). Its scanner reveals items within ${BODIES.sub.scanner} m. It CANNOT grab anything, CANNOT fit between kelp stalks or into the Crystal Crevice.
- DIVER: ${BODIES.diver.speed} m/s forward, ${BODIES.diver.vspeed} m/s vertical, radius ${BODIES.diver.r} m, commands up to ${BODIES.diver.maxDur} s, carries at most ${CARRY_MAX} items, ${O2_MAX} s of air. Air refills inside the sub or at the surface (depth < 0.8 m).
- If the diver's air reaches 0 it BLACKS OUT: carried items are lost (they return to where they were found) and the diver is hauled back into the sub.
- Items count only when the diver ENTERS the sub (within ${ENTER_R} m of it) while carrying them.
- Fish swim slowly (~0.45 m/s) in small circles (~2.6 m radius) around their home spot.
- Visibility for the diver: ~30 m near the surface, ~10 m in the deep. Long trips: cruise the sub at depth ~15-30 m (fast, few obstacles), then descend at the destination.`;

export const S2_SYSTEM = `You are SYSTEM 2: the slow, deliberate planner of an underwater mission. You command a small submarine and a diver who can leave it. A fast controller (SYSTEM 1) executes your subgoals one motor command at a time.

MISSION: store these lunch ingredients aboard the sub: 3 fish (any species), 1 sea lettuce (salad), 1 salt crystal (mineral). The mission succeeds the moment all are aboard. Fewer steps is better.

${WORLD_RULES}

GOOD PRACTICE
- Park the sub as close to the target as it can get (above the kelp canopy at ~3 m depth, or near the crevice), stop, then send the diver out.
- Budget the diver's air: time back to the sub = distance / ${BODIES.diver.speed} m/s. Turn back with a 30% margin.
- Batch: one dive can collect up to ${CARRY_MAX} items if they are close together.

Reply with ONLY a JSON object:
{"assessment":"1-2 sentences","plan":"overall remaining sequence, short","subgoal":{"type":"zone|item|sub|waypoint","id":"e.g. Z2, F3, or null","E":null,"N":null,"depth":null},"body":"sub|diver","guidance":"concrete instruction for SYSTEM 1, max 30 words"}
Subgoal types: "zone" = move the active body to a zone (default park depth, or give depth); "item" = diver goes to a KNOWN item and grabs it; "sub" = diver returns to the sub and enters; "waypoint" = go to E, N, depth.
"body" is the body that should be active for this subgoal. If it differs from the active body, say in guidance that SYSTEM 1 must exit or enter first.`;

export const S1_SYSTEM = `You are SYSTEM 1: the fast reflex controller of an underwater mission. Each call you output ONE motor command for the ACTIVE body (sub or diver), to achieve the SUBGOAL and follow the GUIDANCE from SYSTEM 2.

${WORLD_RULES}

COMMAND - reply with ONLY this JSON:
{"thought":"max 15 words","turn_deg":0,"throttle":0.0,"vertical":0.0,"duration_s":2,"do":"none","replan":false}
Execution: 1) turn in place by turn_deg (-180..180, + = right/clockwise); 2) for duration_s (0.5..max for the body) move forward at throttle (0..1) x max speed while moving vertically at vertical (-1..1) x max vertical speed; 3) perform "do": none | exit | enter | grab.
- vertical +1 = UP (shallower), -1 = DOWN (deeper). Target dy < 0 means it is BELOW you.
- forward distance = throttle x speed x duration. Vertical change = vertical x vspeed x duration. Do not overshoot: aim to stop ~1 m short.
- To face a target at relative bearing b, use turn_deg = b.
- exit: only from the sub (the diver appears just under it). enter: diver within ${ENTER_R} m of the sub. grab: diver within ${GRAB_R} m (3D) of an item; grab is done AFTER moving, so you can approach and grab in the same command.
- Fish move: when close, approach and grab in the same command.
- AIR SAFETY: if air_s < (distance_to_sub / ${BODIES.diver.speed}) + 12, abandon everything and head for the sub, then enter.
- SONAR lists the distance to the nearest obstacle at each relative bearing; steer toward clear bearings.
- Set "replan": true only if the subgoal is finished, impossible, or makes no sense.`;

const fmtRel = (i) => `${i.dist} m (horiz ${i.horiz}), rel ${i.rel >= 0 ? '+' : ''}${i.rel}°, dy ${i.dy >= 0 ? '+' : ''}${i.dy}${i.dy < -0.5 ? ' (below)' : i.dy > 0.5 ? ' (above)' : ''}`;

function fmtAction(r) {
  if (!r) return 'none yet';
  const a = r.action;
  let s = `[${r.body}] turn ${a.turn_deg >= 0 ? '+' : ''}${a.turn_deg}°, throttle ${a.throttle}, vertical ${a.vertical}, ${a.duration_s} s -> moved ${r.moved_m} m (planned fwd ${r.planned_m} m)`;
  if (r.blocked_by) s += `, BLOCKED by ${r.blocked_by}`;
  if (r.do) s += `; ${a.do}: ${r.do.ok ? 'OK - ' + r.do.info : 'FAILED - ' + r.do.reason}`;
  if (r.event) s += `; ${r.event}`;
  return s;
}

function header(sim) {
  const spec = BODIES[sim.active], p = sim.poseInfo();
  const inv = sim.inventory();
  const lines = [
    `STEP ${sim.step} | sim time ${Math.round(sim.t)} s | ACTIVE BODY: ${sim.active.toUpperCase()} (max ${spec.speed} m/s forward, ${spec.vspeed} m/s vertical, max duration ${spec.maxDur} s)`,
    `POSE: E=${p.E} N=${p.N} depth=${p.depth} m heading=${p.heading}° | seabed ${p.floor_below_m} m below`,
  ];
  if (sim.active === 'diver') {
    const s = sim.relInfo(sim.body, sim.sub);
    lines.push(`AIR: ${Math.round(sim.o2)} s left of ${O2_MAX} | swim-back time to sub ~${Math.ceil(s.dist / BODIES.diver.speed)} s`);
    lines.push(`SUB: ${fmtRel(s)} | enter possible: ${s.dist <= ENTER_R ? 'YES' : 'no'}`);
    lines.push(`CARRYING: ${sim.carry.length ? sim.carry.join(', ') : 'nothing'} (${sim.carry.length}/${CARRY_MAX})`);
  } else {
    lines.push(`DIVER: inside the sub${sim.carry.length ? '' : ''}`);
  }
  lines.push(`STORED ABOARD: fish ${inv.stored.fish}/3, salad ${inv.stored.salad}/1, mineral ${inv.stored.mineral}/1 | still missing: ${Object.entries(inv.missing).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing'}`);
  return lines;
}

function fmtSonar(sim) {
  return sim.rays().map((r) => `${r.rel >= 0 ? '+' : ''}${r.rel}°: ${r.dist == null ? 'clear' : `${r.what} ${r.dist} m`}`).join(' | ');
}

function fmtItems(list) {
  return list.length ? list.map((i) => `${i.id} ${i.name} ${fmtRel(i)}${i.moving ? ' (swimming)' : ''}${i.grabbable ? ' [GRABBABLE NOW]' : ''}`).join('\n  ') : 'none';
}

function availableActions(sim) {
  if (sim.active === 'sub') return 'exit (diver leaves the sub) | none';
  const out = [];
  const grabbable = sim.visibleItems().filter((i) => i.grabbable);
  if (grabbable.length) out.push(`grab (${grabbable.map((i) => i.id).join(', ')} within reach)`);
  else out.push('grab: nothing within 2.5 m yet');
  out.push(sim.dist3(sim.diver, sim.sub) <= ENTER_R ? 'enter (sub within reach)' : 'enter: sub too far');
  return out.join(' | ');
}

export function s1Prompt(sim, plan) {
  const lines = header(sim);
  const tgt = plan ? sim.targetOf(plan.subgoal) : null;
  if (plan) {
    lines.push(`SUBGOAL (from SYSTEM 2): ${JSON.stringify(plan.subgoal)} for body ${plan.body}`);
    lines.push(tgt ? `  -> target ${tgt.label}: ${fmtRel(sim.relInfo(sim.body, tgt))}${sim.dist3(sim.body, tgt) <= tgt.reach ? ' [REACHED]' : ''}`
      : '  -> target is not valid (unknown, already taken, or bad id). Set replan=true unless guidance says otherwise.');
    lines.push(`GUIDANCE: "${plan.guidance}"`);
    if (plan.body !== sim.active) {
      lines.push(plan.body === 'diver'
        ? 'BODY SWITCH NEEDED: SYSTEM 2 wants the DIVER active, but you are driving the SUB. Once the sub is within ~8 m of the target, stop and use do:"exit" (you can exit in the same command as a final small move).'
        : 'BODY SWITCH NEEDED: SYSTEM 2 wants the SUB active. Swim the diver back to the sub and use do:"enter" when within 5 m.');
    }
  }
  lines.push(`ACTIONS AVAILABLE NOW: ${availableActions(sim)}`);
  lines.push(`LAST STEP: ${fmtAction(sim.lastResult)}`);
  lines.push(`SONAR (range ${BODIES[sim.active].sonar} m, at your depth): ${fmtSonar(sim)}`);
  lines.push(`ITEMS IN SIGHT (range ~${Math.round(sim.sightOf())} m):\n  ${fmtItems(sim.visibleItems())}`);
  return lines.join('\n');
}

export function s2Prompt(sim, plan, trigger, history) {
  const lines = header(sim);
  lines.push(`WHY YOU ARE CALLED: ${trigger}`);
  lines.push(`SUB position: E=${Math.round(sim.sub.E)} N=${Math.round(sim.sub.N)} depth=${(-sim.sub.y).toFixed(1)} m`);
  lines.push('ZONES (from the PDA map):');
  for (const z of sim.world.zones) {
    const r = sim.relInfo(sim.body, { E: z.E, N: z.N, y: -z.parkDepth });
    lines.push(`  ${z.id} ${z.name} at E=${z.E} N=${z.N} (park depth ${z.parkDepth} m) - ${r.horiz} m away, compass ${r.compass}°: ${z.desc}`);
  }
  const known = sim.knownItems();
  lines.push(`KNOWN ITEMS NOT YET TAKEN (seen so far; items are only discovered within sight range):\n  ${known.length ? known.map((i) => `${i.id} ${i.name} at E=${i.E} N=${i.N} depth=${i.depth} - ${i.dist} m from active body`).join('\n  ') : 'none yet'}`);
  lines.push(`CURRENT PLAN: ${plan ? JSON.stringify({ plan: plan.plan, subgoal: plan.subgoal, body: plan.body, guidance: plan.guidance }) : 'none (mission start)'}`);
  lines.push(`RECENT STEPS:\n  ${history.length ? history.slice(-8).join('\n  ') : 'none'}`);
  lines.push(`SONAR: ${fmtSonar(sim)}`);
  return lines.join('\n');
}

export function lessonsBlock(lessons) {
  const t = (lessons || '').replace(/<!--[\s\S]*?-->/g, '').replace(/^#.*$/m, '').trim();
  return t ? `\n\nLESSONS FROM PREVIOUS RUNS (written by a supervisor who reviewed screenshots - follow them):\n${t}` : '';
}

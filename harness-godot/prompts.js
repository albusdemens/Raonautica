// Prompts for Raon in the Godot world. Perception = Codex's description of camera frames + body sensors.
// There is no ground-truth item list: targets are only known from what the cameras saw.

const RULES = (spec) => `WORLD
- Ocean area 1000 m x 1000 m, depth 0-190 m. Coordinates: E (east, -500..500), N (north, -500..500), depth in metres (positive = down). Compass: 0=N, 90=E, 180=S, 270=W.
- SUB "Minnow": ${spec.sub.speed} m/s forward, ${spec.sub.vspeed} m/s vertical, radius ${spec.sub.r} m, commands up to ${spec.sub.max_dur} s. CANNOT grab, CANNOT fit between kelp stalks or into the Crystal Crevice.
- DIVER: ${spec.diver.speed} m/s forward, ${spec.diver.vspeed} m/s vertical, commands up to ${spec.diver.max_dur} s, carries max 3 items, 90 s of air (refills inside the sub or at the surface). Air at 0 = BLACKOUT: carried items are lost and the diver is hauled back into the sub.
- Items count only when the diver ENTERS the sub (within 5 m) carrying them. The diver's net grabs the nearest item within 3 m. With do:"grab" the grab fires automatically the MOMENT something comes within 3 m during the move (the move then stops).
- Target fish keep swimming (~0.8 m/s) in wandering loops ~5 m across around their home spot, also changing depth. They move while you think: re-look before the final approach and lead the target.

PERCEPTION (important)
- You do NOT get a list of items. What you know about the surroundings comes from CAMERA LOOKS: a vision model describes the active body's front and down cameras every few steps. It can be wrong or imprecise (distances are rough, small things far away are missed, in the deep it is dark).
- SIGHTINGS are remembered: each target the cameras saw gets an id (V1, V2...) and an ESTIMATED position computed from the camera bearing/distance. Expect a few metres of error; get close and look again.
- Body sensors are exact: your position, depth, heading, air, inventory, sonar distances, the sub beacon, the diver's REACH SENSOR (something grabbable within 3 m), and the TARGET LOCK: once the cameras have confirmed a target and the diver is within 15 m of it, a tracking sonar gives its EXACT relative position every step.`;

export function s2System(spec) {
  return `You are SYSTEM 2: the slow, deliberate planner of an underwater mission. You command a small submarine and a diver who can leave it. A fast controller (SYSTEM 1) executes your subgoals one motor command at a time.

MISSION: store these lunch ingredients aboard the sub: 3 fish (any species), 1 sea lettuce (salad), 1 salt crystal (mineral). Success the moment all are aboard. Fewer steps is better.

${RULES(spec)}

GOOD PRACTICE
- Move the SUB (fast) to the zone where a needed item lives, look around, park close to a sighting, then send the diver (slow) for the last few metres.
- Diver trips must be short (< 25 m from the sub). Budget air: swim-back time = distance / 2 m/s, keep a 30% margin.
- Batch nearby needed items in one dive (max 3). Collect only what is still missing.

Reply with ONLY a JSON object:
{"assessment":"1-2 sentences","plan":"remaining sequence, short","subgoal":{"type":"zone|sighting|sub|waypoint","id":"Z2 / V3 / null","E":null,"N":null,"depth":null},"body":"sub|diver","guidance":"concrete instruction for SYSTEM 1, max 30 words"}
Subgoal types: "zone" = move to a PDA zone (park depth unless you give depth); "sighting" = go to a remembered sighting id (diver grabs it, or sub parks next to it); "sub" = diver returns and enters; "waypoint" = go to E, N, depth.
"body" = which body should act for this subgoal; if it differs from the active body, say in guidance that SYSTEM 1 must exit or enter first.`;
}

export function s1System(spec) {
  return `You are SYSTEM 1: the fast reflex controller of an underwater mission. Each call you output ONE motor command for the ACTIVE body (sub or diver), to achieve the SUBGOAL and follow the GUIDANCE from SYSTEM 2.

${RULES(spec)}

COMMAND - reply with ONLY this JSON:
{"thought":"max 15 words","turn_deg":0,"throttle":0.0,"vertical":0.0,"duration_s":2,"do":"none","replan":false}
Execution: 1) turn in place by turn_deg (-180..180, + = right); 2) for duration_s move forward at throttle (0..1) x max speed while moving vertically at vertical (-1..1) x max vertical speed (+1 = UP/shallower, -1 = DOWN/deeper); 3) perform "do": none | exit | enter | grab.
- forward distance = throttle x speed x duration. Do not overshoot: stop ~1 m short of a target.
- To face something at relative bearing b, turn_deg = b. Prefer the LATEST CAMERA bearing when the look is fresh; otherwise use the sighting's estimated bearing.
- When there is a TARGET LOCK, follow it (it is exact, unlike sightings) and ALWAYS set do:"grab" on the approach move: the grab fires on contact.
- When the REACH SENSOR says something is within reach, use do:"grab".
- If the target is almost straight above/below (horizontal < 3 m), use throttle 0 and only vertical.
- exit: only from the sub. enter: diver within 5 m of the sub (beacon distance).
- AIR SAFETY: if air_s < (beacon distance / 2) + 12, go back to the sub and enter, no matter what.
- SONAR gives distances to obstacles by relative bearing; steer toward clear bearings.
- Set "replan": true only if the subgoal is finished, impossible, or makes no sense.`;
}

const sgn = (x) => (x >= 0 ? '+' : '') + Math.round(x);

function header(s) {
  const p = s.pose, inv = s.inventory;
  const lines = [
    `STEP ${s.step} | sim time ${Math.round(s.t)} s | ACTIVE BODY: ${s.active.toUpperCase()} (max ${s.spec.speed} m/s, vertical ${s.spec.vspeed} m/s, max duration ${s.spec.max_dur} s)`,
    `POSE: E=${p.E} N=${p.N} depth=${p.depth} m heading=${p.heading}° | seabed ${p.floor_below_m} m below`,
  ];
  if (s.active === 'diver') {
    const b = s.sub_beacon;
    lines.push(`AIR: ${s.air_s} s left | SUB BEACON: ${b.dist} m (horiz ${b.horiz}), rel ${sgn(b.rel)}°, dy ${sgn(b.dy)} | swim-back ~${Math.ceil(b.dist / 2)} s | enter possible: ${b.dist <= 5 ? 'YES' : 'no'}`);
    lines.push(`CARRYING: ${s.carry_kinds.length ? s.carry_kinds.join(', ') : 'nothing'} (${s.carry_kinds.length}/3)`);
    lines.push(`REACH SENSOR: ${s.reach.length ? 'GRABBABLE NOW: ' + s.reach.join(', ') : 'nothing within 3 m'}`);
  } else lines.push('DIVER: inside the sub');
  lines.push(`STORED ABOARD: fish ${inv.stored.fish}/3, salad ${inv.stored.salad}/1, mineral ${inv.stored.mineral}/1 | still missing: ${Object.entries(inv.missing).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing'}`);
  return lines;
}

const fmtSonar = (s) => s.sonar.map((r) => `${sgn(r.rel)}°: ${r.dist == null ? 'clear' : `${r.what} ${r.dist} m`}`).join(' | ');

function fmtResult(r) {
  if (!r) return 'none yet';
  const a = r.action;
  let t = `[${r.body}] turn ${sgn(a.turn_deg)}°, throttle ${a.throttle}, vertical ${a.vertical}, ${a.duration_s} s -> moved ${r.moved_m} m`;
  if (r.blocked_by) t += `, BLOCKED by ${r.blocked_by}`;
  if (r.do && r.do.ok !== undefined) t += `; ${a.do}: ${r.do.ok ? 'OK - ' + r.do.info : 'FAILED - ' + r.do.reason}`;
  if (r.event) t += `; ${r.event}`;
  return t;
}

export function s1Prompt(s, plan, target, lookText, lastResult, lock = null) {
  const lines = header(s);
  if (plan) {
    lines.push(`SUBGOAL (from SYSTEM 2): ${JSON.stringify(plan.subgoal)} for body ${plan.body}`);
    lines.push(target ? `  -> ${target.label}: ${target.rel.dist} m (horiz ${target.rel.horiz}), rel ${sgn(target.rel.rel)}°, dy ${sgn(target.rel.dy)}${target.reached ? ' [REACHED]' : ''}${target.estimated ? ' (estimated position)' : ''}`
      : '  -> target is not valid. Set replan=true unless guidance says otherwise.');
    lines.push(`GUIDANCE: "${plan.guidance}"`);
    if (plan.body !== s.active) {
      lines.push(plan.body === 'diver'
        ? 'BODY SWITCH NEEDED: SYSTEM 2 wants the DIVER. Once the sub is within ~8 m of the target, stop and use do:"exit".'
        : 'BODY SWITCH NEEDED: SYSTEM 2 wants the SUB. Swim back (follow the SUB BEACON) and use do:"enter" within 5 m.');
    }
  }
  if (lock) lines.push(`TARGET LOCK (tracking sonar, EXACT, updated every step): ${lock.kind} (${lock.sighting}) ${lock.dist} m (horiz ${lock.horiz}), rel ${sgn(lock.rel)}°, dy ${sgn(lock.dy)} -> turn_deg ${sgn(lock.rel)}, swim about ${Math.max(0, lock.dist - 1).toFixed(1)} m with vertical toward dy, and set do:"grab" (it fires the moment you are within 3 m).`);
  lines.push(`ACTIONS AVAILABLE NOW: ${s.active === 'sub' ? 'exit | none' : `${s.reach.length ? 'grab' : 'grab (nothing in reach yet)'} | ${s.sub_beacon.dist <= 5 ? 'enter' : 'enter (sub too far)'}`}`);
  lines.push(`LAST STEP: ${fmtResult(lastResult)}`);
  lines.push(`LATEST CAMERA LOOK: ${lookText}`);
  lines.push(`SONAR (range ${s.spec.sonar} m): ${fmtSonar(s)}`);
  return lines.join('\n');
}

export function s2Prompt(s, zones, sightings, plan, trigger, history, lookText) {
  const lines = header(s);
  lines.push(`WHY YOU ARE CALLED: ${trigger}`);
  lines.push(`SUB position: E=${s.sub.E} N=${s.sub.N} depth=${s.sub.depth} m`);
  lines.push('ZONES (PDA map):');
  for (const z of zones) {
    const d = Math.hypot(z.E - s.pose.E, z.N - s.pose.N);
    lines.push(`  ${z.id} ${z.name} at E=${Math.round(z.E)} N=${Math.round(z.N)} (park depth ${z.parkDepth} m) - ${Math.round(d)} m away: ${z.desc}`);
  }
  lines.push(`SIGHTINGS (remembered from camera looks; positions are estimates):\n  ${sightings.length ? sightings.map((v) =>
    `${v.id} ${v.kind} (${v.item}) at E=${Math.round(v.E)} N=${Math.round(v.N)} depth=${Math.round(v.depth)} - ${Math.round(v.dist)} m from active body, seen ${v.count}x, last at step ${v.last}`).join('\n  ') : 'none yet'}`);
  lines.push(`LATEST CAMERA LOOK: ${lookText}`);
  lines.push(`CURRENT PLAN: ${plan ? JSON.stringify({ plan: plan.plan, subgoal: plan.subgoal, body: plan.body, guidance: plan.guidance }) : 'none (mission start)'}`);
  lines.push(`RECENT STEPS:\n  ${history.length ? history.slice(-8).join('\n  ') : 'none'}`);
  lines.push(`SONAR: ${fmtSonar(s)}`);
  return lines.join('\n');
}

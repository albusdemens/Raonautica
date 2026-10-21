// Codex as the vision model, in two stages:
//   1) DETECT: look at the active body's 4 camera frames and list candidate targets (+ where in the image).
//   2) CONFIRM: crop & zoom each candidate, ask Codex again "is this really a <kind>?", and measure its
//      length in pixels so the distance can be computed from its known real size.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const TARGET_KINDS = ['bubblefin', 'kelp_peeper', 'lanternfish', 'sea_lettuce', 'salt_crystal'];
export const KIND_TO_ITEM = { bubblefin: 'fish', kelp_peeper: 'fish', lanternfish: 'fish', sea_lettuce: 'salad', salt_crystal: 'mineral' };
export const CAM_OFFSET = { front: 0, left: -90, right: 90, back: 180, down: 0 };
const CAM_FOV = { front: 62, left: 62, right: 62, back: 62, down: 70 };
const REAL_LEN = { bubblefin: 2.1, kelp_peeper: 2.1, lanternfish: 2.1, sea_lettuce: 1.5, salt_crystal: 1.2 };   // metres
const IMG_W = 512, IMG_H = 288, CROP = 160, ZOOM = 2;

const KIND_DESC = {
  bubblefin: 'a single large round bright-YELLOW fish with big white eyes and an orange tail (about 2 m long), with a soft yellow glow',
  kelp_peeper: 'a single large lime-GREEN fish with big white eyes (about 2 m long), with a soft green glow, among kelp',
  lanternfish: 'a dark navy fish (about 2 m long) with a small brightly glowing CYAN lure above its head, in dark deep water',
  sea_lettuce: 'a bright green, ruffled leafy ball sitting on the seabed (about 1.5 m wide), glowing outline',
  salt_crystal: 'a small cluster of glowing lavender/violet crystals on the seabed (about 1.2 m)',
};

const DETECT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['targets', 'obstacles', 'sub', 'diver', 'scene'],
  properties: {
    targets: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['kind', 'camera', 'x_frac', 'y_frac', 'bearing_deg', 'distance_m', 'vertical', 'confidence', 'note'],
      properties: {
        kind: { type: 'string', enum: TARGET_KINDS },
        camera: { type: 'string', enum: ['front', 'left', 'right', 'back', 'down'] },
        x_frac: { type: 'number' }, y_frac: { type: 'number' },
        bearing_deg: { type: 'number' }, distance_m: { type: 'number' },
        vertical: { type: 'string', enum: ['above', 'level', 'below'] },
        confidence: { type: 'number' }, note: { type: 'string' } } } },
    obstacles: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['what', 'camera', 'bearing_deg', 'distance_m'],
      properties: { what: { type: 'string' }, camera: { type: 'string', enum: ['front', 'left', 'right', 'back', 'down'] }, bearing_deg: { type: 'number' }, distance_m: { type: 'number' } } } },
    sub: { type: 'object', additionalProperties: false, required: ['visible', 'bearing_deg', 'distance_m'],
      properties: { visible: { type: 'boolean' }, bearing_deg: { type: 'number' }, distance_m: { type: 'number' } } },
    diver: { type: 'object', additionalProperties: false, required: ['visible', 'bearing_deg', 'distance_m'],
      properties: { visible: { type: 'boolean' }, bearing_deg: { type: 'number' }, distance_m: { type: 'number' } } },
    scene: { type: 'string' },
  },
};

const CONFIRM_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['results'],
  properties: { results: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['index', 'is_target', 'confidence', 'length_px', 'reason'],
    properties: { index: { type: 'integer' }, is_target: { type: 'boolean' }, confidence: { type: 'number' },
      length_px: { type: 'number' }, reason: { type: 'string' } } } } },
};

const DETECT_PROMPT = (who, where) => `You are the eyes of an underwater ${who === 'sub' ? 'submarine' : 'diver'} robot.
CURRENT LOCATION (from the map): ${where}
Image 1 = FRONT camera (horizontal FOV 62 deg, centre = straight ahead, level).
Image 2 = LEFT camera (FOV 62 deg, centre = 90 deg to the robot's left, level).
Image 3 = RIGHT camera (FOV 62 deg, centre = 90 deg to the robot's right, level).
Image 4 = BACK camera (FOV 62 deg, centre = straight behind the robot, level; the robot's own body may be at the edge).
Image 5 = DOWN camera (FOV 70 deg, looking forward-down at ~60 deg; its centre is ~5 m ahead and well below).
Report what you SEE. List every CANDIDATE that might be a target; a second, zoomed-in check will confirm or reject each one, so it is fine to include plausible candidates with a moderate confidence.
Corals, mushrooms, sea grass, kelp leaves and schools of many small fish are NOT targets. Targets that do not live in the current location are unlikely.

TARGETS (mission items; each has a soft glow / glowing outline so it stands out):
${Object.entries(KIND_DESC).map(([k, d]) => `- ${k}: ${d}.`).join('\n')}
Also report our own SUBMARINE (white rounded hull, orange rings, glass dome) and the DIVER (white suit, orange helmet) if visible.

x_frac, y_frac: the candidate's centre in its image (0,0 = top-left, 1,1 = bottom-right).
bearing_deg: horizontal angle relative to the CENTRE OF THAT CAMERA's image (negative = left, positive = right), from the image position and the FOV. Set 'camera' to the image the object is in.
distance_m: your best estimate of the distance from the camera.
obstacles: big things in the way (rock walls, kelp stalks, giant mushroom stems, wreck hull, pillars), with camera, bearing and distance; at most 5.
scene: one or two sentences: terrain, light, what dominates the view.`;

const CONFIRM_PROMPT = (cands) => `Each image is a 2x zoomed crop centred on a candidate detection from an underwater robot's camera.
For each crop, decide whether the object AT THE CENTRE of the crop really is the claimed target. Be strict: corals, mushrooms, rocks, plants and small schooling fish are not targets.
${cands.map((c, i) => `Crop ${i}: claimed "${c.kind}" = ${KIND_DESC[c.kind]}.`).join('\n')}
For each crop return: index, is_target, confidence (0-1), length_px = the object's longest visible length in pixels IN THE CROP (0 if not a target), and a short reason.`;

function runCodex(images, prompt, schemaPath, outPath, cwd) {
  const args = ['exec', '--skip-git-repo-check', '-s', 'read-only', '--output-schema', schemaPath, '-o', outPath];
  for (const img of images) args.push('-i', img);
  args.push('-');
  return new Promise((ok, fail) => {
    const p = spawn('codex', args, { cwd, stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { p.kill('SIGKILL'); fail(new Error('codex timeout')); }, 75_000);   // looks normally take 10-25 s
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !fs.existsSync(outPath)) return fail(new Error(`codex exited ${code}: ${err.slice(-300)}`));
      ok(JSON.parse(fs.readFileSync(outPath, 'utf8')));
    });
    p.stdin.end(prompt);
  });
}

const wrap180 = (a) => ((a + 540) % 360) - 180;

// images: {front, left, right, down}
export async function look(images, who, outDir, name, where = 'unknown', isKnown = () => false) {
  const t0 = Date.now();
  const dSchema = path.join(outDir, 'detect_schema.json'), cSchema = path.join(outDir, 'confirm_schema.json');
  if (!fs.existsSync(dSchema)) fs.writeFileSync(dSchema, JSON.stringify(DETECT_SCHEMA));
  if (!fs.existsSync(cSchema)) fs.writeFileSync(cSchema, JSON.stringify(CONFIRM_SCHEMA));
  const order = ['front', 'left', 'right', 'back', 'down'];
  const det = await runCodex(order.map((k) => images[k]), DETECT_PROMPT(who, where), dSchema, path.join(outDir, `${name}_detect.json`), outDir);

  // stage 2: zoom-confirm every candidate in one call
  const all = det.targets.filter((t) => t.confidence >= 0.3).slice(0, 6);
  // fast path: very confident detections and re-sightings of known targets skip the zoom-confirm call
  const confirmed = [];
  const cands = [];
  for (const t of all) {
    if (t.confidence >= 0.85 || isKnown(t)) confirmed.push({ ...t, distance_vlm_m: t.distance_m, distance_from: 'vlm', confirm: { skipped: true } });
    else cands.push(t);
  }
  let confirmCalls = 0;
  if (cands.length) {
    confirmCalls = 1;
    const crops = cands.map((c, i) => {
      const cx = Math.round(Math.min(1, Math.max(0, c.x_frac)) * IMG_W), cy = Math.round(Math.min(1, Math.max(0, c.y_frac)) * IMG_H);
      const x = Math.min(IMG_W - CROP, Math.max(0, cx - CROP / 2)), y = Math.min(IMG_H - CROP, Math.max(0, cy - CROP / 2));
      const out = path.join(outDir, `${name}_crop${i}.png`);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', images[c.camera], '-vf', `crop=${CROP}:${CROP}:${x}:${y},scale=${CROP * ZOOM}:${CROP * ZOOM}:flags=lanczos`, out]);
      return out;
    });
    let conf = { results: [] };
    try { conf = await runCodex(crops, CONFIRM_PROMPT(cands), cSchema, path.join(outDir, `${name}_confirm.json`), outDir); }
    catch { conf.results = cands.map((c, i) => ({ index: i, is_target: c.confidence >= 0.7, confidence: c.confidence, length_px: 0, reason: 'confirm step failed' })); }
    for (const r of conf.results) {
      const c = cands[r.index];
      if (!c) continue;
      c.confirm = r;
      if (!r.is_target || r.confidence < 0.5) continue;
      // distance from apparent size: pinhole camera, focal length in pixels from the FOV
      const f = IMG_W / 2 / Math.tan(((CAM_FOV[c.camera] / 2) * Math.PI) / 180);
      const lenOrig = r.length_px / ZOOM;
      const sizeDist = lenOrig > 6 ? (REAL_LEN[c.kind] * f) / lenOrig : null;
      // the two estimates err in opposite directions (pose foreshortening vs. eyeballing): geometric mean
      const vlmDist = Math.max(1, c.distance_m);
      const dist = sizeDist ? Math.sqrt(Math.min(90, Math.max(1, sizeDist)) * vlmDist) : vlmDist;
      confirmed.push({ ...c, distance_vlm_m: c.distance_m, distance_size_m: sizeDist, distance_m: dist,
        distance_from: sizeDist ? 'geo-mean(size, vlm)' : 'vlm', confidence: Math.min(1, (c.confidence + r.confidence) / 2 + 0.15) });
    }
  }
  // camera-relative -> body-relative bearings
  for (const t of confirmed) t.bearing_deg = wrap180(t.bearing_deg + CAM_OFFSET[t.camera]);
  for (const o of det.obstacles) o.bearing_deg = wrap180(o.bearing_deg + CAM_OFFSET[o.camera]);
  const rejected = cands.filter((c) => !confirmed.some((x) => x.x_frac === c.x_frac && x.camera === c.camera)).map((c) => ({ kind: c.kind, camera: c.camera, reason: c.confirm?.reason || 'not confirmed' }));
  return { ...det, targets: confirmed, rejected, candidates: all.length, confirm_calls: confirmCalls, latency_ms: Date.now() - t0 };
}

// compact text for prompts and HUD
export function describe(v, ageSteps = 0) {
  if (!v) return 'no look yet';
  const lines = [];
  lines.push(`(seen ${ageSteps === 0 ? 'just now' : `${ageSteps} step(s) ago - you have moved since`}) ${v.scene}`);
  lines.push(v.targets.length ? 'CONFIRMED TARGETS (bearing relative to your heading): ' + v.targets.map((x) => `${x.kind} [${x.camera} cam] ${x.bearing_deg >= 0 ? '+' : ''}${Math.round(x.bearing_deg)}°, ~${Math.round(x.distance_m)} m, ${x.vertical} (conf ${x.confidence.toFixed(1)})`).join(' | ') : 'CONFIRMED TARGETS: none');
  if (v.rejected?.length) lines.push(`(rejected on zoom: ${v.rejected.map((r) => r.kind).join(', ')})`);
  if (v.obstacles.length) lines.push('OBSTACLES: ' + v.obstacles.map((o) => `${o.what} ${o.bearing_deg >= 0 ? '+' : ''}${Math.round(o.bearing_deg)}° ~${Math.round(o.distance_m)} m`).join(' | '));
  if (v.sub.visible) lines.push(`SUB visible: ${v.sub.bearing_deg >= 0 ? '+' : ''}${Math.round(v.sub.bearing_deg)}° ~${Math.round(v.sub.distance_m)} m`);
  return lines.join('\n');
}

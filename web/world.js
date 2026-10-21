// The ocean: 1 km x 1 km, up to ~190 m deep. Biomes: Safe Shallows (SW, start), Kelp Forest (W),
// Grassy Plateaus with a ship wreck (centre/S), Mushroom Forest (NE, deep), Deep Canyon (E) with the
// Crystal Crevice at its bottom.
// Coordinates: three.js x = East, z = -North, y = up (surface at y = 0). Raon sees E / N / depth.
// Big-world techniques: chunked terrain, per-chunk instanced decor streamed by distance, and effects that
// follow the camera.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, noise2, fbm, smoothstep } from './noise.js';
import { hdr, glowSprite, glowTexture } from './fx.js';

export { glowSprite };
export const HALF = 500;
export const SURFACE_Y = 0;
export const CHUNK = 100;
const NCH = (2 * HALF) / CHUNK;
export const VIEW_DIST = 230;

export const shared = { uTime: { value: 0 } };
const mix = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- terrain

export const canyonX = (N) => 395 + 28 * noise2(N * 0.004, 3.1);
const CREVICE = { E: canyonX(-120), N: -120 };
const LEDGE = { E: canyonX(-262) - 78, N: -262 };
const WRECK = { E: 40, N: -250 };

export function floorAt(E, N) {
  let y = -55 + 10 * fbm(E * 0.005 + 3, N * 0.005 - 7, 4) + 2.5 * fbm(E * 0.04, N * 0.04, 2);
  y = mix(y, -19 + 4 * fbm(E * 0.02 + 1, N * 0.02, 3), smoothstep(250, 130, Math.hypot(E + 330, N + 320)));     // shallows
  y = mix(y, -36 + 3 * fbm(E * 0.015, N * 0.015 + 5, 3), smoothstep(160, 100, Math.hypot(E + 320, N - 170)));   // kelp basin
  y = mix(y, -100 + 6 * fbm(E * 0.01 + 8, N * 0.01, 3), smoothstep(180, 110, Math.hypot(E - 230, N - 260)));    // mushroom basin
  y = mix(y, -182 + 6 * fbm(E * 0.02, N * 0.02 + 2, 3), smoothstep(100, 50, Math.abs(E - canyonX(N))));         // canyon
  const dl = Math.hypot(E - LEDGE.E, N - LEDGE.N);
  if (dl < 14) y = mix(y, Math.max(y, -112), smoothstep(14, 9, dl));                                             // mineral ledge
  y -= 10 * smoothstep(8, 3, Math.hypot(E - CREVICE.E, N - CREVICE.N));                                         // crevice pocket
  const out = Math.max(Math.abs(E), Math.abs(N)) - HALF;
  if (out > 0) y = mix(y, -8, smoothstep(0, 60, out));                                                          // basin rim
  return y;
}

// biome weights (0..1), used for colouring and decoration
const B = {
  shallow: (E, N) => smoothstep(240, 140, Math.hypot(E + 330, N + 320)),
  kelp: (E, N) => smoothstep(125, 95, Math.hypot(E + 320, N - 170)),
  mush: (E, N) => smoothstep(150, 105, Math.hypot(E - 230, N - 260)),
};

// ---------------------------------------------------------------- procedural textures

function canvasTexture(size, fn, { srgb = false, repeat = 1 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d'), img = g.createImageData(size, size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const [r, gg, b] = fn(i / size, j / size);
    const k = (j * size + i) * 4;
    img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// tileable noise: sample on a torus so the texture edges wrap
function tnoise(u, v, f) {
  const a = u * Math.PI * 2, b = v * Math.PI * 2, R = f / (Math.PI * 2);
  return noise2(Math.cos(a) * R + Math.sin(b) * R * 0.7 + 50, Math.sin(a) * R + Math.cos(b) * R * 0.7 + 20);
}

const TEX = {};
function textures() {
  if (TEX.sandBump) return TEX;
  TEX.sandBump = canvasTexture(512, (u, v) => {           // ripples + grain
    const warp = tnoise(u, v, 6) * 1.2;
    const rip = Math.sin((u * 18 + v * 4 + warp) * Math.PI * 2) * 0.5 + 0.5;
    const grain = tnoise(u, v, 90) * 0.5 + 0.5;
    const x = 255 * (0.65 * Math.pow(rip, 1.6) + 0.35 * grain);
    return [x, x, x];
  }, { repeat: 1 });
  TEX.sandColor = canvasTexture(512, (u, v) => {
    const n = tnoise(u, v, 30) * 0.5 + 0.5, s = tnoise(u, v, 140) * 0.5 + 0.5;
    const k = 0.86 + 0.14 * n + (s > 0.82 ? 0.12 : 0) - (s < 0.12 ? 0.1 : 0);
    return [255 * k, 250 * k, 240 * k];
  }, { srgb: true, repeat: 1 });
  TEX.rockBump = canvasTexture(256, (u, v) => {
    const n = tnoise(u, v, 8) * 0.5 + tnoise(u, v, 24) * 0.3 + tnoise(u, v, 60) * 0.2;
    const x = 128 + 127 * n;
    return [x, x, x];
  }, { repeat: 2 });
  return TEX;
}

// ---------------------------------------------------------------- underwater shading

const CAUSTIC_GLSL = `
float caustic(vec2 p, float t) {
  vec2 i = p; float c = 1.0; float inten = 0.005;
  for (int n = 0; n < 3; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 3.0; c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.5);
}`;

// PBR material + shadow-aware caustics in sunlight + depth light absorption (+ optional animation).
// anim: 'sway' (by local height), 'kelp' (aSway attribute, per-instance phase), 'fish' (tail wiggle).
export function uw(params = {}, { anim = null, amt = 0.15, caustics = 1, physical = false } = {}) {
  const mat = physical ? new THREE.MeshPhysicalMaterial({ roughness: 0.85, ...params })
    : new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...params });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.uniforms.uCaustic = { value: caustics };
    let vs = `uniform float uTime;\nvarying vec3 vWPos;\nvarying vec3 vWN;\n${anim === 'kelp' ? 'attribute float aSway;\n' : ''}` + sh.vertexShader;
    const phase = `#ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
      #else
        float ph = modelMatrix[3].x * 0.37 + modelMatrix[3].z * 0.23;
      #endif`;
    if (anim === 'sway') {
      vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
        ${phase}
        float k = max(position.y, 0.0);
        transformed.x += sin(uTime * 1.4 + ph) * ${amt.toFixed(3)} * k * k;
        transformed.z += cos(uTime * 1.1 + ph) * ${(amt * 0.6).toFixed(3)} * k * k;`);
    } else if (anim === 'kelp') {
      vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
        ${phase}
        transformed.x += sin(uTime * 0.9 + ph + position.y * 0.15) * aSway;
        transformed.z += cos(uTime * 0.7 + ph + position.y * 0.11) * aSway * 0.6;`);
    } else if (anim === 'fish') {
      vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
        ${phase}
        float tail = smoothstep(-0.3, 0.9, position.z);
        transformed.x += sin(uTime * 9.0 + position.z * 5.0 + ph) * ${amt.toFixed(3)} * tail;`);
    }
    vs = vs.replace('#include <project_vertex>', `#include <project_vertex>
      #ifdef USE_INSTANCING
        vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
      #else
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * objectNormal);
      #endif`);
    sh.vertexShader = vs;
    sh.fragmentShader = `uniform float uTime;\nuniform float uCaustic;\nvarying vec3 vWPos;\nvarying vec3 vWN;\n${CAUSTIC_GLSL}\n` +
      sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        float depthF = smoothstep(-8.0, -170.0, vWPos.y);
        vec3 absorb = mix(vec3(1.0), vec3(0.08, 0.17, 0.32), depthF);
        float cs = caustic(vWPos.xz * 0.22 - 250.0, uTime * 0.55) * (1.0 - smoothstep(-6.0, -60.0, vWPos.y)) * smoothstep(-0.2, 0.6, vWN.y);
        reflectedLight.directDiffuse *= absorb * (0.6 + 2.2 * cs * uCaustic);
        reflectedLight.directSpecular *= absorb;
        reflectedLight.indirectDiffuse *= absorb;
        reflectedLight.indirectSpecular *= absorb;`);
  };
  mat.customProgramCacheKey = () => `uw-${anim}-${amt}-${caustics}-${physical}`;
  return mat;
}

// give every vertex of a geometry a colour (so differently-coloured parts can be merged)
function paint(geo, color) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const arr = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  return geo;
}

const at = (o, x, y, z) => { o.position.set(x, y, z); return o; };
const shadows = (o, cast = true, recv = true) => { o.traverse((m) => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = recv; } }); return o; };

// ---------------------------------------------------------------- zones & items (what the PDA knows)

export const ZONES = [
  { id: 'Z1', name: 'Safe Shallows', E: -330, N: -320, parkDepth: 8, r: 90,
    desc: 'sunlit coral shallows, floor ~19 m deep. Bubblefins live here, near the centre.' },
  { id: 'Z2', name: 'Kelp Forest', E: -320, N: 170, parkDepth: 3, r: 100,
    desc: 'huge dense kelp forest, floor ~36 m, kelp tops 6.5-9.5 m below the surface. The sub CANNOT go between kelp stalks - park above the canopy (depth ~3 m) at the centre and send the diver down. Kelp Peepers and sea lettuce (salad) live near the centre, on/near the floor.' },
  { id: 'Z3', name: 'Grassy Plateaus', E: 0, N: 0, parkDepth: 30, r: 160,
    desc: 'open red-grass plateau, floor ~55 m, rock arches. Nothing needed here, but it is the fast road across the map.' },
  { id: 'Z4', name: 'Ship Wreck', E: WRECK.E, N: WRECK.N, parkDepth: 30, r: 80,
    desc: 'a huge crashed ship lying on the plateau (~55 m). A landmark; nothing needed here.' },
  { id: 'Z5', name: 'Mushroom Forest', E: 230, N: 260, parkDepth: 85, r: 110,
    desc: 'dark basin, floor ~100 m, giant glowing mushrooms (their caps are obstacles). Glow Lanternfish drift near the centre at ~90-95 m.' },
  { id: 'Z6', name: 'Deep Canyon', E: Math.round(canyonX(0)), N: 0, parkDepth: 150, r: 60,
    desc: `a long winding canyon running north-south along the east side, floor ~182 m, very dark. A mineral ledge sits on its west wall near E=${Math.round(LEDGE.E)} N=${LEDGE.N} at ~110 m depth.` },
  { id: 'Z7', name: 'Crystal Crevice', E: Math.round(CREVICE.E), N: CREVICE.N, parkDepth: 165, r: 10,
    desc: 'a pocket at the canyon bottom (~190 m) ringed by rock pillars and capped by a boulder. Only the diver fits through the gaps. Mineral crystals grow inside.' },
];

const ITEM_DEFS = [
  { id: 'F1', kind: 'fish', name: 'Bubblefin', E: -320, N: -300, depth: 12 },
  { id: 'F2', kind: 'fish', name: 'Bubblefin', E: -345, N: -336, depth: 11 },
  { id: 'F3', kind: 'fish', name: 'Kelp Peeper', E: -330, N: 160, depth: 22 },
  { id: 'F4', kind: 'fish', name: 'Kelp Peeper', E: -306, N: 184, depth: 18 },
  { id: 'F5', kind: 'fish', name: 'Glow Lanternfish', E: 220, N: 250, depth: 92 },
  { id: 'F6', kind: 'fish', name: 'Glow Lanternfish', E: 246, N: 272, depth: 95 },
  { id: 'S1', kind: 'salad', name: 'Sea Lettuce', E: -322, N: 175 },
  { id: 'S2', kind: 'salad', name: 'Sea Lettuce', E: -336, N: 150 },
  { id: 'S3', kind: 'salad', name: 'Sea Lettuce', E: -300, N: 166 },
  { id: 'M1', kind: 'mineral', name: 'Salt Crystal', E: CREVICE.E - 1, N: CREVICE.N + 1 },
  { id: 'M2', kind: 'mineral', name: 'Salt Crystal', E: CREVICE.E + 1.5, N: CREVICE.N - 1.5 },
  { id: 'M3', kind: 'mineral', name: 'Salt Crystal', E: LEDGE.E, N: LEDGE.N },
];

export const START = { E: -360, N: -385, depth: 1.5, heading: 45 };

// ---------------------------------------------------------------- chunk streaming

class Chunks {
  constructor(scene) {
    this.groups = [];
    for (let j = 0; j < NCH; j++) for (let i = 0; i < NCH; i++) {
      const g = new THREE.Group();
      g.userData.E = -HALF + (i + 0.5) * CHUNK;
      g.userData.N = -HALF + (j + 0.5) * CHUNK;
      scene.add(g);
      this.groups.push(g);
    }
  }
  index(E, N) {
    const i = Math.min(NCH - 1, Math.max(0, Math.floor((E + HALF) / CHUNK)));
    const j = Math.min(NCH - 1, Math.max(0, Math.floor((N + HALF) / CHUNK)));
    return j * NCH + i;
  }
  add(obj, E, N) { this.groups[this.index(E, N)].add(obj); }
  update(camE, camN, viewDist) {
    for (const g of this.groups) {
      const dx = Math.max(0, Math.abs(camE - g.userData.E) - CHUNK / 2), dn = Math.max(0, Math.abs(camN - g.userData.N) - CHUNK / 2);
      g.visible = Math.hypot(dx, dn) < viewDist;
    }
  }
}

// jittered-grid scatter over a box, kept with probability density(E, N)
function scatter(rnd, spacing, box, density) {
  const out = [];
  for (let N = box.N0; N < box.N1; N += spacing) for (let E = box.E0; E < box.E1; E += spacing) {
    const e = E + rnd() * spacing, n = N + rnd() * spacing;
    if (Math.abs(e) > HALF - 2 || Math.abs(n) > HALF - 2) continue;
    if (rnd() < density(e, n)) out.push([e, n]);
  }
  return out;
}

// one InstancedMesh per chunk; place(E, N) -> { pos, quat, scale, color? } or null to skip
function decor(chunks, geo, mat, spots, place, { cast = true } = {}) {
  const bins = new Map();
  for (const s of spots) {
    const k = chunks.index(s[0], s[1]);
    if (!bins.has(k)) bins.set(k, []);
    bins.get(k).push(s);
  }
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  for (const [k, list] of bins) {
    const placed = list.map(([E, N]) => place(E, N)).filter(Boolean);
    if (!placed.length) continue;
    const mesh = new THREE.InstancedMesh(geo, mat, placed.length);
    placed.forEach(({ pos, quat, scale, color }, i) => {
      mesh.setMatrixAt(i, m4.compose(pos, quat || new THREE.Quaternion(), scale || new THREE.Vector3(1, 1, 1)));
      if (color) mesh.setColorAt(i, c.set(color));
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = cast; mesh.receiveShadow = true;
    chunks.groups[k].add(mesh);
  }
}

// ---------------------------------------------------------------- build

export function buildWorld(scene) {
  const rnd = mulberry32(7);
  const colliders = [];
  const cyl = (E, N, r, y0, y1, label) => colliders.push({ type: 'cyl', E, N, r, y0, y1, label });
  const sph = (E, N, y, r, label) => colliders.push({ type: 'sph', E, N, y, r, label });
  const updaters = [];
  const chunks = new Chunks(scene);
  const followers = new THREE.Group();   // effects that travel with the camera
  scene.add(followers);

  buildTerrain(chunks);
  followers.add(buildSurface());
  followers.add(buildGodRays(rnd));
  scene.add(buildMarineSnow(rnd));

  buildRocks(chunks, rnd, sph);
  buildShallows(chunks, rnd);
  buildPlateau(chunks, scene, rnd, cyl, sph);
  buildKelp(chunks, rnd, cyl);
  buildDeep(chunks, scene, rnd, cyl, sph, updaters);
  buildWreck(scene, sph);
  updaters.push(buildSchools(scene, rnd));
  updaters.push(buildLeviathans(scene));
  updaters.push(buildBubbleVents(scene, rnd));

  const items = ITEM_DEFS.map((d) => {
    const home = { E: d.E, N: d.N, y: d.depth != null ? -d.depth : floorAt(d.E, d.N) + (d.kind === 'salad' ? 0.6 : 0.5) };
    const mesh = shadows(buildItemMesh(d.kind, d.name), true, false);
    scene.add(mesh);
    const it = { ...d, home, mesh, state: 'world', phase: rnd() * 6.28 };
    it.posAt = (t) => {
      if (it.kind !== 'fish') return { ...home };
      const R = 2.6, w = 0.45 / R;
      return { E: home.E + Math.cos(w * t + it.phase) * R, N: home.N + Math.sin(w * t + it.phase) * R, y: home.y + Math.sin(w * 2 * t) * 0.7 };
    };
    return it;
  });

  return {
    colliders, items, zones: ZONES, start: { ...START }, updaters,
    // stream chunks + move camera-following effects
    follow(camera, overview = false) {
      const E = camera.position.x, N = -camera.position.z;
      chunks.update(E, N, overview ? 5000 : VIEW_DIST);
      followers.position.set(Math.round(E / 20) * 20, 0, Math.round(-N / 20) * 20);
    },
  };
}

// chunked terrain with seamless normals and slope/biome colouring
function buildTerrain(chunks) {
  const RES = 1.25, n = Math.round(CHUNK / RES);       // vertices per chunk side = n + 1
  const t = textures();
  const mat = uw({ vertexColors: true, map: t.sandColor, bumpMap: t.sandBump, bumpScale: 1.2, roughness: 0.95 });
  const sand = new THREE.Color('#f0dfb0'), kelpSand = new THREE.Color('#a99a68'), plateau = new THREE.Color('#c9b48e'),
    rock = new THREE.Color('#8a8578'), deepRock = new THREE.Color('#463f63'), deepSand = new THREE.Color('#556584'),
    mushSand = new THREE.Color('#4b3f6e'), strata = new THREE.Color('#6c5a7c'), c = new THREE.Color(), tmp = new THREE.Color();
  const span = [...Array(NCH).keys()].map((i) => -HALF + i * CHUNK);
  // the play area plus a ring of rim chunks outside it
  const tiles = [];
  for (const N0 of [-HALF - CHUNK, ...span, HALF]) for (const E0 of [-HALF - CHUNK, ...span, HALF]) tiles.push([E0, N0]);
  for (const [E0, N0] of tiles) {
    const W = n + 3;                                    // height grid with a 1-vertex border
    const H = new Float32Array(W * W);
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) H[j * W + i] = floorAt(E0 + (i - 1) * RES, N0 + (j - 1) * RES);
    const geo = new THREE.PlaneGeometry(CHUNK, CHUNK, n, n);
    geo.rotateX(-Math.PI / 2);
    geo.translate(E0 + CHUNK / 2, 0, -(N0 + CHUNK / 2));
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
    const col = new Float32Array(pos.count * 3);
    for (let v = 0; v < pos.count; v++) {
      const E = pos.getX(v), N = -pos.getZ(v);
      const i = Math.round((E - E0) / RES) + 1, j = Math.round((N - N0) / RES) + 1;
      const y = H[j * W + i];
      pos.setY(v, y);
      const dE = (H[j * W + i + 1] - H[j * W + i - 1]) / (2 * RES), dN = (H[(j + 1) * W + i] - H[(j - 1) * W + i]) / (2 * RES);
      const len = Math.hypot(dE, 1, dN);
      nor.setXYZ(v, -dE / len, 1 / len, dN / len);
      uv.setXY(v, E / 18, N / 18);
      const slope = Math.min(1, Math.hypot(dE, dN));
      c.copy(plateau).lerp(sand, B.shallow(E, N)).lerp(kelpSand, B.kelp(E, N));
      c.lerp(deepSand, smoothstep(-70, -150, y)).lerp(mushSand, B.mush(E, N));
      const band = 0.5 + 0.5 * Math.sin(y * 0.8 + noise2(E * 0.05, N * 0.05) * 2);
      tmp.copy(y < -80 ? deepRock : rock).lerp(strata, band * 0.5);
      c.lerp(tmp, smoothstep(0.45, 0.9, slope));
      c.offsetHSL(0, 0, 0.05 * noise2(E * 0.2, N * 0.2));
      col.set([c.r, c.g, c.b], v * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    chunks.add(m, E0 + CHUNK / 2, N0 + CHUNK / 2);
  }
}

// The surface seen from below: a bright Snell's window overhead, total internal reflection beyond it.
function buildSurface() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: `varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; varying vec3 vW;
      #include <fog_pars_fragment>
      ${CAUSTIC_GLSL}
      void main(){
        vec3 V = normalize(vW - cameraPosition);
        vec2 p = vW.xz * 0.35;
        vec2 n = vec2(sin(p.x * 1.3 + uTime * 1.1) + sin(p.y * 1.7 - uTime * 0.9), cos(p.y * 1.1 + uTime) + sin(p.x * 0.9 + p.y * 0.7 + uTime * 1.3)) * 0.06;
        float cosT = abs(V.y) + n.x * 0.5;
        float window = smoothstep(0.62, 0.70, cosT);
        float c = caustic(vW.xz * 0.12 + n * 6.0 - 250.0, uTime * 0.4);
        vec3 sky = vec3(1.6, 2.4, 2.5) + c * 1.5;
        vec3 tir = vec3(0.02, 0.22, 0.30) * (0.8 + c * 0.6);
        gl_FragColor = vec4(mix(tir, sky, window), 1.0);
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uTime = shared.uTime;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(900, 900, 1, 1), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = SURFACE_Y;
  m.name = 'surface';
  m.frustumCulled = false;
  return m;
}

function buildGodRays(rnd) {
  const g = new THREE.Group();
  g.name = 'godrays';
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: shared.uTime },
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec3 vW;
      void main(){
        float edge = pow(sin(vUv.x * 3.14159), 2.0);
        float flick = 0.55 + 0.45 * sin(uTime * 0.7 + vUv.x * 11.0 + vW.y * 0.05);
        float d = distance(vW, cameraPosition);
        float camFade = smoothstep(3.0, 18.0, d) * (1.0 - smoothstep(80.0, 160.0, d));
        float a = pow(vUv.y, 1.8) * edge * flick * camFade * (1.0 - smoothstep(-10.0, -60.0, vW.y) * 0.9);
        gl_FragColor = vec4(vec3(0.6, 0.95, 1.0) * a * 0.05, 1.0);
      }`,
  });
  for (let i = 0; i < 26; i++) {
    const E = (rnd() - 0.5) * 220, N = (rnd() - 0.5) * 220;
    const len = 40 + rnd() * 30;
    const geo = new THREE.CylinderGeometry(1 + rnd() * 1.5, 2.5 + rnd() * 3.5, len, 12, 1, true);
    geo.translate(0, -len / 2, 0);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(E, 0, -N);
    m.rotation.set(0.15, 0, -0.25);
    m.frustumCulled = false;
    g.add(m);
  }
  return g;
}

// marine snow in a 120 m box that wraps around the camera
function buildMarineSnow(rnd) {
  const n = 9000, arr = new Float32Array(n * 3), sz = new Float32Array(n);
  for (let i = 0; i < n; i++) { arr.set([rnd() * 120, rnd() * 120, rnd() * 120], i * 3); sz[i] = 0.5 + rnd(); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  const mat = new THREE.PointsMaterial({ color: hdr('#d9f4ff', 1.2), size: 0.12, map: glowTexture(), transparent: true, opacity: 0.75, depthWrite: false });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.vertexShader = 'uniform float uTime;\nattribute float aSize;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 drift = vec3(sin(uTime * 0.2 + position.z * 0.3) * 0.6, -uTime * 0.12 * aSize, 0.0);
        transformed = cameraPosition + mod(position + drift - cameraPosition + 60.0, 120.0) - 60.0;
        transformed.y = min(transformed.y, -0.3);`)
      .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
  };
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  p.name = 'snow';
  return p;
}

function rockGeometry(detail, seed) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = 1 + 0.28 * noise2(v.x * 1.7 + seed, v.y * 1.9 + v.z * 1.3) + 0.1 * noise2(v.x * 5 + seed, v.z * 5 - v.y);
    v.multiplyScalar(d);
    v.y = Math.max(v.y, -0.45);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

const clearOf = (E, N, r) => !ITEM_DEFS.some((d) => Math.hypot(E - d.E, N - d.N) < r) && Math.hypot(E - START.E, N - START.N) > 14;
const Y = new THREE.Vector3(0, 1, 0);
const rot = (a) => new THREE.Quaternion().setFromAxisAngle(Y, a);

function buildRocks(chunks, rnd, sph) {
  const t = textures();
  const spots = scatter(rnd, 22, { E0: -HALF, E1: HALF, N0: -HALF, N1: HALF }, (E, N) => (clearOf(E, N, 8) ? 0.55 : 0));
  decor(chunks, rockGeometry(3, 3.3), uw({ bumpMap: t.rockBump, bumpScale: 2.5, roughness: 0.9 }), spots, (E, N) => {
    const s = 1 + rnd() * rnd() * 6;
    const y = floorAt(E, N) + s * 0.15;
    sph(E, N, y, s * 1.05, 'rock');
    return { pos: new THREE.Vector3(E, y, -N), quat: rot(rnd() * 6), scale: new THREE.Vector3(s * 1.2, s * 0.8, s),
      color: new THREE.Color(y < -80 ? '#5a5478' : '#b3a896').offsetHSL(0, 0, (rnd() - 0.5) * 0.1) };
  });
}

function buildShallows(chunks, rnd) {
  const box = { E0: -HALF, E1: -60, N0: -HALF, N1: -80 };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const reef = (k) => (E, N) => (clearOf(E, N, 3) ? B.shallow(E, N) * k : 0);

  // brain coral: lumpy, grooved domes
  const brain = new THREE.IcosahedronGeometry(1, 5);
  { const p = brain.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const groove = Math.abs(Math.sin(v.x * 9 + noise2(v.y * 3, v.z * 3) * 3) * Math.sin(v.z * 9 + noise2(v.x * 3, v.y * 3) * 3));
      v.multiplyScalar(1 + 0.06 * groove);
      p.setXYZ(i, v.x, Math.max(v.y, -0.3), v.z);
    }
    brain.computeVertexNormals(); }
  decor(chunks, brain, uw({ roughness: 0.7 }), scatter(rnd, 7, box, reef(0.6)), (E, N) => {
    const s = 0.6 + rnd() * 1.5;
    return { pos: new THREE.Vector3(E, floorAt(E, N) + s * 0.2, -N), quat: rot(rnd() * 6), scale: new THREE.Vector3(s, s * 0.75, s),
      color: pick(['#e0569c', '#b05ad9', '#f28b50', '#e8c547', '#5fc0d6']) };
  });

  // table coral
  const table = mergeGeometries([
    paint(new THREE.CylinderGeometry(0.12, 0.22, 1.2, 8).translate(0, 0.6, 0), '#ffffff'),
    paint(new THREE.CylinderGeometry(1.4, 1.15, 0.14, 24).translate(0, 1.2, 0), '#ffffff'),
    paint(new THREE.CylinderGeometry(0.9, 0.75, 0.12, 20).translate(0.5, 0.85, 0.3), '#ffffff'),
  ]);
  decor(chunks, table, uw({ roughness: 0.6 }), scatter(rnd, 9, box, reef(0.6)), (E, N) => {
    const s = 0.8 + rnd() * 1.4;
    return { pos: new THREE.Vector3(E, floorAt(E, N), -N), quat: rot(rnd() * 6), scale: new THREE.Vector3(s, s, s),
      color: pick(['#ff8a3d', '#3ec1c9', '#9ad94e', '#f35f8a']) };
  });

  // tube coral clusters with glowing rims
  const tubeParts = [];
  for (let i = 0; i < 7; i++) {
    const h = 0.6 + (i % 3) * 0.35, a = i * 0.9, d = i === 0 ? 0 : 0.28;
    tubeParts.push(paint(new THREE.CylinderGeometry(0.12, 0.09, h, 10, 1, true).translate(Math.cos(a) * d, h / 2, Math.sin(a) * d), '#ffffff'));
    tubeParts.push(paint(new THREE.TorusGeometry(0.12, 0.025, 4, 10).rotateX(Math.PI / 2).translate(Math.cos(a) * d, h, Math.sin(a) * d), '#ffffff'));
  }
  decor(chunks, mergeGeometries(tubeParts), uw({ side: THREE.DoubleSide, emissive: '#ff4fd8', emissiveIntensity: 0.25 }, { anim: 'sway', amt: 0.04 }),
    scatter(rnd, 6, box, reef(0.6)), (E, N) => {
      const s = 0.9 + rnd() * 1.5;
      return { pos: new THREE.Vector3(E, floorAt(E, N) - 0.05, -N), quat: rot(rnd() * 6), scale: new THREE.Vector3(s, s, s),
        color: pick(['#a35ee8', '#ffd447', '#ff6f61', '#56e0c2']) };
    });

  // sea fans
  decor(chunks, new THREE.CircleGeometry(1, 24, 0, Math.PI), uw({ side: THREE.DoubleSide, roughness: 0.9 }, { anim: 'sway', amt: 0.05 }),
    scatter(rnd, 8, box, reef(0.6)), (E, N) => {
      const s = 0.8 + rnd() * 1.3;
      return { pos: new THREE.Vector3(E, floorAt(E, N), -N), quat: rot(rnd() * 6), scale: new THREE.Vector3(s, s * 1.3, s),
        color: pick(['#e8434f', '#f0884a', '#c94fd6']) };
    });

  // acid mushrooms with glowing caps
  const mush = mergeGeometries([
    paint(new THREE.CylinderGeometry(0.08, 0.11, 0.7, 8).translate(0, 0.35, 0), '#e8f0c8'),
    paint(new THREE.SphereGeometry(0.4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.65, 0), '#7de05a'),
  ]);
  decor(chunks, mush, uw({ vertexColors: true, emissive: '#3cff3c', emissiveIntensity: 0.35, roughness: 0.5 }),
    scatter(rnd, 7, box, reef(0.6)), (E, N) => {
      const s = 0.7 + rnd() * 1.1;
      return { pos: new THREE.Vector3(E, floorAt(E, N), -N), quat: rot(rnd() * 6), scale: new THREE.Vector3(s, s, s) };
    });

  // anemones: base + glowing tentacles, merged into one instanced geometry
  const parts = [paint(new THREE.CylinderGeometry(0.35, 0.45, 0.4, 12).translate(0, 0.2, 0), '#d9568c')];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const g = new THREE.CylinderGeometry(0.03, 0.06, 0.7, 5).translate(0, 0.35, 0);
    g.rotateX(Math.sin(a) * 0.5); g.rotateZ(-Math.cos(a) * 0.5);
    parts.push(paint(g.translate(Math.cos(a) * 0.22, 0.35, Math.sin(a) * 0.22), '#ffb3d1'));
  }
  decor(chunks, mergeGeometries(parts), uw({ vertexColors: true, emissive: '#ff5fa2', emissiveIntensity: 0.5 }, { anim: 'sway', amt: 0.2 }),
    scatter(rnd, 14, box, reef(0.5)), (E, N) => {
      const s = 1 + rnd();
      return { pos: new THREE.Vector3(E, floorAt(E, N), -N), quat: rot(rnd() * 6), scale: new THREE.Vector3(s, s, s) };
    });

  // green sea grass
  const blade = new THREE.PlaneGeometry(0.1, 1, 1, 5).translate(0, 0.5, 0);
  { const p = blade.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) * (1 - y * 0.8)); } }
  decor(chunks, blade, uw({ side: THREE.DoubleSide, roughness: 0.8 }, { anim: 'sway', amt: 0.25 }),
    scatter(rnd, 1.6, box, (E, N) => B.shallow(E, N) * 0.9), (E, N) => {
      const s = 0.6 + rnd() * 1.6;
      return { pos: new THREE.Vector3(E, floorAt(E, N) - 0.05, -N), quat: rot(rnd() * 6), scale: new THREE.Vector3(1, s, 1),
        color: pick(['#6fbf5a', '#9ccf4f', '#4f9e6a', '#c2c95a']) };
    }, { cast: false });
  TEX.blade = blade;
}

function buildPlateau(chunks, scene, rnd, cyl, sph) {
  const box = { E0: -HALF, E1: 330, N0: -HALF, N1: HALF };
  const plateau = (E, N) => {
    const y = floorAt(E, N);
    return y < -40 && y > -75 && B.kelp(E, N) < 0.1 && B.mush(E, N) < 0.1 ? 1 : 0;
  };
  // red grass patches (the Subnautica grassy plateaus)
  decor(chunks, TEX.blade, uw({ side: THREE.DoubleSide, roughness: 0.7, emissive: '#3a0a06', emissiveIntensity: 0.4 }, { anim: 'sway', amt: 0.22 }),
    scatter(rnd, 1.7, box, (E, N) => (noise2(E * 0.02, N * 0.02) > 0.1 ? plateau(E, N) * 0.9 : 0)), (E, N) => {
      const s = 0.9 + rnd() * 2.2;
      return { pos: new THREE.Vector3(E, floorAt(E, N) - 0.05, -N), quat: rot(rnd() * 6), scale: new THREE.Vector3(1.5, s, 1.5),
        color: ['#c9483a', '#e0603f', '#a8362e', '#d9733f'][Math.floor(rnd() * 4)] };
    }, { cast: false });

  // rock arches and spires: landmarks you can navigate by
  const t = textures();
  const stone = uw({ color: '#9b8a80', bumpMap: t.rockBump, bumpScale: 3, roughness: 0.9 });
  for (const [E, N, s, kind] of [[-80, 60, 1.4, 'arch'], [120, -90, 1.8, 'arch'], [-150, -120, 1.2, 'spire'], [60, 140, 1.6, 'spire'],
    [180, 40, 1.3, 'arch'], [-40, -60, 1.0, 'spire'], [250, -200, 1.5, 'spire'], [-200, 20, 1.3, 'arch']]) {
    const y0 = floorAt(E, N);
    const g = new THREE.Group();
    if (kind === 'arch') {
      for (const dx of [-14, 14]) {
        const p = new THREE.Mesh(rockGeometry(3, E + dx), stone);
        p.scale.set(5, 16, 5); p.position.set(dx, 10, 0); g.add(p);
        cyl(E + dx * s, N, 5.5 * s, y0, y0 + 26 * s, 'rock arch pillar');
      }
      const top = new THREE.Mesh(new THREE.TorusGeometry(14, 4.5, 10, 24, Math.PI), stone);
      top.position.y = 22; g.add(top);
      sph(E, N, y0 + 36 * s, 6 * s, 'rock arch top');
    } else {
      const p = new THREE.Mesh(rockGeometry(4, N), stone);
      p.scale.set(7, 30, 7); p.position.y = 18; g.add(p);
      cyl(E, N, 7.5 * s, y0, y0 + 48 * s, 'rock spire');
    }
    g.position.set(E, y0 - 1, -N);
    g.scale.setScalar(s);
    chunks.add(shadows(g), E, N);
  }
}

function leafGeometry(len, width) {
  const g = new THREE.PlaneGeometry(len, width, 6, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + len / 2, u = x / len;
    p.setXYZ(i, x, p.getY(i) * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - u * 0.3), -u * u * len * 0.35);
  }
  g.computeVertexNormals();
  return g;
}

// a kelp stalk prototype, 30 m tall (instances are scaled to reach ~5 m below the surface)
function kelpPrototype(rnd, h = 30) {
  const parts = [];
  const phase = rnd() * 6.28;
  const pts = [];
  for (let k = 0; k <= 8; k++) pts.push(new THREE.Vector3(Math.sin(k * 0.9 + phase) * 0.4, (k / 8) * h, Math.cos(k * 0.7 + phase) * 0.4));
  parts.push(paint(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 22, 0.12, 5), '#5b7f2e'));
  for (let y = 1.5; y < h - 0.5; y += 1.1 + rnd() * 0.8) {
    const leaf = leafGeometry(1.5 + rnd() * 1.0, 0.55);
    leaf.rotateZ(0.5 + rnd() * 0.4); leaf.rotateY(rnd() * 6.28);
    leaf.translate(Math.sin((y / h) * 7.2 + phase) * 0.4, y, Math.cos((y / h) * 5.6 + phase) * 0.4);
    parts.push(paint(leaf, rnd() < 0.5 ? '#7fae3a' : '#9cc24a'));
  }
  for (let k = 0; k < 3; k++) {    // glowing seed pods near the top
    parts.push(paint(new THREE.IcosahedronGeometry(0.2, 1).scale(1, 1.3, 1).translate((rnd() - 0.5) * 0.8, h - 2 - k * 2.5, (rnd() - 0.5) * 0.8), '#ffe36a'));
  }
  const g = mergeGeometries(parts);
  const pos = g.attributes.position, sway = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) sway[i] = Math.pow(Math.max(pos.getY(i), 0) / h, 1.5) * 1.8;
  g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
  return g;
}

function buildKelp(chunks, rnd, cyl) {
  const mat = uw({ vertexColors: true, side: THREE.DoubleSide, emissive: '#1d3008', emissiveIntensity: 0.8, roughness: 0.6 }, { anim: 'kelp' });
  const protos = [0, 1, 2, 3].map(() => kelpPrototype(rnd));
  const spots = scatter(rnd, 3.6, { E0: -460, E1: -180, N0: 40, N1: 300 },
    (E, N) => (ITEM_DEFS.some((d) => Math.hypot(E - d.E, N - d.N) < 2.4) ? 0 : B.kelp(E, N) > 0.5 ? 0.95 : B.kelp(E, N) * 0.6));
  const byProto = protos.map(() => []);
  spots.forEach((s, i) => byProto[i % protos.length].push(s));
  protos.forEach((geo, k) => decor(chunks, geo, mat, byProto[k], (E, N) => {
    // canopy at 6.5-9.5 m depth: a sub parked at 3 m (hull bottom at 5.3 m) clears it
    const base = floorAt(E, N), top = -6.5 - rnd() * 3, h = top - base;
    if (h < 3) return null;
    cyl(E, N, 0.4, base, top, 'kelp stalk');
    return { pos: new THREE.Vector3(E, base, -N), quat: rot(rnd() * 6), scale: new THREE.Vector3(1, h / 30, 1) };
  }));
}

function buildDeep(chunks, scene, rnd, cyl, sph, updaters) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const deepBox = { E0: 60, E1: HALF, N0: -HALF, N1: HALF };
  const isDeep = (E, N) => (floorAt(E, N) < -85 ? 1 : 0);

  // bioluminescent bulb plants: instanced HDR bulbs + one glow point cloud
  const bulbs = scatter(rnd, 9, deepBox, (E, N) => isDeep(E, N) * 0.5);
  const bulbGeo = mergeGeometries([
    paint(new THREE.CylinderGeometry(0.06, 0.12, 1, 6).translate(0, 0.5, 0), '#22243a'),
    paint(new THREE.SphereGeometry(0.3, 12, 8).translate(0, 1.05, 0), '#ffffff'),
  ]);
  const bulbMat = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: '#ffffff', emissiveIntensity: 3, roughness: 0.4 });
  bulbMat.onBeforeCompile = (sh) => {   // only the bulb (white vertex colour) glows, tinted per instance
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vColor.rgb * vColor.rgb;');
  };
  const glowPts = [], glowCol = [];
  const palette = ['#3ff0ff', '#a96bff', '#47ffa3', '#ff5fd2'];
  decor(chunks, bulbGeo, bulbMat, bulbs, (E, N) => {
    const color = pick(palette), h = 0.8 + rnd() * 2.4, y = floorAt(E, N);
    glowPts.push(E, y + h * 1.05, -N);
    const c = new THREE.Color(color); glowCol.push(c.r, c.g, c.b);
    return { pos: new THREE.Vector3(E, y, -N), scale: new THREE.Vector3(1, h, 1), color };
  }, { cast: false });
  const gGeo = new THREE.BufferGeometry();
  gGeo.setAttribute('position', new THREE.Float32BufferAttribute(glowPts, 3));
  gGeo.setAttribute('color', new THREE.Float32BufferAttribute(glowCol, 3));
  const gMat = new THREE.PointsMaterial({ size: 3.2, map: glowTexture(), vertexColors: true, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false });
  gMat.defines = { FOG_ADDITIVE: '' };
  const glowCloud = new THREE.Points(gGeo, gMat);
  scene.add(glowCloud);

  // glowing dots on the canyon walls
  const dots = scatter(rnd, 6, { E0: 260, E1: HALF, N0: -HALF, N1: HALF }, (E, N) => {
    const y = floorAt(E, N), s = Math.abs(floorAt(E + 1, N) - y);
    return y < -70 && s > 0.6 ? 0.8 : 0;
  });
  decor(chunks, new THREE.SphereGeometry(0.14, 6, 4), new THREE.MeshBasicMaterial({ color: hdr('#ffffff', 4) }), dots, (E, N) => ({
    pos: new THREE.Vector3(E, floorAt(E, N) + 0.2, -N), color: pick(['#3ff0ff', '#a96bff']),
  }), { cast: false });

  // giant glowing mushroom trees in the Mushroom Forest (and a few in the canyon)
  const capMat = uw({ color: '#6b3fa8', emissive: '#3a1670', emissiveIntensity: 0.6, roughness: 0.5, clearcoat: 0.6 }, { physical: true });
  const gillMat = new THREE.MeshBasicMaterial({ color: hdr('#c48bff', 3), side: THREE.DoubleSide });
  const trunkMat = uw({ color: '#d8cfe8', roughness: 0.7 });
  const profile = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; profile.push(new THREE.Vector2(0.9 - 0.45 * Math.sin(t * Math.PI * 0.9) + (t < 0.1 ? 0.6 * (0.1 - t) * 10 : 0), t * 12.5)); }
  const trunkGeo = new THREE.LatheGeometry(profile, 14);
  const capGeo = new THREE.SphereGeometry(5.5, 28, 12, 0, Math.PI * 2, 0, Math.PI * 0.42);
  const gillGeo = new THREE.RingGeometry(0.8, 5.0, 28, 2).rotateX(Math.PI / 2);
  const sporeGeo = new THREE.SphereGeometry(0.14, 6, 4), sporeMat = new THREE.MeshBasicMaterial({ color: hdr('#ffd1ff', 6) });
  const shrooms = scatter(rnd, 38, { E0: 100, E1: 360, N0: 140, N1: 390 }, (E, N) =>
    (B.mush(E, N) > 0.5 && !ITEM_DEFS.some((d) => Math.hypot(E - d.E, N - d.N) < 14) ? 0.8 : 0));
  for (const [E, N] of shrooms) {
    const s = 1.4 + rnd() * 1.4;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(trunkGeo, trunkMat));
    const cap = at(new THREE.Mesh(capGeo, capMat), 0, 12, 0); cap.scale.y = 0.75; g.add(cap);
    g.add(at(new THREE.Mesh(gillGeo, gillMat), 0, 12.35, 0));
    for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; g.add(at(new THREE.Mesh(sporeGeo, sporeMat), Math.cos(a) * 4.6, 13.2, Math.sin(a) * 4.6)); }
    const base = floorAt(E, N);
    g.position.set(E, base - 0.5, -N);
    g.scale.setScalar(s);
    g.rotation.y = rnd() * 6;
    chunks.add(shadows(g), E, N);
    glowPts.push(E, base + 11 * s, -N); glowCol.push(0.7, 0.45, 1.0);
    cyl(E, N, 1.2 * s, base, base + 11 * s, 'giant mushroom stem');
    cyl(E, N, 5.5 * s, base + 11 * s, base + 15 * s, 'giant mushroom cap');
  }
  gGeo.setAttribute('position', new THREE.Float32BufferAttribute(glowPts, 3));
  gGeo.setAttribute('color', new THREE.Float32BufferAttribute(glowCol, 3));

  // drifting jellyfish
  const jellies = [];
  for (let i = 0; i < 40; i++) {
    const color = pick(['#ff7ae0', '#7af0ff', '#c7a0ff']);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.8, transparent: true, opacity: 0.55, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false })));
    const tentMat = new THREE.MeshBasicMaterial({ color: hdr(color, 1.5), transparent: true, opacity: 0.5, depthWrite: false });
    for (let k = 0; k < 6; k++) {
      const pts = [0, 1, 2, 3].map((j) => new THREE.Vector3(Math.cos(k) * 0.35 + Math.sin(j + k) * 0.12, -j * 0.6, Math.sin(k) * 0.35));
      g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.02, 3), tentMat));
    }
    g.add(glowSprite(color, 3.2, 0.45));
    const inMush = i < 22;
    const E = inMush ? 230 + (rnd() - 0.5) * 220 : canyonX(0) + (rnd() - 0.5) * 60;
    const N = inMush ? 260 + (rnd() - 0.5) * 220 : (rnd() - 0.5) * 900;
    const home = new THREE.Vector3(E, inMush ? -40 - rnd() * 50 : -60 - rnd() * 110, -N);
    jellies.push({ g, home, phase: rnd() * 6.28 });
    scene.add(g);
  }

  // crystal crevice: ring of pillars + boulder cap (diver-only entrance)
  const t = textures();
  const rockMat = uw({ color: '#4c4868', bumpMap: t.rockBump, bumpScale: 3 });
  const floorC = floorAt(CREVICE.E, CREVICE.N);
  // 7 pillars on a 7 m ring: ~2.5 m gaps between them -> the diver (0.5 m radius) fits, the sub (2.3 m) does not
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.2;
    const E = CREVICE.E + Math.cos(a) * 7, N = CREVICE.N + Math.sin(a) * 7;
    const base = floorAt(E, N) - 1, top = floorC + 15;
    const p = new THREE.Mesh(rockGeometry(3, i * 1.7), rockMat);
    p.scale.set(1.35, (top - base) / 2, 1.35);
    p.position.set(E, (top + base) / 2, -N);
    chunks.add(shadows(p), E, N);
    cyl(E, N, 1.4, base, top, 'crevice pillar');
  }
  const cap = new THREE.Mesh(rockGeometry(4, 9.1), rockMat);
  cap.scale.set(8, 3.6, 8);
  cap.position.set(CREVICE.E, floorC + 17, -CREVICE.N);
  chunks.add(shadows(cap), CREVICE.E, CREVICE.N);
  sph(CREVICE.E, CREVICE.N, floorC + 17, 7.6, 'crevice cap boulder');
  const crystalMat = uw({ color: '#ffc4f6', emissive: '#d050ff', emissiveIntensity: 2.5, roughness: 0.15, metalness: 0.1, clearcoat: 1 }, { physical: true });
  for (let i = 0; i < 12; i++) {
    const a = rnd() * 6.28, d = rnd() * 4;
    const E = CREVICE.E + Math.cos(a) * d, N = CREVICE.N + Math.sin(a) * d;
    const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.5 + rnd() * 0.6, 0), crystalMat);
    cr.scale.y = 2.2;
    cr.position.set(E, floorAt(E, N) + 0.6, -N);
    cr.rotation.set(rnd() * 0.5, rnd() * 3, rnd() * 0.5);
    chunks.add(cr, E, N);
  }
  const crevLight = new THREE.PointLight('#e070ff', 60, 18, 1.6);
  crevLight.position.set(CREVICE.E, floorC + 2, -CREVICE.N);
  scene.add(crevLight);
  scene.add(at(glowSprite('#ff7ef0', 14, 0.3), CREVICE.E, floorC + 2, -CREVICE.N));

  updaters.push((time) => {
    gMat.opacity = 0.5 + 0.12 * Math.sin(time * 1.3);
    for (const j of jellies) {
      j.g.position.set(j.home.x + Math.sin(time * 0.07 + j.phase) * 8, j.home.y + Math.sin(time * 0.5 + j.phase) * 1.5, j.home.z + Math.cos(time * 0.05 + j.phase) * 8);
      const p = Math.sin(time * 2 + j.phase) * 0.12;
      j.g.scale.set(1 + p, 1 - p, 1 + p);
    }
  });
}

// a crashed ship: two broken hull halves half-buried on the plateau, with emergency lights
function buildWreck(scene, sph) {
  const g = new THREE.Group();
  const hullMat = uw({ color: '#d9d4c8', roughness: 0.45, metalness: 0.5, clearcoat: 0.3 }, { physical: true });
  const rust = uw({ color: '#8a4a32', roughness: 0.8, metalness: 0.4 });
  const stripe = uw({ color: '#ff7a1a', roughness: 0.5, metalness: 0.3 });
  const prof = [];
  for (let i = 0; i <= 20; i++) { const t = i / 20; prof.push(new THREE.Vector2(Math.max(0.5, Math.sin(Math.PI * Math.pow(t, 0.6)) * 14), t * 70)); }
  const halfGeo = new THREE.LatheGeometry(prof, 32, 0, Math.PI * 1.6);
  const y0 = floorAt(WRECK.E, WRECK.N);
  const bow = new THREE.Mesh(halfGeo, hullMat);
  bow.rotation.set(Math.PI / 2 - 0.12, 0, 0.35); bow.position.set(-10, 4, 0); g.add(bow);
  const stern = new THREE.Mesh(halfGeo, hullMat);
  stern.rotation.set(-Math.PI / 2 + 0.2, 0.4, -0.5); stern.position.set(14, 3, 18); g.add(stern);
  for (const m of [bow, stern]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(13.5, 0.9, 8, 32, Math.PI * 1.6), stripe);
    band.rotation.x = Math.PI / 2; band.position.y = 30; m.add(band);
    for (let k = 0; k < 6; k++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(12.5, 0.5, 6, 24, Math.PI * 1.6), rust);
      rib.rotation.x = Math.PI / 2; rib.position.y = 8 + k * 9; m.add(rib);
    }
  }
  // debris + blinking emergency lights
  const lightMat = new THREE.MeshBasicMaterial({ color: hdr('#ff3b2a', 8) });
  for (let k = 0; k < 14; k++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(2 + (k % 4), 1 + (k % 3), 3 + (k % 5)), k % 3 ? hullMat : rust);
    d.position.set(Math.sin(k * 2.3) * 40, 0.5, Math.cos(k * 1.7) * 45); d.rotation.set(k, k * 2, k * 0.5); g.add(d);
  }
  for (const [x, y, z] of [[-10, 18, -40], [14, 16, 50], [0, 10, 5], [-25, 6, -10]]) {
    g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), lightMat), x, y, z));
    g.add(at(glowSprite('#ff4030', 9, 0.6, 2), x, y, z));
  }
  g.position.set(WRECK.E, y0, -WRECK.N);
  scene.add(shadows(g));
  for (let k = -3; k <= 3; k++) sph(WRECK.E - 4, WRECK.N - k * 10, y0 + 6, 13, 'ship wreck hull');
}

// fish body: lathe profile (nose at -z, tail at +z) + tail and dorsal fin
export function fishGeometry() {
  const prof = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push(new THREE.Vector2(Math.max(0.001, Math.sin(Math.PI * Math.pow(t, 0.8)) * 0.32 * (1 - t * 0.35)), t * 1.3 - 0.55)); }
  const body = new THREE.LatheGeometry(prof, 12).rotateX(Math.PI / 2).scale(0.8, 1.1, 1);
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.65, 0, 0.32, 1.0, 0, -0.32, 1.0], 3));
  tail.computeVertexNormals();
  const fin = new THREE.BufferGeometry();
  fin.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.3, -0.1, 0, 0.5, 0.25, 0, 0.28, 0.35], 3));
  fin.computeVertexNormals();
  return mergeGeometries([paint(body, '#ffffff'), paint(tail, '#dddddd'), paint(fin, '#dddddd')]);
}

function buildSchools(scene, rnd) {
  const schools = [
    [-330, -12, -310, '#ffb43b', 9], [-300, -10, -360, '#56c8ff', 7], [-380, -8, -290, '#ff6aa6', 10], [-260, -14, -250, '#ffd23f', 8],
    [-320, -14, 170, '#c2ff6b', 6], [-280, -20, 120, '#7fe6ff', 7], [-360, -10, 220, '#ffe08a', 6],
    [0, -30, 0, '#ff8a5c', 12], [-100, -35, 80, '#9be7ff', 10], [120, -30, -120, '#ff6aa6', 10], [60, -35, -230, '#c7a0ff', 9],
    [230, -70, 260, '#9e8cff', 8], [200, -60, 300, '#5ff0d8', 8], [390, -120, 50, '#5ff0d8', 7], [390, -140, -200, '#7af0ff', 7],
  ].map(([E, y, N, color, r]) => ({ c: [E, y, -N], color, n: 34, r }));
  const total = schools.reduce((s, x) => s + x.n, 0);
  const mesh = new THREE.InstancedMesh(fishGeometry(),
    uw({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.35, metalness: 0.3 }, { anim: 'fish', amt: 0.08, caustics: 0.5 }), total);
  mesh.castShadow = true;
  const fish = [];
  const c = new THREE.Color();
  let k = 0;
  for (const s of schools) {
    for (let i = 0; i < s.n; i++, k++) {
      fish.push({ s, ph: rnd() * 6.28, rad: s.r * (0.5 + rnd() * 0.6), dy: (rnd() - 0.5) * 4, sp: 0.25 + rnd() * 0.1, sc: 0.6 + rnd() * 0.5 });
      mesh.setColorAt(k, c.set(s.color).offsetHSL((rnd() - 0.5) * 0.06, 0, (rnd() - 0.5) * 0.15));
    }
  }
  mesh.frustumCulled = false;
  scene.add(mesh);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  return (t) => {
    fish.forEach((f, i) => {
      const a = t * f.sp + f.ph;
      p.set(f.s.c[0] + Math.cos(a) * f.rad, f.s.c[1] + f.dy + Math.sin(a * 2) * 0.6, f.s.c[2] + Math.sin(a) * f.rad);
      q.setFromAxisAngle(Y, -a);
      sc.setScalar(f.sc);
      mesh.setMatrixAt(i, m4.compose(p, q, sc));
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
}

// gentle giants: a leviathan patrolling the canyon and a reefback grazing over the plateaus
function buildLeviathans(scene) {
  const make = (color, belly, len, lampColor) => {
    const g = new THREE.Group();
    const skin = uw({ color, roughness: 0.55, clearcoat: 0.4 }, { physical: true });
    const prof = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16; prof.push(new THREE.Vector2(Math.max(0.01, Math.sin(Math.PI * Math.pow(t, 0.7)) * len * 0.16), t * len - len / 2)); }
    const bodyGeo = new THREE.LatheGeometry(prof, 24).rotateX(Math.PI / 2);
    const body = new THREE.Mesh(bodyGeo, skin); body.scale.set(1, 0.75, 1); g.add(body);
    const under = new THREE.Mesh(bodyGeo, uw({ color: belly })); under.scale.set(0.9, 0.55, 0.97); under.position.y = -len * 0.035; g.add(under);
    const lampMat = new THREE.MeshBasicMaterial({ color: hdr(lampColor, 5) });
    for (const s of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.ConeGeometry(len * 0.08, len * 0.35, 6), skin);
      fin.rotation.set(Math.PI / 2, 0, s * 1.2); fin.position.set(s * len * 0.19, -len * 0.04, -len * 0.08); g.add(fin);
      for (let k = 0; k < 6; k++) g.add(at(new THREE.Mesh(new THREE.SphereGeometry(len * 0.01, 8, 6), lampMat), s * len * 0.11, len * 0.025, -len * 0.35 + k * len * 0.11));
    }
    const tail = new THREE.Mesh(new THREE.ConeGeometry(len * 0.12, len * 0.27, 6), skin);
    tail.rotation.x = -Math.PI / 2; tail.scale.set(1.6, 0.3, 1); tail.position.z = len * 0.58; g.add(tail);
    scene.add(shadows(g, true, false));
    return { g, tail };
  };
  const lev = make('#3b5e78', '#9fc4c9', 26, '#9ff7ff');
  const reef = make('#7d6a5c', '#d8c7a8', 60, '#ffe0a0');
  return (t) => {
    const a = t * 0.004;
    lev.g.position.set(canyonX(Math.sin(a) * 350), -130 + Math.sin(t * 0.1) * 3, -(Math.sin(a) * 350));
    lev.g.rotation.y = Math.cos(a) >= 0 ? 0 : Math.PI;
    lev.tail.rotation.y = Math.sin(t * 0.8) * 0.25;
    const b = t * 0.006;
    reef.g.position.set(Math.cos(b) * 160, -28 + Math.sin(t * 0.07) * 2, -(Math.sin(b) * 160));
    reef.g.rotation.y = -b;
    reef.tail.rotation.y = Math.sin(t * 0.4) * 0.2;
  };
}

// streams of bubbles rising from vents
function buildBubbleVents(scene, rnd) {
  const vents = [[-300, -330], [-350, -280], [-280, -360], [-250, -300], [-60, 40], [90, -40], [CREVICE.E, CREVICE.N], [380, 120], [210, 230]];
  const per = 60, n = vents.length * per;
  const arr = new Float32Array(n * 3), seed = new Float32Array(n), base = new Float32Array(n * 3);
  const ringMat = uw({ color: '#5b5560' });
  vents.forEach(([E, N], v) => {
    const y0 = floorAt(E, N);
    for (let i = 0; i < per; i++) { const k = v * per + i; base.set([E, y0, -N], k * 3); seed[k] = rnd(); }
    scene.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.18, 8, 16).rotateX(Math.PI / 2), ringMat), E, y0 + 0.05, -N));
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: hdr('#e9fbff', 1.6), size: 0.25, map: glowTexture(), transparent: true, opacity: 0.85, depthWrite: false }));
  pts.frustumCulled = false;
  scene.add(pts);
  return (t) => {
    for (let k = 0; k < n; k++) {
      const s = seed[k], life = (t * (0.06 + s * 0.03) + s) % 1, by = base[k * 3 + 1];
      arr[k * 3] = base[k * 3] + Math.sin(t * 3 + s * 40) * 0.12 * (1 + life * 3);
      arr[k * 3 + 1] = by + life * Math.min(40, Math.max(1, -by - 0.5));
      arr[k * 3 + 2] = base[k * 3 + 2] + Math.cos(t * 2.6 + s * 31) * 0.12 * (1 + life * 3);
    }
    geo.attributes.position.needsUpdate = true;
  };
}

function buildItemMesh(kind, name) {
  const g = new THREE.Group();
  if (kind === 'fish') {
    const palette = { Bubblefin: ['#ffcf3b', '#ff7a2f'], 'Kelp Peeper': ['#a4e05a', '#2f8f4f'], 'Glow Lanternfish': ['#2c3150', '#5ff7ff'] }[name];
    const body = new THREE.Mesh(fishGeometry(), uw({ color: palette[0], vertexColors: true, side: THREE.DoubleSide, roughness: 0.35, metalness: 0.2 }, { anim: 'fish', amt: 0.12, caustics: 0.4 }));
    body.scale.set(1.3, 1.5, 1.1);
    g.add(body);
    const eyeMat = uw({ color: '#ffffff', roughness: 0.1 }), pupilMat = new THREE.MeshBasicMaterial({ color: '#111111' });
    for (const s of [-1, 1]) {
      g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), eyeMat), s * 0.3, 0.12, -0.32));
      g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), pupilMat), s * 0.37, 0.12, -0.4));
    }
    if (name === 'Glow Lanternfish') {
      g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: hdr(palette[1], 6) })), 0, 0.6, -0.7));
      g.add(at(glowSprite(palette[1], 2.4, 0.7), 0, 0.6, -0.7));
    }
    g.scale.setScalar(1.6);
  } else if (kind === 'salad') {
    const mat = uw({ color: '#8ee05a', side: THREE.DoubleSide, emissive: '#3a8a10', emissiveIntensity: 0.6, roughness: 0.5 });
    for (let i = 0; i < 11; i++) {
      const leaf = new THREE.Mesh(leafGeometry(0.9, 0.7), mat);
      leaf.rotation.set(0, -(i / 11) * Math.PI * 2, 0.9 + (i % 3) * 0.2);
      leaf.position.y = 0.1;
      g.add(leaf);
    }
    g.add(at(glowSprite('#c8ff7a', 2.2, 0.3), 0, 0.5, 0));
    g.scale.setScalar(1.3);
  } else {
    const mat = uw({ color: '#ffffff', emissive: '#8f7cff', emissiveIntensity: 2.0, roughness: 0.1, metalness: 0.2, flatShading: true, clearcoat: 1 }, { physical: true });
    for (let i = 0; i < 5; i++) {
      const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.25, 0), mat);
      cr.scale.y = 2;
      cr.position.set((i - 2) * 0.18, 0.3, (i % 2) * 0.2 - 0.1);
      cr.rotation.z = (i - 2) * 0.25;
      g.add(cr);
    }
    g.add(at(glowSprite('#cbb8ff', 2.4, 0.5), 0, 0.4, 0));
    g.scale.setScalar(1.4);
  }
  return g;
}

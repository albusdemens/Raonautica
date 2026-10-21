// Rendering pipeline: underwater fog (global shader-chunk override), environment lighting,
// and post-processing (GTAO -> bloom -> underwater lens: sun shafts, refraction wobble,
// chromatic aberration, grading, vignette, grain -> ACES output).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------------------------------------------------------------- underwater fog
// Replaces three's fog for every built-in material: distance fog whose colour depends on depth and
// on how much you look toward the surface, plus wavelength-selective absorption (red dies first).
// Materials with defines.FOG_ADDITIVE (glows) fade to black instead of to the fog colour.

THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif`;

THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorldPos = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif`;

THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  vec3 uwFogColor(float depth, float up, float camDepth) {
    vec3 shallow = vec3(0.020, 0.40, 0.52);
    vec3 mid     = vec3(0.004, 0.14, 0.28);
    vec3 deep    = vec3(0.001, 0.010, 0.032);
    vec3 c = mix(shallow, mid, smoothstep(0.0, 60.0, depth));
    c = mix(c, deep, smoothstep(40.0, 160.0, depth));
    float sky = pow(max(up, 0.0), 2.2) * (1.0 - smoothstep(0.0, 70.0, camDepth));
    c += vec3(0.12, 0.42, 0.45) * sky;
    c *= fogColor;                      // fogColor acts as a global tint (white = neutral)
    return c;
  }
#endif`;

THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  vec3 fogV = vFogWorldPos - cameraPosition;
  float fogDist = length(fogV);
  vec3 fogDir = fogV / max(fogDist, 1e-4);
  float camD = max(-cameraPosition.y, 0.0);
  float fragD = max(-vFogWorldPos.y, 0.0);
  float avgD = 0.5 * (camD + fragD);
  #ifdef FOG_EXP2
    float dens = fogDensity * mix(0.65, 1.7, smoothstep(5.0, 110.0, avgD));
  #else
    float dens = 2.0 / fogFar;
  #endif
  vec3 absorbF = exp(-fogDist * vec3(0.030, 0.009, 0.006) * (dens / 0.03));
  float fogF = 1.0 - exp(-fogDist * dens);
  #ifdef FOG_ADDITIVE
    gl_FragColor.rgb *= (1.0 - fogF) * absorbF;
  #else
    gl_FragColor.rgb = mix(gl_FragColor.rgb * absorbF, uwFogColor(avgD, fogDir.y, camD), fogF);
  #endif
#endif`;

export function setupFog(scene) {
  scene.fog = new THREE.FogExp2(0xffffff, 0.024);
  // the "sky" of the underwater world: a big dome that is 100% fog, so the background matches the fog exactly
  const dome = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }));
  dome.name = 'waterdome';
  dome.frustumCulled = false;
  scene.add(dome);
  scene.background = null;
  return dome;
}

// ---------------------------------------------------------------- environment map (specular light)

export function makeEnvironment(renderer) {
  const envScene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vD; void main(){
      float y = vD.y;
      vec3 c = mix(vec3(0.01, 0.05, 0.10), vec3(0.05, 0.35, 0.45), smoothstep(-0.6, 0.3, y));
      c += vec3(1.6, 1.8, 1.6) * smoothstep(0.75, 0.98, y);   // the bright Snell's window overhead
      gl_FragColor = vec4(c, 1.0); }`,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  return tex;
}

// ---------------------------------------------------------------- post-processing

const UnderwaterShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSun: { value: new THREE.Vector2(0.5, 1.4) },
    uShaft: { value: 1.0 },
    uDepth: { value: 0 },
    uAspect: { value: 16 / 9 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uShaft, uDepth, uAspect; uniform vec2 uSun; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      // gentle refraction wobble
      vec2 uv = vUv + vec2(sin(vUv.y * 22.0 + uTime * 1.3), cos(vUv.x * 18.0 + uTime * 1.1)) * 0.0012;
      // chromatic aberration toward the edges (lens of the camera housing)
      vec2 dc = uv - 0.5;
      float ca = 0.0025 * dot(dc, dc) * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dc * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dc * ca).b;

      // screen-space sun shafts: march toward the sun's screen position, accumulating bright samples
      if (uShaft > 0.001) {
        const int N = 40;
        vec2 delta = (uv - uSun) / float(N) * 0.85;
        vec2 p = uv; float illum = 1.0; vec3 acc = vec3(0.0);
        float jitter = hash(uv * 731.0 + uTime);
        p -= delta * jitter;
        for (int i = 0; i < N; i++) {
          p -= delta;
          if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) break;
          vec3 s = texture2D(tDiffuse, p).rgb;
          float l = max(dot(s, vec3(0.25, 0.5, 0.25)) - 0.55, 0.0);
          acc += l * illum;
          illum *= 0.955;
        }
        col += acc * vec3(0.55, 0.85, 0.9) * 0.05 * uShaft;
      }

      // grading: lift shadows toward teal, a touch of contrast
      col = mix(col, col * vec3(0.92, 1.02, 1.05), 0.6);
      col += vec3(0.0, 0.004, 0.008) * (1.0 - smoothstep(0.0, 0.2, dot(col, vec3(0.33))));
      // vignette (stronger in the deep)
      float v = smoothstep(0.95, 0.25, length(dc * vec2(uAspect * 0.62, 1.0)));
      col *= mix(1.0, v, 0.55 + 0.25 * smoothstep(20.0, 80.0, uDepth));
      // fine grain
      col += (hash(vUv * 1000.0 + uTime) - 0.5) * 0.006;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export function createPipeline(renderer, scene, camera, { ao = true } = {}) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  let gtao = null;
  if (ao) {
    gtao = new GTAOPass(scene, camera, size.x, size.y);
    gtao.blendIntensity = 0.85;
    gtao.updateGtaoMaterial({ radius: 1.6, distanceFallOff: 1.0, thickness: 1.5, scale: 1.0, samples: 12 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    // GTAO only hides points/lines in its depth+normal prepass; glows, glass and other see-through
    // things would otherwise occlude as solid quads (black squares). Hide them too.
    gtao.overrideVisibility = function () {
      const cache = this._visibilityCache;
      this.scene.traverse((o) => {
        cache.set(o, o.visible);
        const m = o.material;
        if (o.isPoints || o.isLine || o.isSprite || (m && (m.transparent || m.blending === THREE.AdditiveBlending))) o.visible = false;
      });
    };
    composer.addPass(gtao);
  }
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.6, 0.9);
  composer.addPass(bloom);
  const uw = new ShaderPass(UnderwaterShader);
  composer.addPass(uw);
  composer.addPass(new OutputPass());

  const sunDir = new THREE.Vector3(-0.25, 1, 0.15).normalize();
  const tmp = new THREE.Vector3();

  return {
    composer, bloom, gtao, uw,
    setSize(w, h) { composer.setSize(w, h); uw.uniforms.uAspect.value = w / h; },
    render(time, { overview = false } = {}) {
      const depth = Math.max(0, -camera.position.y);
      uw.uniforms.uTime.value = time;
      uw.uniforms.uDepth.value = overview ? 0 : depth;
      // sun screen position (may be off-screen above: the shafts then stream down from the top edge)
      tmp.copy(camera.position).addScaledVector(sunDir, 200).project(camera);
      const facing = tmp.z < 1;
      uw.uniforms.uSun.value.set(Math.min(1.6, Math.max(-0.6, tmp.x * 0.5 + 0.5)), Math.min(2.2, Math.max(-0.5, tmp.y * 0.5 + 0.5)));
      uw.uniforms.uShaft.value = overview || !facing ? 0 : 1 - THREE.MathUtils.smoothstep(depth, 15, 60);
      bloom.strength = overview ? 0.25 : 0.45 + 0.5 * THREE.MathUtils.smoothstep(depth, 30, 80);
      composer.render();
    },
  };
}

// ---------------------------------------------------------------- helpers

// an HDR colour (values > 1 bloom)
export const hdr = (c, k) => new THREE.Color(c).multiplyScalar(k);

let GLOW_TEX = null;
export function glowTexture() {
  if (GLOW_TEX) return GLOW_TEX;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.5)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  GLOW_TEX = new THREE.CanvasTexture(cv);
  GLOW_TEX.colorSpace = THREE.SRGBColorSpace;
  return GLOW_TEX;
}

// additive glow sprite that fades with underwater distance
export function glowSprite(color, size, opacity = 0.8, k = 1.5) {
  const m = new THREE.SpriteMaterial({ map: glowTexture(), color: hdr(color, k), transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false });
  m.defines = { FOG_ADDITIVE: '' };
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  return s;
}

// The submarine ("Minnow") and the diver. Both face -z (North) at heading 0.
import * as THREE from 'three';
import { uw, glowSprite } from './world.js';
import { hdr } from './fx.js';

export function createSub(scene) {
  const root = new THREE.Group();
  const hull = uw({ color: '#f2f0ea', roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08 }, { caustics: 0.6, physical: true });
  const accent = uw({ color: '#ff8a2a', roughness: 0.35, clearcoat: 1 }, { physical: true }), dark = uw({ color: '#2d3440', roughness: 0.4, metalness: 0.6 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 16), hull);
  body.scale.set(1, 0.85, 1.7); root.add(body);
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.12, 8, 28), accent);
  stripe.scale.set(1, 1.7, 1); stripe.rotation.y = Math.PI / 2; stripe.position.y = 0.05; root.add(stripe);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.25, 20, 14, 0, Math.PI * 2, 0, Math.PI / 1.7),
    new THREE.MeshPhysicalMaterial({ color: '#8fe0ff', transparent: true, opacity: 0.38, roughness: 0.04, metalness: 0, clearcoat: 1,
      emissive: '#1b5c78', emissiveIntensity: 0.5, envMapIntensity: 2.5, depthWrite: false }));
  dome.rotation.x = -Math.PI / 2.2; dome.position.set(0, 0.25, -1.6); root.add(dome);
  // cockpit: seat + glowing console behind the glass
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.6), dark); seat.position.set(0, 0.0, -0.9); root.add(seat);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.35), new THREE.MeshBasicMaterial({ color: hdr('#5ff7ff', 3) }));
  screen.position.set(0, -0.2, -2.3); screen.rotation.x = -0.6; root.add(screen);
  // side pontoons with thrusters
  for (const s of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 2.4, 6, 12), hull);
    pod.rotation.x = Math.PI / 2; pod.position.set(s * 1.75, -0.45, 0.3); root.add(pod);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.08, 6, 16), accent);
    ring.position.set(s * 1.75, -0.45, 1.85); root.add(ring);
    const jet = glowSprite('#9ff3ff', 1.1, 0.7, 3); jet.position.set(s * 1.75, -0.45, 2.1); root.add(jet);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.25, 10), new THREE.MeshBasicMaterial({ color: hdr('#fff6c8', 10) }));
    lamp.rotation.x = Math.PI / 2; lamp.position.set(s * 1.75, -0.45, -1.5); root.add(lamp);
    const lg = glowSprite('#fff2b0', 1.6, 0.8); lg.position.set(s * 1.75, -0.45, -1.65); root.add(lg);
  }
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 1.2), accent);
  fin.position.set(0, 1.35, 1.4); root.add(fin);
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 14), dark);
  hatch.position.set(0, -1.35, 0.4); root.add(hatch);

  // headlights (always present so the shader program never changes)
  const lights = [];
  for (const s of [-1, 1]) {
    const L = new THREE.SpotLight('#fff3d0', 0, 45, 0.45, 0.6, 1.2);
    L.position.set(s * 1.75, -0.45, -1.6);
    L.target.position.set(s * 1.0, -2.5, -20);
    root.add(L); root.add(L.target);
    lights.push(L);
  }

  root.traverse((o) => { if (o.isMesh && o !== dome) o.castShadow = true; });
  scene.add(root);
  return {
    root,
    update(pose, time, depth) {
      root.position.set(pose.E, pose.y, -pose.N);
      root.rotation.set(Math.sin(time * 0.8) * 0.015, -THREE.MathUtils.degToRad(pose.heading), Math.sin(time * 0.6) * 0.03);
      const on = depth > 25 ? 1 : depth > 12 ? (depth - 12) / 13 : 0;
      for (const L of lights) L.intensity = on * 160;
    },
  };
}

export function createDiver(scene) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const suit = uw({ color: '#f4f1e8', roughness: 0.6 }, { caustics: 0.5 }), orange = uw({ color: '#ff7b2e', roughness: 0.35, clearcoat: 1 }, { physical: true });
  const dark = uw({ color: '#30384a', roughness: 0.3, metalness: 0.8 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.6, 6, 12), suit);
  torso.rotation.x = Math.PI / 2; body.add(torso);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10), orange);
  helmet.position.set(0, 0.05, -0.62); body.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: hdr('#6fe3ff', 2.5) }));
  visor.rotation.x = -Math.PI / 2; visor.position.set(0, 0.0, -0.78); body.add(visor);
  const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.45, 4, 8), dark);
  tank.rotation.x = Math.PI / 2; tank.position.set(0, 0.28, -0.05); body.add(tank);
  const tankStripe = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 6, 12), orange);
  tankStripe.position.set(0, 0.28, -0.05); body.add(tankStripe);
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(s * 0.13, 0, 0.35);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.55, 4, 8), suit);
    thigh.rotation.x = Math.PI / 2; thigh.position.z = 0.3; leg.add(thigh);
    const flipper = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.42), orange);
    flipper.position.z = 0.8; leg.add(flipper);
    body.add(leg); legs.push(leg);
  }
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.5, 4, 8), suit);
    arm.rotation.set(Math.PI / 2 - 0.3, 0, s * 0.35); arm.position.set(s * 0.32, -0.05, -0.55); body.add(arm);
  }
  const torch = new THREE.SpotLight('#e8fbff', 0, 22, 0.5, 0.7, 1.2);
  torch.position.set(0.3, -0.05, -0.9); torch.target.position.set(0.3, -1.2, -10);
  body.add(torch); body.add(torch.target);
  const torchGlow = glowSprite('#e8fbff', 0.8, 0.8); torchGlow.position.copy(torch.position); body.add(torchGlow);

  const bubbles = [];
  for (let i = 0; i < 8; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.05 + Math.random() * 0.05, 6, 4),
      new THREE.MeshBasicMaterial({ color: '#dff8ff', transparent: true, opacity: 0.7 }));
    scene.add(b); bubbles.push({ b, ph: i / 8 });
  }
  root.scale.setScalar(1.15);
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(root);

  return {
    root,
    setVisible(v) { root.visible = v; for (const x of bubbles) x.b.visible = v; },
    update(pose, time, depth, moving) {
      root.position.set(pose.E, pose.y, -pose.N);
      root.rotation.y = -THREE.MathUtils.degToRad(pose.heading);
      body.rotation.x = -0.15 + Math.sin(time * 1.2) * 0.04;
      body.position.y = Math.sin(time * 1.5) * 0.05;
      const kick = moving ? 0.45 : 0.12;
      legs[0].rotation.x = Math.sin(time * 6) * kick;
      legs[1].rotation.x = -Math.sin(time * 6) * kick;
      torch.intensity = depth > 20 ? 60 : 0;
      torchGlow.visible = depth > 20;
      for (const x of bubbles) {
        const k = (time * 0.35 + x.ph) % 1;
        x.b.position.set(pose.E + Math.sin(k * 20 + x.ph * 9) * 0.15, pose.y + 0.3 + k * 4, -pose.N + 0.6);
        x.b.material.opacity = 0.7 * (1 - k);
      }
    },
  };
}

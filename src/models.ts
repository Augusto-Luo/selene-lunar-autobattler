import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Team, UnitKind } from './types';

interface ModelMaterials {
  armor: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  dust: THREE.MeshStandardMaterial;
}

function surfaceTextures() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(512, 512);
  for (let i = 0; i < image.data.length; i += 4) {
    const x = (i / 4) % 512;
    const y = Math.floor(i / 4 / 512);
    const dust = Math.max(0, (y - 330) / 182) * 22;
    const value = 192 + Math.random() * 34 + dust;
    image.data[i] = value;
    image.data[i + 1] = value - 2;
    image.data[i + 2] = value - 6;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const camoColors = ['rgba(54,61,57,.34)', 'rgba(102,105,91,.3)', 'rgba(139,134,111,.26)', 'rgba(55,64,68,.24)'];
  for (let i = 0; i < 24; i++) {
    const cx = Math.random() * 512;
    const cy = Math.random() * 512;
    const radius = 28 + Math.random() * 70;
    const sides = 5 + Math.floor(Math.random() * 4);
    ctx.fillStyle = camoColors[i % camoColors.length];
    ctx.beginPath();
    for (let j = 0; j < sides; j++) {
      const angle = j / sides * Math.PI * 2;
      const r = radius * (0.55 + Math.random() * 0.65);
      const x = cx + Math.cos(angle) * r * 1.5;
      const y = cy + Math.sin(angle) * r;
      if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(55,60,62,.42)';
  ctx.lineWidth = 2;
  for (const x of [64, 256, 448]) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke();
  }
  for (const y of [96, 384]) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
  }
  for (let i = 0; i < 145; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    ctx.strokeStyle = `rgba(245,245,232,${0.08 + Math.random() * 0.2})`;
    ctx.lineWidth = 0.5 + Math.random();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 4 + Math.random() * 38, y + (Math.random() - 0.5) * 4);
    ctx.stroke();
  }
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = `rgba(65,61,54,${0.08 + Math.random() * 0.18})`;
    ctx.beginPath();
    ctx.arc(Math.random() * 512, 300 + Math.random() * 212, 2 + Math.random() * 15, 0, Math.PI * 2);
    ctx.fill();
  }
  const color = new THREE.CanvasTexture(canvas);
  color.colorSpace = THREE.SRGBColorSpace;
  color.wrapS = color.wrapT = THREE.RepeatWrapping;
  color.repeat.set(1.7, 1.7);
  color.anisotropy = 4;
  const data = color.clone();
  data.colorSpace = THREE.NoColorSpace;
  return { color, data };
}

function materials(team: Team): ModelMaterials {
  const friendly = team === 'player';
  const surface = surfaceTextures();
  return {
    armor: new THREE.MeshStandardMaterial({ color: friendly ? 0xb5b4aa : 0x7d6c60, map: surface.color, bumpMap: surface.data, bumpScale: 0.022, roughnessMap: surface.data, roughness: 0.78, metalness: 0.62 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x292e30, bumpMap: surface.data, bumpScale: 0.014, roughness: 0.76, metalness: 0.72 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x697174, roughness: 0.4, metalness: 0.92 }),
    accent: new THREE.MeshStandardMaterial({ color: friendly ? 0x70c9cf : 0xc45d48, emissive: friendly ? 0x173b40 : 0x40130d, emissiveIntensity: 0.75, roughness: 0.5, metalness: 0.45 }),
    glass: new THREE.MeshStandardMaterial({ color: friendly ? 0x8ed8dc : 0xe47b61, emissive: friendly ? 0x24555b : 0x591b12, emissiveIntensity: 1.2, roughness: 0.18, metalness: 0.75 }),
    dust: new THREE.MeshStandardMaterial({ color: 0x777267, map: surface.color, bumpMap: surface.data, bumpScale: 0.035, roughness: 0.96, metalness: 0.08 }),
  };
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(x, y, z);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function box(parent: THREE.Object3D, material: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0, bevel = 0.035) {
  return mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(bevel, w * 0.15, h * 0.15, d * 0.15)), material, parent, x, y, z);
}

function slopedArmor(parent: THREE.Object3D, material: THREE.Material, topWidth: number, bottomWidth: number, height: number, topDepth: number, bottomDepth: number, x = 0, y = 0, z = 0) {
  const vertices = new Float32Array([
    -bottomWidth / 2, -height / 2, -bottomDepth / 2, bottomWidth / 2, -height / 2, -bottomDepth / 2,
    bottomWidth / 2, -height / 2, bottomDepth / 2, -bottomWidth / 2, -height / 2, bottomDepth / 2,
    -topWidth / 2, height / 2, -topDepth / 2, topWidth / 2, height / 2, -topDepth / 2,
    topWidth / 2, height / 2, topDepth / 2, -topWidth / 2, height / 2, topDepth / 2,
  ]);
  const indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 3, 2, 6, 3, 6, 7, 0, 4, 5, 0, 5, 1, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  const uv: number[] = [];
  for (let i = 0; i < 8; i++) uv.push((vertices[i * 3] / Math.max(topWidth, bottomWidth)) + 0.5, (vertices[i * 3 + 2] / Math.max(topDepth, bottomDepth)) + 0.5);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return mesh(geometry, material, parent, x, y, z);
}

function armoredLimb(parent: THREE.Object3D, material: THREE.Material, start: THREE.Vector3, end: THREE.Vector3, topWidth: number, bottomWidth: number, depth: number) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const object = slopedArmor(parent, material, topWidth, bottomWidth, length, depth * 0.85, depth);
  object.position.copy(start).add(end).multiplyScalar(0.5);
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return object;
}

function rodBetween(parent: THREE.Object3D, material: THREE.Material, start: THREE.Vector3, end: THREE.Vector3, radius: number) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const object = cylinder(parent, material, radius, length);
  object.position.copy(start).add(end).multiplyScalar(0.5);
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return object;
}

function cylinder(parent: THREE.Object3D, material: THREE.Material, radius: number, length: number, x = 0, y = 0, z = 0, segments = 10) {
  return mesh(new THREE.CylinderGeometry(radius, radius, length, segments), material, parent, x, y, z);
}

function sphere(parent: THREE.Object3D, material: THREE.Material, radius: number, x = 0, y = 0, z = 0) {
  return mesh(new THREE.SphereGeometry(radius, 16, 10), material, parent, x, y, z);
}

function barrel(parent: THREE.Object3D, material: THREE.Material, radius: number, length: number, x: number, y: number, z: number) {
  const object = cylinder(parent, material, radius, length, x, y, z, 12);
  object.rotation.x = Math.PI / 2;
  return object;
}

function bolt(parent: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number, radius = 0.035) {
  const object = cylinder(parent, material, radius, 0.028, x, y, z, 8);
  object.rotation.x = Math.PI / 2;
  return object;
}

function cable(parent: THREE.Object3D, material: THREE.Material, points: THREE.Vector3[], radius = 0.025) {
  const curve = new THREE.CatmullRomCurve3(points);
  return mesh(new THREE.TubeGeometry(curve, 12, radius, 6, false), material, parent, 0, 0, 0);
}

function vent(parent: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number, width: number, count = 4) {
  for (let i = 0; i < count; i++) box(parent, material, width, 0.035, 0.045, x, y + i * 0.075, z, 0.008);
}

function infantryDetails(group: THREE.Group, m: ModelMaterials) {
  box(group, m.armor, 0.48, 0.25, 0.07, 0, 1.19, 0.25, 0.018);
  for (const x of [-0.19, 0.19]) for (const y of [1.1, 1.28]) bolt(group, m.metal, x, y, 0.294, 0.024);
  box(group, m.dust, 0.22, 0.22, 0.17, -0.2, 0.85, 0.24);
  box(group, m.dust, 0.22, 0.22, 0.17, 0.2, 0.85, 0.24);
  box(group, m.dark, 0.07, 0.08, 0.38, 0, 1.96, -0.01, 0.015);
  cylinder(group, m.metal, 0.075, 0.08, 0.29, 1.74, -0.02).rotation.z = Math.PI / 2;
  sphere(group, m.glass, 0.048, 0.335, 1.74, 0.015);
  box(group, m.armor, 0.3, 0.16, 0.34, -0.48, 1.43, 0.03);
  box(group, m.armor, 0.3, 0.16, 0.34, 0.48, 1.43, 0.03);
  box(group, m.dark, 0.24, 0.16, 0.28, -0.48, 0.96, 0.21);
  box(group, m.dark, 0.24, 0.16, 0.28, 0.48, 0.96, 0.21);
  cable(group, m.dark, [new THREE.Vector3(0.24, 1.28, -0.41), new THREE.Vector3(0.54, 1.32, -0.28), new THREE.Vector3(0.57, 1.08, 0.13)], 0.028);
}

function infantry(kind: UnitKind, team: Team) {
  const m = materials(team);
  const group = new THREE.Group();
  const leftLeg = new THREE.Group();
  const rightLeg = new THREE.Group();
  leftLeg.position.set(-0.18, 0.76, 0);
  rightLeg.position.set(0.18, 0.76, 0);
  group.add(leftLeg, rightLeg);
  for (const leg of [leftLeg, rightLeg]) {
    box(leg, m.dark, 0.24, 0.68, 0.27, 0, -0.34, 0);
    box(leg, m.armor, 0.3, 0.3, 0.36, 0, -0.25, 0.035);
    box(leg, m.dark, 0.3, 0.18, 0.43, 0, -0.69, 0.07);
    box(leg, m.metal, 0.06, 0.34, 0.06, 0.13, -0.49, -0.05);
  }
  box(group, m.dark, 0.64, 0.7, 0.38, 0, 1.1, 0);
  const chest = box(group, m.armor, 0.73, 0.48, 0.43, 0, 1.2, 0.015);
  chest.rotation.x = -0.07;
  box(group, m.accent, 0.48, 0.06, 0.45, 0, 1.34, 0.02, 0.01);
  box(group, m.dark, 0.5, 0.58, 0.24, 0, 1.13, -0.29);
  box(group, m.metal, 0.13, 0.43, 0.12, -0.2, 1.12, -0.44);
  box(group, m.metal, 0.13, 0.43, 0.12, 0.2, 1.12, -0.44);
  sphere(group, m.armor, 0.3, 0, 1.72, 0);
  box(group, m.dark, 0.5, 0.2, 0.1, 0, 1.73, 0.245);
  box(group, m.glass, 0.43, 0.14, 0.08, 0, 1.73, 0.295, 0.025);
  box(group, m.dark, 0.36, 0.09, 0.28, 0, 1.92, -0.02);
  const leftArm = box(group, m.armor, 0.23, 0.62, 0.25, -0.48, 1.14, 0.1);
  const rightArm = box(group, m.armor, 0.23, 0.62, 0.25, 0.48, 1.14, 0.1);
  leftArm.rotation.x = rightArm.rotation.x = -0.45;
  box(group, m.accent, 0.12, 0.2, 0.28, -0.49, 1.37, 0.02, 0.015);
  infantryDetails(group, m);

  if (kind === 'shield') {
    const shield = box(group, m.armor, 1.08, 1.42, 0.14, -0.28, 0.98, 0.56, 0.07);
    shield.rotation.x = -0.08;
    box(group, m.dark, 0.82, 0.1, 0.17, -0.28, 1.16, 0.64);
    box(group, m.glass, 0.38, 0.12, 0.04, -0.28, 1.43, 0.65);
    box(group, m.accent, 0.09, 1.14, 0.04, -0.69, 0.98, 0.65, 0.01);
    for (const x of [-0.71, 0.15]) for (const y of [0.39, 1.56]) bolt(group, m.metal, x, y, 0.655, 0.042);
    const brace = box(group, m.dark, 0.08, 1.03, 0.06, -0.28, 0.96, 0.66);
    brace.rotation.z = 0.55;
    barrel(group, m.dark, 0.055, 0.75, 0.48, 1.04, 0.5);
  } else if (kind === 'electric') {
    const staff = cylinder(group, m.metal, 0.045, 1.75, 0.47, 1.03, 0.42);
    staff.rotation.x = -0.22;
    barrel(group, m.accent, 0.035, 0.42, 0.38, 1.86, 0.59);
    barrel(group, m.accent, 0.035, 0.42, 0.57, 1.86, 0.59);
    sphere(group, m.glass, 0.09, 0.47, 1.75, 0.55);
    for (let i = 0; i < 4; i++) mesh(new THREE.TorusGeometry(0.075, 0.015, 6, 12), m.accent, group, 0.47, 1.48 + i * 0.09, 0.53);
  } else if (kind === 'flame') {
    cylinder(group, m.dust, 0.18, 0.74, -0.21, 1.14, -0.46);
    cylinder(group, m.dust, 0.18, 0.74, 0.21, 1.14, -0.46);
    barrel(group, m.dark, 0.085, 1.1, 0.35, 1.13, 0.66);
    barrel(group, m.metal, 0.13, 0.24, 0.35, 1.13, 1.28);
    cable(group, m.dark, [new THREE.Vector3(0.2, 0.85, -0.5), new THREE.Vector3(0.64, 0.65, -0.1), new THREE.Vector3(0.48, 0.95, 0.58)], 0.045);
  } else if (kind === 'missile') {
    const launcher = new THREE.Group();
    group.add(launcher);
    const tube = barrel(launcher, m.dark, 0.17, 1.25, 0.37, 1.47, 0.15);
    tube.rotation.x = Math.PI / 2 - 0.15;
    barrel(launcher, m.accent, 0.19, 0.12, 0.37, 1.56, 0.79);
    barrel(launcher, m.metal, 0.19, 0.06, 0.37, 1.41, -0.38);
    group.userData.recoil = launcher;
    box(group, m.glass, 0.13, 0.19, 0.22, 0.19, 1.57, 0.22);
  } else {
    const length = kind === 'sniper' ? 1.75 : 1.08;
    box(group, m.dark, 0.15, 0.22, length * 0.6, 0.28, 1.18, 0.44);
    barrel(group, m.metal, kind === 'sniper' ? 0.047 : 0.055, length, 0.28, 1.23, 0.72 + length * 0.25);
    barrel(group, m.dark, 0.08, 0.26, 0.28, 1.23, 0.72 + length * 0.76);
    box(group, m.dark, 0.11, 0.3, 0.18, 0.28, 0.99, 0.48);
    box(group, m.glass, 0.09, 0.09, 0.24, 0.28, 1.39, 0.42);
    if (kind === 'sniper') {
      for (let i = 0; i < 4; i++) mesh(new THREE.TorusGeometry(0.095, 0.018, 6, 12), m.accent, group, 0.28, 1.23, 0.86 + i * 0.23);
      box(group, m.glass, 0.1, 0.12, 0.34, 0.28, 1.42, 0.46);
    }
  }
  group.userData = { leftLeg, rightLeg, muzzle: new THREE.Vector3(0.28, 1.25, 1.3), type: 'infantry', recoil: group.userData.recoil as THREE.Group | undefined };
  return group;
}

function vehicleDetails(group: THREE.Group, turret: THREE.Group, m: ModelMaterials, kind: 'drone' | 'tank' | 'artillery', width: number, length: number, trackHeight: number) {
  for (const side of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const z = -length * 0.43 + i * length * 0.86 / 7;
      box(group, m.metal, 0.43, 0.055, 0.2, side * width * 0.44, trackHeight * 0.98, z, 0.008);
      box(group, m.dark, 0.43, 0.045, 0.2, side * width * 0.44, 0.08, z, 0.008);
    }
    for (let i = 0; i < 3; i++) {
      const z = -length * 0.28 + i * length * 0.28;
      box(group, m.armor, 0.08, trackHeight * 0.55, length * 0.24, side * width * 0.51, trackHeight * 0.82, z, 0.018);
      bolt(group, m.metal, side * width * 0.515, trackHeight * 0.86, z + length * 0.08, 0.035);
    }
  }
  const glacis = box(group, m.armor, width * 0.7, 0.09, length * 0.28, 0, trackHeight + 0.69, length * 0.27, 0.02);
  glacis.rotation.x = -0.22;
  cylinder(turret, m.dark, 0.3, 0.09, 0.28, 0.49, -0.18, 16);
  cylinder(turret, m.metal, 0.19, 0.06, 0.28, 0.56, -0.18, 12);
  box(turret, m.glass, 0.12, 0.12, 0.24, -0.38, 0.44, 0.15);
  vent(turret, m.dark, 0, 0.12, -length * 0.225, width * 0.38, 4);
  for (const x of [-width * 0.22, width * 0.22]) for (const z of [-length * 0.13, length * 0.13]) bolt(turret, m.metal, x, 0.32, z, 0.04);
  if (kind === 'tank') {
    const recoil = (turret.userData.recoil as THREE.Group | undefined) ?? turret;
    for (let i = 0; i < 3; i++) barrel(recoil, m.armor, 0.125, 0.32, 0, 0.2, 1.25 + i * 0.48);
    box(recoil, m.dark, 0.32, 0.2, 0.14, 0, 0.2, 3.35);
    box(recoil, m.metal, 0.42, 0.05, 0.18, 0, 0.2, 3.43);
  }
}

function trackedVehicle(kind: 'drone' | 'tank' | 'artillery', team: Team) {
  const m = materials(team);
  const group = new THREE.Group();
  const large = kind !== 'drone';
  const width = kind === 'tank' ? 2.5 : kind === 'artillery' ? 2.25 : 1.65;
  const length = kind === 'tank' ? 3.8 : kind === 'artillery' ? 3.35 : 2.15;
  const trackHeight = large ? 0.62 : 0.42;
  for (const side of [-1, 1]) {
    box(group, m.dark, 0.38, trackHeight, length, side * width * 0.44, trackHeight * 0.58, 0, 0.1);
    const wheels = large ? 5 : 3;
    for (let i = 0; i < wheels; i++) {
      const wheel = cylinder(group, m.metal, large ? 0.25 : 0.16, 0.41, side * width * 0.44, trackHeight * 0.56, -length * 0.36 + i * length * 0.72 / (wheels - 1), 12);
      wheel.rotation.z = Math.PI / 2;
      const hub = cylinder(group, m.dark, large ? 0.1 : 0.065, 0.43, side * width * 0.44, trackHeight * 0.56, -length * 0.36 + i * length * 0.72 / (wheels - 1), 10);
      hub.rotation.z = Math.PI / 2;
    }
  }
  box(group, m.dust, width * 0.84, 0.45, length * 0.88, 0, trackHeight + 0.1, 0, 0.1);
  const hull = box(group, m.armor, width * 0.82, large ? 0.58 : 0.4, length * 0.68, 0, trackHeight + 0.42, 0.05, 0.09);
  hull.rotation.x = -0.035;
  box(group, m.accent, width * 0.58, 0.07, 0.06, 0, trackHeight + 0.55, length * 0.36, 0.01);
  const turret = new THREE.Group();
  turret.position.set(0, trackHeight + (large ? 0.85 : 0.68), 0);
  group.add(turret);
  if (kind === 'artillery') {
    box(turret, m.dark, 1.55, 0.32, 1.65, 0, 0.06, 0, 0.06);
    const launcher = new THREE.Group();
    turret.add(launcher);
    turret.userData.recoil = launcher;
    for (const x of [-0.55, -0.18, 0.18, 0.55]) {
      const tube = barrel(launcher, m.armor, 0.14, 2.2, x, 0.42, 0.25);
      tube.rotation.x = Math.PI / 2 - 0.25;
      barrel(launcher, m.dark, 0.155, 0.12, x, 0.69, 1.3);
      barrel(launcher, m.metal, 0.16, 0.07, x, 0.32, -0.35);
    }
    box(turret, m.glass, 0.3, 0.18, 0.22, -0.65, 0.35, -0.65);
  } else {
    box(turret, m.armor, width * 0.62, large ? 0.62 : 0.42, length * 0.42, 0, 0.12, 0.02, 0.09);
    box(turret, m.dark, 0.52, 0.16, 0.48, 0, 0.48, -0.2);
    box(turret, m.glass, 0.28, 0.12, 0.08, -0.32, 0.29, length * 0.22);
    const gunLength = kind === 'tank' ? 2.7 : 1.2;
    barrel(turret, m.dark, kind === 'tank' ? 0.1 : 0.055, gunLength, 0, 0.2, length * 0.22 + gunLength * 0.5);
    barrel(turret, m.metal, kind === 'tank' ? 0.14 : 0.075, 0.32, 0, 0.2, length * 0.22 + gunLength);
    if (kind === 'tank') {
      box(turret, m.accent, 0.1, 0.34, 0.65, -width * 0.32, 0.11, 0.04);
      barrel(turret, m.metal, 0.035, 0.9, 0.52, 0.5, 0.2);
    }
  }
  vehicleDetails(group, turret, m, kind, width, length, trackHeight);
  cylinder(group, m.metal, 0.025, 0.85, -width * 0.28, trackHeight + 1.05, -length * 0.22);
  sphere(group, m.accent, 0.055, -width * 0.28, trackHeight + 1.49, -length * 0.22);
  group.userData = { turret, muzzle: new THREE.Vector3(0, trackHeight + 1.05, length * 0.65 + (kind === 'tank' ? 1.5 : 0.5)), type: 'vehicle' };
  return group;
}

function quadTank(team: Team) {
  const m = materials(team);
  const group = new THREE.Group();
  const walkLegs: THREE.Group[] = [];
  box(group, m.dark, 1.55, 0.42, 1.65, 0, 1.16, 0, 0.08);
  slopedArmor(group, m.armor, 1.5, 2.05, 0.68, 1.7, 2.2, 0, 1.5, 0);
  box(group, m.accent, 1.15, 0.07, 0.06, 0, 1.65, 1.08, 0.01);
  vent(group, m.dark, 0, 1.35, -1.11, 0.9, 4);
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(sideX * 0.85, 1.35, sideZ * 0.78);
    group.add(leg);
    walkLegs.push(leg);
    sphere(leg, m.dark, 0.25, 0, 0, 0);
    const upper = slopedArmor(leg, m.armor, 0.42, 0.62, 0.88, 0.48, 0.68, sideX * 0.3, -0.34, sideZ * 0.18);
    upper.rotation.z = -sideX * 0.43;
    upper.rotation.x = sideZ * 0.16;
    sphere(leg, m.metal, 0.2, sideX * 0.58, -0.68, sideZ * 0.34);
    const lower = slopedArmor(leg, m.armor, 0.36, 0.58, 0.8, 0.42, 0.62, sideX * 0.68, -0.94, sideZ * 0.48);
    lower.rotation.z = sideX * 0.23;
    cylinder(leg, m.metal, 0.055, 0.72, sideX * 0.48, -0.72, sideZ * 0.08).rotation.z = -sideX * 0.35;
    box(leg, m.dark, 0.68, 0.26, 0.9, sideX * 0.77, -1.31, sideZ * 0.65, 0.06);
    box(leg, m.armor, 0.72, 0.18, 0.68, sideX * 0.77, -1.18, sideZ * 0.66, 0.04);
    for (const toe of [-0.2, 0, 0.2]) box(leg, m.metal, 0.16, 0.1, 0.38, sideX * 0.77 + toe, -1.42, sideZ * 0.65 + 0.42, 0.015);
    bolt(leg, m.metal, sideX * 0.63, -0.78, sideZ * 0.69, 0.05);
  }
  const turret = new THREE.Group();
  turret.position.set(0, 1.88, 0);
  group.add(turret);
  slopedArmor(turret, m.armor, 1.05, 1.55, 0.62, 1.35, 1.85, 0, 0.12, 0);
  box(turret, m.dark, 0.62, 0.18, 0.52, 0, 0.51, -0.25);
  cylinder(turret, m.metal, 0.23, 0.1, 0.23, 0.62, -0.24, 14);
  box(turret, m.glass, 0.28, 0.14, 0.08, -0.38, 0.27, 0.91);
  vent(turret, m.dark, 0, 0.05, -0.94, 0.72, 4);
  for (const x of [-0.52, 0.52]) for (const z of [-0.58, 0.58]) bolt(turret, m.metal, x, 0.28, z, 0.045);
  const gun = new THREE.Group();
  turret.add(gun);
  turret.userData.recoil = gun;
  barrel(gun, m.dark, 0.105, 4.35, 0, 0.2, 2.82);
  for (let i = 0; i < 4; i++) barrel(gun, m.armor, 0.135, 0.38, 0, 0.2, 1.12 + i * 0.66);
  barrel(gun, m.metal, 0.15, 0.36, 0, 0.2, 4.92);
  box(gun, m.dark, 0.34, 0.22, 0.18, 0, 0.2, 5.1);
  barrel(turret, m.metal, 0.035, 0.95, 0.48, 0.58, 0.15);
  cylinder(group, m.metal, 0.025, 1.25, -0.62, 2.8, -0.55);
  sphere(group, m.accent, 0.055, -0.62, 3.44, -0.55);
  group.userData = { turret, walkLegs, muzzle: new THREE.Vector3(0, 2.1, 5.1), type: 'quad' };
  return group;
}

function mech(team: Team) {
  const m = materials(team);
  const group = new THREE.Group();
  const leftLeg = new THREE.Group();
  const rightLeg = new THREE.Group();
  leftLeg.position.set(-0.56, 1.82, 0);
  rightLeg.position.set(0.56, 1.82, 0);
  group.add(leftLeg, rightLeg);
  for (const leg of [leftLeg, rightLeg]) {
    const hip = new THREE.Vector3(0, 0, 0);
    const knee = new THREE.Vector3(0, -0.68, 0.26);
    const hock = new THREE.Vector3(0, -1.24, -0.24);
    const ankle = new THREE.Vector3(0, -1.72, 0.12);
    armoredLimb(leg, m.armor, hip, knee, 0.38, 0.48, 0.42);
    armoredLimb(leg, m.armor, knee, hock, 0.3, 0.42, 0.34);
    armoredLimb(leg, m.dark, hock, ankle, 0.24, 0.34, 0.28);
    sphere(leg, m.dark, 0.17, knee.x, knee.y, knee.z);
    sphere(leg, m.metal, 0.13, hock.x, hock.y, hock.z);
    sphere(leg, m.dark, 0.1, ankle.x, ankle.y, ankle.z);
    cylinder(leg, m.metal, 0.09, 0.5, knee.x, knee.y, knee.z).rotation.z = Math.PI / 2;
    rodBetween(leg, m.metal, new THREE.Vector3(0.2, -0.06, -0.04), new THREE.Vector3(0.2, -0.64, 0.18), 0.035);
    rodBetween(leg, m.metal, new THREE.Vector3(-0.17, -0.74, 0.18), new THREE.Vector3(-0.17, -1.18, -0.18), 0.03);
    rodBetween(leg, m.metal, new THREE.Vector3(0.14, -1.28, -0.2), new THREE.Vector3(0.14, -1.67, 0.08), 0.025);
    box(leg, m.dark, 0.5, 0.2, 0.82, 0, -1.77, 0.34, 0.045);
    box(leg, m.armor, 0.46, 0.12, 0.5, 0, -1.68, 0.28, 0.025);
    box(leg, m.metal, 0.2, 0.09, 0.42, -0.13, -1.86, 0.69);
    box(leg, m.metal, 0.2, 0.09, 0.42, 0.13, -1.86, 0.69);
    box(leg, m.accent, 0.3, 0.05, 0.05, 0, -1.24, -0.04, 0.008);
  }
  box(group, m.dark, 0.82, 0.42, 0.66, 0, 1.87, 0);
  slopedArmor(group, m.armor, 0.98, 1.28, 0.68, 1.05, 1.5, 0, 2.48, 0);
  box(group, m.dark, 0.72, 0.34, 0.3, 0, 2.62, 0.69);
  box(group, m.glass, 0.5, 0.15, 0.07, 0, 2.68, 0.865);
  box(group, m.armor, 0.88, 0.22, 0.12, 0, 2.23, 0.76, 0.025);
  box(group, m.accent, 0.78, 0.06, 0.06, 0, 2.13, 0.79, 0.01);
  vent(group, m.dark, 0, 2.3, -0.77, 0.62, 4);
  for (const x of [-0.43, 0.43]) for (const y of [2.19, 2.77]) bolt(group, m.metal, x, y, 0.65, 0.04);
  for (const side of [-1, 1]) {
    slopedArmor(group, m.armor, 0.34, 0.46, 0.55, 0.48, 0.62, side * 0.79, 2.43, 0);
    barrel(group, m.dark, 0.1, 1.25, side * 0.79, 2.4, 0.92);
    barrel(group, m.metal, 0.13, 0.22, side * 0.79, 2.4, 1.59);
    cylinder(group, m.metal, 0.05, 0.7, side * 0.65, 1.89, -0.22).rotation.z = side * 0.25;
  }
  box(group, m.dark, 0.82, 0.62, 0.48, 0, 2.42, -0.98);
  cable(group, m.dark, [new THREE.Vector3(-0.32, 2.65, -1.15), new THREE.Vector3(-0.75, 2.55, -0.85), new THREE.Vector3(-0.82, 2.3, -0.15)], 0.04);
  cylinder(group, m.metal, 0.03, 1.05, 0.4, 3.3, -0.2);
  sphere(group, m.accent, 0.06, 0.4, 3.84, -0.2);
  group.userData = { leftLeg, rightLeg, walkLegs: [leftLeg, rightLeg], muzzle: new THREE.Vector3(0, 2.4, 1.65), type: 'mech' };
  return group;
}

export function createUnitModel(kind: UnitKind, team: Team) {
  const group = kind === 'mech' ? mech(team) : kind === 'tank' ? quadTank(team) : kind === 'drone' || kind === 'artillery' ? trackedVehicle(kind, team) : infantry(kind, team);
  group.userData.kind = kind;
  group.userData.team = team;
  return group;
}

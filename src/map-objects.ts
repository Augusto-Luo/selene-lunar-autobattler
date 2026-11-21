import * as THREE from 'three';
import type { LevelTerrain, MapObject } from './level';
import type { Vec2 } from './types';

/** Optional explicit dimensions are used only by generated native building proxies. */
export interface CollisionObject extends MapObject { width?: number; depth?: number }

export function terrainHeight(terrain: LevelTerrain, x: number, z: number) {
  let height = Math.sin(x * .31) * Math.cos(z * .27) * .045;
  for (const feature of terrain.features) {
    if (feature.kind === 'soft') continue;
    const d = Math.hypot(x - feature.x, z - feature.z) / feature.radius;
    if (d >= 1.35) continue;
    if (feature.kind === 'hill') height += feature.height * Math.max(0, 1 - d * d) ** 2;
    else height += feature.height * (-(Math.max(0, 1 - d * d) ** 2) + .3 * Math.exp(-(((d - .92) / .13) ** 2))) * Math.max(0, 1 - Math.max(0, d - 1) / .35);
  }
  return height;
}

function local(object: CollisionObject, point: Vec2) {
  const dx = point.x - object.x, dz = point.z - object.z;
  return { x: dx * Math.cos(object.heading) - dz * Math.sin(object.heading), z: dx * Math.sin(object.heading) + dz * Math.cos(object.heading) };
}
function dimensions(object: CollisionObject) { return { x: object.width === undefined ? object.radius : object.width / 2, z: object.depth === undefined ? object.kind === 'wall' ? .45 : object.radius * .65 : object.depth / 2 }; }
const round = (object: CollisionObject) => object.kind === 'rock' || object.kind === 'bunker' || object.kind === 'radar';

export function distanceToObject(object: CollisionObject, point: Vec2) {
  if (round(object)) return Math.hypot(point.x - object.x, point.z - object.z) - object.radius;
  const p = local(object, point), half = dimensions(object);
  const dx = Math.abs(p.x) - half.x, dz = Math.abs(p.z) - half.z;
  return Math.hypot(Math.max(0, dx), Math.max(0, dz)) + Math.min(0, Math.max(dx, dz));
}

export function constrainToObject(object: CollisionObject, point: Vec2, radius: number) {
  if (distanceToObject(object, point) >= radius) return;
  let p = local(object, point);
  if (round(object)) {
    const d = Math.hypot(p.x, p.z);
    p = { x: (d > .0001 ? p.x / d : 1) * (object.radius + radius), z: (d > .0001 ? p.z / d : 0) * (object.radius + radius) };
  } else {
    const half = dimensions(object);
    const nearest = { x: THREE.MathUtils.clamp(p.x, -half.x, half.x), z: THREE.MathUtils.clamp(p.z, -half.z, half.z) };
    const dx = p.x - nearest.x, dz = p.z - nearest.z, d = Math.hypot(dx, dz);
    if (d > .0001) p = { x: nearest.x + dx / d * radius, z: nearest.z + dz / d * radius };
    else if (half.x - Math.abs(p.x) < half.z - Math.abs(p.z)) p.x = (p.x < 0 ? -1 : 1) * (half.x + radius);
    else p.z = (p.z < 0 ? -1 : 1) * (half.z + radius);
  }
  point.x = object.x + p.x * Math.cos(object.heading) + p.z * Math.sin(object.heading);
  point.z = object.z - p.x * Math.sin(object.heading) + p.z * Math.cos(object.heading);
}

export function objectBlocksSegment(object: CollisionObject, a: Vec2, b: Vec2, padding = 0) {
  const from = local(object, a), to = local(object, b);
  if (round(object)) {
    const dx = to.x - from.x, dz = to.z - from.z;
    const t = THREE.MathUtils.clamp(-(from.x * dx + from.z * dz) / Math.max(.000001, dx * dx + dz * dz), 0, 1);
    return Math.hypot(from.x + dx * t, from.z + dz * t) <= object.radius + padding;
  }
  const half = dimensions(object);
  let enter = 0, exit = 1;
  for (const axis of ['x', 'z'] as const) {
    const extent = half[axis] + padding, direction = to[axis] - from[axis];
    if (Math.abs(direction) < .000001) { if (Math.abs(from[axis]) > extent) return false; }
    else {
      const t1 = (-extent - from[axis]) / direction, t2 = (extent - from[axis]) / direction;
      enter = Math.max(enter, Math.min(t1, t2)); exit = Math.min(exit, Math.max(t1, t2));
      if (enter > exit) return false;
    }
  }
  return true;
}

/** Exact swept circular footprint against rounded or rotated rectangular objects. */
export function objectBlocksMovement(object: CollisionObject, a: Vec2, b: Vec2, clearance: number) {
  if (objectBlocksSegment(object, a, b)) return true;
  const from = local(object, a), to = local(object, b);
  const distanceToSegment = (x: number, z: number) => {
    const dx = to.x - from.x, dz = to.z - from.z;
    const fraction = THREE.MathUtils.clamp(((x - from.x) * dx + (z - from.z) * dz) / Math.max(.000001, dx * dx + dz * dz), 0, 1);
    return Math.hypot(x - from.x - dx * fraction, z - from.z - dz * fraction);
  };
  if (round(object)) return distanceToSegment(0, 0) < object.radius + clearance;
  if (distanceToObject(object, a) < clearance || distanceToObject(object, b) < clearance) return true;
  const half = dimensions(object);
  return [-half.x, half.x].some(x => [-half.z, half.z].some(z => distanceToSegment(x, z) < clearance));
}

/** Prefab footprint and collision use the same dimensions and rotation. */
export function createMapObject(object: MapObject, y: number) {
  const group = new THREE.Group();
  group.userData.editorId = object.id;
  const metal = new THREE.MeshStandardMaterial({ color: 0x717978, roughness: .75, metalness: .55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x293338, roughness: .65, metalness: .6 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xb59653, roughness: .65, metalness: .4 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, py: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, py, z); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); return mesh;
  };
  const r = object.radius, h = object.height;
  if (object.kind === 'rock') {
    metal.color.setHex(0x68645c); metal.roughness = .96; metal.flatShading = true;
    const rock = add(new THREE.IcosahedronGeometry(1, 1), metal, 0, h * .43, 0); rock.scale.set(r, h * .58, r);
  } else if (object.kind === 'wall') {
    add(new THREE.BoxGeometry(r * 2, h, .9), metal, 0, h / 2, 0);
    add(new THREE.BoxGeometry(r * 2 + .08, .15, 1.05), accent, 0, h, 0);
    for (const x of [-r + .2, r - .2]) add(new THREE.BoxGeometry(.3, h + .2, 1.1), dark, x, h / 2, 0);
  } else if (object.kind === 'container') {
    add(new THREE.BoxGeometry(r * 2, h, r * 1.3), dark, 0, h / 2, 0);
    for (let i = 0; i < 7; i++) add(new THREE.BoxGeometry(.08, h, r * 1.3 + .04), metal, -r + .1 + (r * 2 - .2) * i / 6, h / 2, 0);
    add(new THREE.BoxGeometry(r * 1.9, .12, r * 1.3), metal, 0, h, 0);
    add(new THREE.BoxGeometry(r * .7, .15, .04), accent, 0, h * .7, r * .65 + .03);
  } else if (object.kind === 'bunker') {
    add(new THREE.CylinderGeometry(r * .85, r, h, 12), metal, 0, h / 2, 0);
    add(new THREE.CylinderGeometry(r * .92, r * .92, .22, 12), dark, 0, h, 0);
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      const slit = add(new THREE.BoxGeometry(r * .7, .15, .08), dark, Math.sin(angle) * r * .9, h * .7, Math.cos(angle) * r * .9); slit.rotation.y = angle;
    }
  } else {
    add(new THREE.CylinderGeometry(r * .9, r, h * .22, 12), metal, 0, h * .11, 0);
    add(new THREE.CylinderGeometry(.1, .18, h * .64, 8), dark, 0, h * .5, 0);
    const dish = add(new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, Math.PI * .45), metal, 0, h * .83, 0); dish.scale.y = .3; dish.rotation.x = -.7;
    add(new THREE.CylinderGeometry(.045, .06, h * .2, 8), accent, 0, h * .9, 0);
  }
  group.position.set(object.x, y, object.z); group.rotation.y = object.heading;
  return group;
}

import * as THREE from 'three';
import { WORLD } from './data';
import type { UnitSpec, Vec2 } from './types';
import type { MissionId } from './missions';
import type { LevelTerrain } from './level';
import { constrainToObject, createMapObject, distanceToObject, objectBlocksSegment, objectBlocksMovement, terrainHeight } from './map-objects';
import type { CollisionObject } from './map-objects';
import { buildBastionEnvironment } from './bastion';

export interface Rock {
  x: number;
  z: number;
  r: number;
  h: number;
  visual?: boolean;
  footprint?: CollisionObject;
}

interface HeapNode {
  index: number;
  score: number;
}

interface NavigationGrid {
  walkable: Uint8Array;
  checked: Uint8Array;
  edges: Uint8Array;
}
const NAV_DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

class MinHeap {
  private items: HeapNode[] = [];
  get size() { return this.items.length; }
  push(node: HeapNode) {
    this.items.push(node);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p].score <= node.score) break;
      this.items[i] = this.items[p];
      i = p;
    }
    this.items[i] = node;
  }
  pop() {
    const root = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (true) {
        const left = i * 2 + 1;
        if (left >= this.items.length) break;
        const right = left + 1;
        const child = right < this.items.length && this.items[right].score < this.items[left].score ? right : left;
        if (this.items[child].score >= last.score) break;
        this.items[i] = this.items[child];
        i = child;
      }
      this.items[i] = last;
    }
    return root;
  }
}

const random = (() => {
  let seed = 8128;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
})();

function makeRegolithTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(512, 512);
  for (let i = 0; i < image.data.length; i += 4) {
    const coarse = Math.sin((i / 4 % 512) * 0.055) * 4;
    const value = 112 + coarse + (random() - 0.5) * 34;
    image.data[i] = value * 1.02;
    image.data[i + 1] = value;
    image.data[i + 2] = value * 0.95;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  for (let i = 0; i < 620; i++) {
    const shade = 65 + random() * 70;
    ctx.fillStyle = `rgba(${shade},${shade},${shade * 0.94},${0.12 + random() * 0.22})`;
    ctx.beginPath();
    ctx.arc(random() * 512, random() * 512, 0.4 + random() * 2.1, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(10, 8);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeBaseSurfaceTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(512, 512);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = 83 + (random() - 0.5) * 24;
    image.data[i] = value * 0.94;
    image.data[i + 1] = value * 0.99;
    image.data[i + 2] = value * 1.04;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  ctx.strokeStyle = 'rgba(30,36,40,.72)';
  ctx.lineWidth = 3;
  for (const position of [0, 128, 256, 384, 512]) {
    ctx.beginPath(); ctx.moveTo(position, 0); ctx.lineTo(position, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, position); ctx.lineTo(512, position); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(150,160,162,.16)';
  ctx.lineWidth = 1;
  for (const position of [2, 130, 258, 386]) {
    ctx.beginPath(); ctx.moveTo(position, 0); ctx.lineTo(position, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, position); ctx.lineTo(512, position); ctx.stroke();
  }
  for (let i = 0; i < 110; i++) {
    const x = random() * 512;
    const y = random() * 512;
    ctx.strokeStyle = `rgba(185,190,188,${0.04 + random() * 0.09})`;
    ctx.lineWidth = 0.5 + random();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6 + random() * 30, y + (random() - 0.5) * 5); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(183,151,63,.5)';
  ctx.fillRect(20, 20, 46, 5);
  ctx.fillRect(400, 474, 74, 5);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(10, 8);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeAdaptiveGroundGeometry(heightAt: (x: number, z: number) => number) {
  const xs = [-800, -400, -200, -100, -60, -45];
  const zs = [-800, -400, -200, -100, -60, -35];
  for (let i = 1; i <= 180; i++) xs.push(-45 + i * 0.5);
  for (let i = 1; i <= 140; i++) zs.push(-35 + i * 0.5);
  xs.push(60, 100, 200, 400, 800);
  zs.push(60, 100, 200, 400, 800);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const z of zs) {
    for (const x of xs) {
      positions.push(x, heightAt(x, z), z);
      uvs.push(x / 70 + 0.5, z / 56 + 0.5);
    }
  }
  for (let row = 0; row < zs.length - 1; row++) {
    for (let col = 0; col < xs.length - 1; col++) {
      const a = row * xs.length + col;
      const b = a + 1;
      const c = a + xs.length;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

export class LunarTerrain {
  readonly group = new THREE.Group();
  readonly rocks: Rock[];
  readonly softZones: { x: number; z: number; r: number }[];
  readonly craterVisuals: { x: number; z: number; r: number }[];
  readonly fenceLines: { x1: number; x2: number; z: number }[];
  private readonly cell = 1.25;
  private readonly cols = Math.ceil((WORLD.maxX - WORLD.minX) / this.cell);
  private readonly rows = Math.ceil((WORLD.maxZ - WORLD.minZ) / this.cell);
  private navigationGrids = new Map<string, NavigationGrid>();

  constructor(readonly missionId: MissionId = 'tranquility', readonly definition?: LevelTerrain) {
    if (definition) {
      this.rocks = definition.objects.map(object => ({ x: object.x, z: object.z, r: object.radius, h: object.height, visual: false }));
      this.softZones = definition.features.filter(feature => feature.kind === 'soft').map(feature => ({ x: feature.x, z: feature.z, r: feature.radius }));
      this.craterVisuals = definition.features.filter(feature => feature.kind === 'crater').map(feature => ({ x: feature.x, z: feature.z, r: feature.radius }));
      this.fenceLines = [];
      this.createCustomGround();
      for (const object of definition.objects) this.group.add(createMapObject(object, this.heightAt(object.x, object.z)));
      return;
    }
    this.rocks = missionId === 'bastion' ? [
      { x: -22, z: 4, r: 1.8, h: 1.5 },
      { x: 22, z: 2, r: 1.6, h: 1.1 },
      { x: -18, z: -12, r: 1.5, h: 2.0 },
      { x: 18, z: -14, r: 1.4, h: 1.2 },
    ] : missionId === 'relay' ? [
      { x: -22, z: 6, r: 1.8, h: 1.6 },
      { x: 22, z: 5, r: 1.6, h: 1.1 },
      { x: -16, z: -12, r: 1.5, h: 2.0 },
      { x: 17, z: -14, r: 1.4, h: 1.2 },
      { x: -3, z: 8, r: 1.4, h: 1.0 },
      { x: 12, z: 10, r: 1.2, h: 1.1 },
    ] : missionId === 'craters' ? [
      { x: -3.6, z: 3.4, r: 1.5, h: 1.1 },
      { x: 11.2, z: -1.4, r: 1.4, h: 2.2, visual: false },
      { x: -18.4, z: 1.2, r: 1.5, h: 1.1 },
      { x: 19.2, z: -14.4, r: 1.6, h: 1.8 },
      { x: -24.2, z: 12.4, r: 1.5, h: 1.15 },
      { x: 23.2, z: 14.2, r: 1.7, h: 1.35 },
      { x: -2.2, z: -20.4, r: 1.3, h: 1.0 },
      { x: 0.4, z: 23.2, r: 1.1, h: 0.85 },
    ] : [
      { x: -3.6, z: 2.4, r: 1.7, h: 1.1 },
      { x: 10.8, z: 4.2, r: 1.9, h: 1.15 },
      { x: -15.8, z: 6.1, r: 1.35, h: 1.6 },
      { x: -8.2, z: -4.8, r: 1.4, h: 1.05 },
      { x: 14.7, z: -7.2, r: 2.1, h: 2.8 },
      { x: 16.4, z: 10.2, r: 1.45, h: 1.0 },
      { x: -18.7, z: -10.8, r: 1.6, h: 2.1 },
      // The outpost is unique to this open introductory map.
      { x: 20, z: -15.5, r: 2, h: 3, visual: false },
      { x: -25.2, z: 8.4, r: 1.5, h: 1.15 },
      { x: 24.4, z: 4.8, r: 1.8, h: 1.35 },
      { x: -23.4, z: -14.2, r: 1.7, h: 2.0 },
      { x: 22.2, z: -18.4, r: 1.3, h: 1.0 },
    ];
    this.softZones = missionId === 'bastion' ? [
      { x: -28, z: 8, r: 4.4 },
      { x: 28, z: 8, r: 4.8 },
      { x: 0, z: -15, r: 4.2 },
    ] : missionId === 'relay' ? [
      { x: -33, z: 2, r: 3.5 },
      { x: 32, z: -10, r: 3.5 },
    ] : missionId === 'craters' ? [
      { x: 3, z: -3, r: 10.5 },
      { x: -20, z: -11, r: 4.5 },
      { x: 22, z: -8, r: 4.2 },
      { x: -18, z: 15, r: 3.3 },
      { x: 22, z: 10, r: 4.1 },
    ] : [
      { x: 10.8, z: 8.3, r: 5.2 },
      { x: 12.8, z: -2.7, r: 5.8 },
      { x: -18.5, z: -1.4, r: 3.8 },
      { x: 20, z: -12.5, r: 4.8 },
    ];
    this.craterVisuals = missionId === 'bastion' ? [
      { x: -28, z: -11, r: 4.2 },
      { x: 28, z: -13, r: 3.4 },
    ] : missionId === 'relay' ? [] : missionId === 'craters' ? [
      { x: 3, z: -3, r: 13.5 },
      { x: -20, z: -11, r: 6 },
      { x: 22, z: -8, r: 5.5 },
      { x: -18, z: 15, r: 4 },
    ] : [{ x: 12.3, z: -1.8, r: 5.1 }, { x: -19, z: 12, r: 3.1 }];
    this.fenceLines = missionId === 'craters' ? [{ x1: -12, x2: -8, z: 10.5 }, { x1: -4, x2: 6, z: 10.5 }, { x1: 12, x2: 18, z: 10.5 }] : [];
    for (const line of this.fenceLines) {
      for (let x = line.x1; x <= line.x2 + 0.01; x += 1.4) this.rocks.push({ x, z: line.z, r: 0.42, h: 1.15, visual: false });
    }
    if (missionId === 'craters') this.rocks.push(
      { x: -8, z: -6, r: 1.25, h: 1.6, visual: false },
      { x: 32, z: 4, r: 1.5, h: 3.5, visual: false },
      { x: -32, z: 6, r: 2, h: 2.1, visual: false },
      { x: -27, z: 17, r: 1.2, h: 1.2, visual: false },
      { x: 25, z: 18, r: 1.2, h: 1.2, visual: false },
      { x: -31, z: -4, r: 1.6, h: 1.2, visual: false },
      { x: 27, z: -22, r: 1.8, h: 0.7, visual: false },
      { x: -2, z: 6, r: 0.8, h: 0.8, visual: false },
      { x: 6, z: 5, r: 0.8, h: 0.8, visual: false },
    );
    const geometry = makeAdaptiveGroundGeometry((x, z) => this.visualHeightAt(x, z));
    const positions = geometry.attributes.position;
    const colors: number[] = [];
    const color = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const y = positions.getY(i);
      positions.setY(i, y);
      const shade = THREE.MathUtils.clamp(0.49 + y * 0.018 + Math.sin(x * 1.7 + z * 0.9) * 0.014, 0.38, 0.62);
      if (this.missionId === 'relay') color.setRGB(shade * 0.82, shade * 0.88, shade * 0.94);
      else if (this.missionId === 'craters') color.setRGB(shade * (y < -.5 ? .78 : 1.06), shade * (y < -.5 ? .74 : .98), shade * (y < -.5 ? .76 : .86));
      else color.setRGB(shade * 1.03, shade, shade * 0.94);
      if (this.isSoft(x, z)) color.multiplyScalar(0.88);
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const texture = this.missionId === 'relay' ? makeBaseSurfaceTexture() : makeRegolithTexture();
    const ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      map: texture,
      bumpMap: texture,
      bumpScale: this.missionId === 'relay' ? 0.065 : 0.11,
      vertexColors: true,
      roughness: this.missionId === 'relay' ? 0.86 : 0.98,
      metalness: this.missionId === 'relay' ? 0.16 : 0.02,
    }));
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.group.add(ground);
    this.createRocks();
    this.createOutpostEnvironment();
    this.createCraters();
    this.createTrenchWorks();
    this.createFences();
    this.createBunkers();
    this.createIndustrialProps();
    this.createRelayEnvironment();
    this.createBaseInfrastructure();
    this.createOuterBase();
    this.createBastionEnvironment();
    this.group.userData.missionId = missionId;
  }

  visualHeightAt(x: number, z: number) {
    const distance = Math.max(Math.abs(x) - 45, Math.abs(z) - 35, 0);
    const blend = THREE.MathUtils.smoothstep(distance, 12, 110);
    const rolling = Math.sin(x * 0.018) * Math.cos(z * 0.016) * 4.2 + Math.sin(x * 0.041 + z * 0.025) * 1.5;
    return this.heightAt(x, z) + rolling * blend;
  }

  heightAt(x: number, z: number) {
    if (this.definition) return terrainHeight(this.definition, x, z);
    const base = Math.sin(x * 0.31) * Math.cos(z * 0.27) * 0.09 + Math.sin(x * 0.83 + z * 0.41) * 0.035;
    if (this.missionId === 'bastion') {
      // A level engineered terrace with broad approach ramps, not a Gaussian hill.
      // Every fortress wall, tower and courtyard tile shares this one height profile.
      const outside = Math.max(Math.abs(x) - 22, -z, z - 29, 0);
      const terrace = 1.6 * (1 - THREE.MathUtils.smoothstep(outside, 0, 4));
      let shell = 0;
      for (const crater of this.craterVisuals) {
        const d = Math.hypot(x - crater.x, z - crater.z);
        shell += -.55 * Math.exp(-(d ** 2) / 8) + .25 * Math.exp(-((d - crater.r) ** 2) / 1.1);
      }
      return terrace + (base + shell) * THREE.MathUtils.smoothstep(outside, 0, 1.5);
    }
    if (this.missionId === 'relay') {
      // A graded industrial slab: craters and regolith no longer continue under roads.
      const outside = Math.max(Math.abs(x) - 28, -27 - z, z - 26, 0);
      const slab = 1 - THREE.MathUtils.smoothstep(outside, 0, 5);
      return .45 * slab + base * (1 - slab);
    }
    if (this.missionId === 'craters') {
      let height = base + 0.55 * Math.exp(-(((x + 12) ** 2) / 60 + ((z - 1) ** 2) / 70));
      const craters = [
        { x: 3, z: -3, r: 13.5, depth: 2.2 },
        { x: -20, z: -11, r: 6, depth: 1.4 },
        { x: 22, z: -8, r: 5.5, depth: 1.2 },
        { x: -18, z: 15, r: 4, depth: 1.0 },
      ];
      for (const crater of craters) {
        const d = Math.hypot(x - crater.x, z - crater.z);
        const bowl = -crater.depth * Math.exp(-(d ** 2) / (crater.r * crater.r * 0.42));
        const rim = crater.depth * 0.68 * Math.exp(-((d - crater.r) ** 2) / (crater.r * 0.16));
        height += bowl + rim;
      }
      const trenches = [{ z: 2, bridges: [-6, 9] }, { z: -9, bridges: [-3, 11] }];
      for (const trench of trenches) {
        const distance = Math.abs(z - trench.z);
        const onBridge = trench.bridges.some(bridge => Math.abs(x - bridge) < 1.8);
        if (x > -12 && x < 17 && distance < 1.1 && !onBridge) height -= 1.65 * (1 - distance / 1.1);
      }
      return height;
    }
    const hill = 2.7 * Math.exp(-(((x + 11.7) ** 2) / 38 + ((z - 0.2) ** 2) / 48));
    const ridge = 1.25 * Math.exp(-(((x - 1.5) ** 2) / 150 + ((z + 3.5) ** 2) / 6));
    const craterDistance = Math.hypot(x - 12.3, z + 1.8);
    const crater = -1.05 * Math.exp(-(craterDistance ** 2) / 13) + 0.55 * Math.exp(-((craterDistance - 5.2) ** 2) / 1.4);
    const smallCraterDistance = Math.hypot(x + 19, z - 12);
    const smallCrater = -0.5 * Math.exp(-(smallCraterDistance ** 2) / 6) + 0.25 * Math.exp(-((smallCraterDistance - 3.2) ** 2) / 0.8);
    return base + hill + ridge + crater + smallCrater;
  }

  isSoft(x: number, z: number) {
    return this.softZones.some(zone => Math.hypot(x - zone.x, z - zone.z) < zone.r);
  }

  isHigh(x: number, z: number) {
    return this.heightAt(x, z) > 1.05;
  }

  movementMultiplier(spec: UnitSpec, x: number, z: number) {
    if (!this.isSoft(x, z)) return 1;
    if (spec.locomotion === 'tracked') return 0.88;
    if (spec.locomotion === 'quad') return 0.82;
    if (spec.locomotion === 'biped') return 0.62;
    return 0.78;
  }

  isWalkable(x: number, z: number, radius: number) {
    if (x < WORLD.minX + radius || x > WORLD.maxX - radius || z < WORLD.minZ + radius || z > WORLD.maxZ - radius) return false;
    if (this.definition) return !this.definition.objects.some(object => distanceToObject(object, { x, z }) < radius * .84 + .015);
    return !this.rocks.some(rock => (rock.footprint ? distanceToObject(rock.footprint, { x, z }) : Math.hypot(x - rock.x, z - rock.z) - rock.r) < radius * .84 + .015);
  }

  constrain(point: Vec2, radius: number) {
    point.x = THREE.MathUtils.clamp(point.x, WORLD.minX + radius, WORLD.maxX - radius);
    point.z = THREE.MathUtils.clamp(point.z, WORLD.minZ + radius, WORLD.maxZ - radius);
    if (this.definition) {
      for (const object of this.definition.objects) constrainToObject(object, point, radius * .84 + .02);
      point.x = THREE.MathUtils.clamp(point.x, WORLD.minX + radius, WORLD.maxX - radius);
      point.z = THREE.MathUtils.clamp(point.z, WORLD.minZ + radius, WORLD.maxZ - radius);
      return;
    }
    for (const rock of this.rocks) {
      if (rock.footprint) { constrainToObject(rock.footprint, point, radius * .84 + .02); continue; }
      const dx = point.x - rock.x;
      const dz = point.z - rock.z;
      const distance = Math.hypot(dx, dz);
      const minimum = rock.r + radius * .84 + .02;
      if (distance < minimum) {
        const nx = distance > 0.001 ? dx / distance : 1;
        const nz = distance > 0.001 ? dz / distance : 0;
        point.x = rock.x + nx * minimum;
        point.z = rock.z + nz * minimum;
      }
    }
  }

  hasLineOfSight(a: Vec2, b: Vec2) {
    if (this.definition?.objects.some(object => object.height >= 1.45 && objectBlocksSegment(object, a, b))) return false;
    for (const rock of this.definition ? [] : this.rocks) {
      if (rock.h < 1.45) continue;
      if (rock.footprint ? objectBlocksSegment(rock.footprint, a, b) : this.distanceToSegment(rock, a, b) < rock.r * 0.8) return false;
    }
    const ay = this.heightAt(a.x, a.z) + 1.35;
    const by = this.heightAt(b.x, b.z) + 1.15;
    for (let i = 1; i < 9; i++) {
      const t = i / 9;
      const x = THREE.MathUtils.lerp(a.x, b.x, t);
      const z = THREE.MathUtils.lerp(a.z, b.z, t);
      const lineY = THREE.MathUtils.lerp(ay, by, t);
      if (this.heightAt(x, z) > lineY + 0.15) return false;
    }
    return true;
  }

  coverReduction(target: Vec2, attacker: Vec2) {
    let reduction = 0;
    if (this.definition) return this.definition.objects.some(object => object.height <= 1.45 && distanceToObject(object, target) < 1.15 && objectBlocksSegment(object, attacker, target, .35)) ? .35 : 0;
    for (const rock of this.rocks) {
      if (rock.h > 1.45) continue;
      const targetDistance = Math.hypot(target.x - rock.x, target.z - rock.z);
      if (targetDistance > rock.r + 1.15) continue;
      if (this.distanceToSegment(rock, attacker, target) < rock.r + 0.35) {
        reduction = Math.max(reduction, 0.35);
      }
    }
    return reduction;
  }

  private distanceToSegment(point: Vec2, a: Vec2, b: Vec2) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq < 0.0001) return Math.hypot(point.x - a.x, point.z - a.z);
    const t = THREE.MathUtils.clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq, 0, 1);
    return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
  }

  private createCustomGround() {
    const geometry = makeAdaptiveGroundGeometry((x, z) => this.visualHeightAt(x, z));
    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), z = position.getZ(i);
      const shade = .51 + Math.min(4, position.getY(i)) * .022;
      color.setRGB(shade * 1.03, shade, shade * .94);
      if (this.isSoft(x, z)) color.setRGB(shade * .72, shade * .65, shade * .53);
      colors.set([color.r, color.g, color.b], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const texture = makeRegolithTexture();
    const ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: texture, bumpMap: texture, bumpScale: .08, vertexColors: true, roughness: .96, metalness: .02 }));
    ground.receiveShadow = true; ground.name = 'ground'; this.group.add(ground);
  }

  private isTrenchArea(x: number, z: number) {
    return this.missionId === 'craters' && x > -12 && x < 17 && (Math.abs(z - 2) < 1.1 || Math.abs(z + 9) < 1.1);
  }

  /** Validate the whole swept footprint, including thin walls between navigation cells. */
  canTraverse(a: Vec2, b: Vec2, radius: number, canCrossTrenches = false) {
    if (!this.isWalkable(a.x, a.z, radius) || !this.isWalkable(b.x, b.z, radius)) return false;
    const padding = radius * .84 + .015;
    if (this.definition) {
      if (this.definition.objects.some(object => objectBlocksMovement(object, a, b, padding))) return false;
    } else if (this.rocks.some(rock => rock.footprint ? objectBlocksMovement(rock.footprint, a, b, padding) : this.distanceToSegment(rock, a, b) < rock.r + padding)) return false;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const samples = Math.max(1, Math.ceil(length / .3));
    let previous = a, previousHeight = this.heightAt(a.x, a.z);
    for (let i = 1; i <= samples; i++) {
      const point = { x: a.x + (b.x - a.x) * i / samples, z: a.z + (b.z - a.z) * i / samples };
      const height = this.heightAt(point.x, point.z);
      const trench = this.isTrenchArea(point.x, point.z) || this.isTrenchArea(previous.x, previous.z);
      if (!canCrossTrenches && trench) {
        // Foot and tracked units use bridges or go around the ends of the trench.
        const bridges = Math.abs(point.z - 2) < 1.1 ? [-6, 9] : [-3, 11];
        if (this.isTrenchArea(point.x, point.z) && !bridges.some(x => Math.abs(point.x - x) < 1.8 - radius * .5)) return false;
      }
      if (!(canCrossTrenches && trench) && Math.abs(height - previousHeight) > length / samples * .82 + .025) return false;
      previous = point; previousHeight = height;
    }
    return true;
  }

  private navigationGrid(radius: number, canCrossTrenches: boolean): NavigationGrid {
    const key = `${radius}:${canCrossTrenches}`;
    let grid = this.navigationGrids.get(key);
    if (!grid) {
      const count = this.cols * this.rows;
      grid = { walkable: new Uint8Array(count), checked: new Uint8Array(count), edges: new Uint8Array(count) };
      for (let i = 0; i < count; i++) {
        const point = this.toWorld({ x: i % this.cols, z: Math.floor(i / this.cols) });
        grid.walkable[i] = this.isWalkable(point.x, point.z, radius) ? 1 : 0;
      }
      this.navigationGrids.set(key, grid);
    }
    return grid;
  }

  findPath(start: Vec2, end: Vec2, radius: number, canCrossTrenches = false): Vec2[] {
    const point = (value: Vec2) => ({ x: value.x, z: value.z });
    if (this.canTraverse(start, end, radius, canCrossTrenches)) return [point(end)];
    const grid = this.navigationGrid(radius, canCrossTrenches);
    const startCell = this.nearestWalkable(this.toCell(start), radius, start, canCrossTrenches);
    const endCell = this.nearestWalkable(this.toCell(end), radius);
    if (!startCell || !endCell) return [];
    const startIndex = startCell.x + startCell.z * this.cols;
    const endIndex = endCell.x + endCell.z * this.cols;
    const count = this.cols * this.rows;
    const costs = new Float32Array(count); costs.fill(Infinity);
    const cameFrom = new Int32Array(count); cameFrom.fill(-1);
    const closed = new Uint8Array(count), heap = new MinHeap();
    costs[startIndex] = 0; heap.push({ index: startIndex, score: 0 });
    let bestIndex = startIndex, bestDistance = Math.hypot(endCell.x - startCell.x, endCell.z - startCell.z);
    while (heap.size) {
      const current = heap.pop().index;
      if (closed[current]) continue;
      closed[current] = 1;
      const cx = current % this.cols, cz = Math.floor(current / this.cols);
      const remaining = Math.hypot(endCell.x - cx, endCell.z - cz);
      if (remaining < bestDistance) { bestIndex = current; bestDistance = remaining; }
      if (current === endIndex) { bestIndex = current; break; }
      const from = this.toWorld({ x: cx, z: cz });
      for (const [direction, [dx, dz]] of NAV_DIRECTIONS.entries()) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) continue;
        const next = nx + nz * this.cols, bit = 1 << direction;
        if (closed[next] || !grid.walkable[next]) continue;
        if (dx && dz && (!grid.walkable[cx + dx + cz * this.cols] || !grid.walkable[cx + (cz + dz) * this.cols])) continue;
        const to = this.toWorld({ x: nx, z: nz });
        if (!(grid.checked[current] & bit)) {
          grid.checked[current] |= bit;
          if (this.canTraverse(from, to, radius, canCrossTrenches)) grid.edges[current] |= bit;
        }
        if (!(grid.edges[current] & bit)) continue;
        const slope = Math.abs(this.heightAt(to.x, to.z) - this.heightAt(from.x, from.z));
        const nextCost = costs[current] + Math.hypot(dx, dz) * (this.isSoft(to.x, to.z) ? 1.35 : 1) + slope * .8;
        if (nextCost >= costs[next]) continue;
        costs[next] = nextCost; cameFrom[next] = current;
        heap.push({ index: next, score: nextCost + Math.hypot(endCell.x - nx, endCell.z - nz) });
      }
    }
    // Unreachable goals never fall back to a straight line through an obstacle.
    if (bestIndex === startIndex && startIndex !== endIndex) return [];
    const reversed: Vec2[] = [];
    let current = bestIndex;
    while (current !== -1) {
      reversed.push(this.toWorld({ x: current % this.cols, z: Math.floor(current / this.cols) }));
      if (current === startIndex) break;
      current = cameFrom[current];
    }
    const route = reversed.reverse();
    const last = route.at(-1)!;
    if (this.canTraverse(last, end, radius, canCrossTrenches)) route.push(point(end));
    // String pulling removes unnecessary cell turns, but every shortcut is swept too.
    const smooth: Vec2[] = [];
    let from = start, cursor = 0;
    while (cursor < route.length) {
      let furthest = cursor;
      for (let i = cursor; i < route.length; i++) if (this.canTraverse(from, route[i], radius, canCrossTrenches)) furthest = i;
      const next = route[furthest];
      if (!this.canTraverse(from, next, radius, canCrossTrenches)) break;
      if (Math.hypot(next.x - from.x, next.z - from.z) > .02) smooth.push(point(next));
      from = next; cursor = furthest + 1;
    }
    return smooth;
  }

  private toCell(point: Vec2) {
    return {
      x: THREE.MathUtils.clamp(Math.floor((point.x - WORLD.minX) / this.cell), 0, this.cols - 1),
      z: THREE.MathUtils.clamp(Math.floor((point.z - WORLD.minZ) / this.cell), 0, this.rows - 1),
    };
  }

  private toWorld(cell: { x: number; z: number }) {
    return { x: WORLD.minX + (cell.x + 0.5) * this.cell, z: WORLD.minZ + (cell.z + 0.5) * this.cell };
  }

  private nearestWalkable(cell: { x: number; z: number }, radius: number, from?: Vec2, canCrossTrenches = false) {
    for (let r = 0; r < 6; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const candidate = { x: cell.x + dx, z: cell.z + dz };
          if (candidate.x < 0 || candidate.z < 0 || candidate.x >= this.cols || candidate.z >= this.rows) continue;
          const world = this.toWorld(candidate);
          if (this.isWalkable(world.x, world.z, radius) && (!from || this.canTraverse(from, world, radius, canCrossTrenches))) return candidate;
        }
      }
    }
    return null;
  }

  private createRocks() {
    const material = new THREE.MeshStandardMaterial({ color: 0x65635d, roughness: 0.96, metalness: 0.02, flatShading: true });
    for (const rock of this.rocks) {
      if (rock.visual === false) continue;
      const geometry = new THREE.DodecahedronGeometry(1, 1);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.set(rock.r, rock.h, rock.r * 0.82);
      mesh.rotation.set(random() * 0.4, random() * Math.PI, random() * 0.25);
      mesh.position.set(rock.x, this.heightAt(rock.x, rock.z) + rock.h * 0.28, rock.z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    const pebbleGeometry = new THREE.DodecahedronGeometry(0.18, 0);
    const pebbles = new THREE.InstancedMesh(pebbleGeometry, material, 210);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 210; i++) {
      let x = 0, z = 0;
      do {
        x = WORLD.minX + random() * (WORLD.maxX - WORLD.minX);
        z = WORLD.minZ + random() * (WORLD.maxZ - WORLD.minZ);
      } while ((this.missionId === 'bastion' && Math.abs(x) < 21.5 && z > 1.5 && z < 28.5) || (this.missionId === 'relay' && Math.abs(x) < 27 && z > -26 && z < 25));
      const scale = 0.4 + random() * 2.2;
      matrix.compose(
        new THREE.Vector3(x, this.heightAt(x, z) + 0.04, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(random(), random() * Math.PI, random())),
        new THREE.Vector3(scale, scale * 0.65, scale),
      );
      pebbles.setMatrixAt(i, matrix);
    }
    pebbles.castShadow = pebbles.receiveShadow = true;
    this.group.add(pebbles);
  }

  private createOutpostEnvironment() {
    if (this.definition || this.missionId !== 'tranquility') return;
    const base = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x686d6d, roughness: 0.58, metalness: 0.75 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c262c, roughness: 0.42, metalness: 0.72 });
    const panel = new THREE.MeshStandardMaterial({ color: 0x263d4a, roughness: 0.3, metalness: 0.8 });
    const x = 20;
    const z = -15.5;
    const y = this.heightAt(x, z);
    const module = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 2.3, 12), metal);
    module.position.set(x, y + 1.15, z);
    module.castShadow = module.receiveShadow = true;
    base.add(module);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, 0.65, 12), dark);
    cap.position.set(x, y + 2.55, z);
    cap.castShadow = true;
    base.add(cap);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 6, 8), metal);
    mast.position.set(x, y + 5.4, z);
    mast.castShadow = true;
    base.add(mast);
    for (const side of [-1, 1]) {
      const solar = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.12, 2.5), panel);
      solar.position.set(x + side * 4.1, y + 1.1, z + 0.2);
      solar.rotation.z = side * 0.15;
      solar.castShadow = solar.receiveShadow = true;
      base.add(solar);
    }
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.1, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.35), metal);
    dish.scale.y = 0.35;
    dish.rotation.x = -0.8;
    dish.position.set(x, y + 7.9, z);
    base.add(dish);
    base.name = 'communications-outpost';
    this.group.add(base);
  }

  private createTrenchWorks() {
    if (this.missionId !== 'craters') return;
    const trenchMaterial = new THREE.MeshStandardMaterial({ color: 0x383632, roughness: 1 });
    const deckMaterial = new THREE.MeshStandardMaterial({ color: 0x555d60, roughness: 0.62, metalness: 0.72 });
    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x262d30, roughness: 0.7, metalness: 0.65 });
    for (const trench of [{ z: 2, bridges: [-6, 9] }, { z: -9, bridges: [-3, 11] }]) {
      const geometry = new THREE.PlaneGeometry(29, 2.2, 58, 4);
      geometry.rotateX(-Math.PI / 2);
      const positions = geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const worldX = positions.getX(i) + 2.5;
        const worldZ = positions.getZ(i) + trench.z;
        positions.setY(i, this.heightAt(worldX, worldZ) + 0.035);
      }
      geometry.computeVertexNormals();
      const bed = new THREE.Mesh(geometry, trenchMaterial);
      bed.position.set(2.5, 0, trench.z);
      bed.receiveShadow = true;
      this.group.add(bed);
      for (const bridgeX of trench.bridges) {
        const y = this.heightAt(bridgeX, trench.z);
        const deck = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.18, 3.1), deckMaterial);
        deck.position.set(bridgeX, y + 0.12, trench.z);
        deck.castShadow = deck.receiveShadow = true;
        this.group.add(deck);
        for (const side of [-1, 1]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 3.1), railMaterial);
          rail.position.set(bridgeX + side * 1.66, y + 0.34, trench.z);
          rail.castShadow = true;
          this.group.add(rail);
        }
        for (const end of [-1, 1]) {
          const beam = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.16, 0.16), railMaterial);
          beam.position.set(bridgeX, y - 0.02, trench.z + end * 1.34);
          this.group.add(beam);
        }
      }
    }
  }

  private createFences() {
    const material = new THREE.MeshStandardMaterial({ color: 0x42494b, roughness: 0.66, metalness: 0.72 });
    const warning = new THREE.MeshStandardMaterial({ color: 0xb39750, roughness: 0.68, metalness: 0.45 });
    for (const line of this.fenceLines) {
      for (let x = line.x1; x <= line.x2 + 0.01; x += 1.4) {
        const y = this.heightAt(x, line.z);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 1.15, 8), material);
        post.position.set(x, y + 0.575, line.z);
        post.castShadow = true;
        this.group.add(post);
        const marker = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.08), warning);
        marker.position.set(x, y + 0.91, line.z);
        this.group.add(marker);
        if (x + 1.4 <= line.x2 + 0.01) {
          for (const height of [0.42, 0.79]) {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.065, 0.065), material);
            rail.position.set(x + 0.7, this.heightAt(x + 0.7, line.z) + height, line.z);
            rail.castShadow = true;
            this.group.add(rail);
          }
        }
      }
    }
  }

  private createBunkers() {
    if (this.missionId !== 'craters') return;
    const armor = new THREE.MeshStandardMaterial({ color: 0x555c5e, roughness: 0.76, metalness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x20282b, roughness: 0.82, metalness: 0.4 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xb1954e, roughness: 0.72, metalness: 0.35 });
    for (const item of [{ x: -8, z: -6, w: 2.2, d: 1.4 }, { x: 11.2, z: -1.4, w: 2.1, d: 1.6 }]) {
      const y = this.heightAt(item.x, item.z);
      const base = new THREE.Mesh(new THREE.BoxGeometry(item.w, 0.65, item.d), armor);
      base.position.set(item.x, y + 0.32, item.z);
      base.castShadow = base.receiveShadow = true;
      this.group.add(base);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(item.w + 0.22, 0.16, item.d + 0.22), dark);
      roof.position.set(item.x, y + 0.72, item.z);
      roof.castShadow = true;
      this.group.add(roof);
      const slit = new THREE.Mesh(new THREE.BoxGeometry(item.w * 0.62, 0.12, 0.045), dark);
      slit.position.set(item.x, y + 0.49, item.z + item.d / 2 + 0.03);
      this.group.add(slit);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(item.w * 0.7, 0.08, 0.05), accent);
      stripe.position.set(item.x, y + 0.18, item.z + item.d / 2 + 0.035);
      this.group.add(stripe);
    }
  }

  private createIndustrialProps() {
    if (this.missionId !== 'craters') return;
    const metal = new THREE.MeshStandardMaterial({ color: 0x596265, roughness: 0.58, metalness: 0.75 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x252d30, roughness: 0.72, metalness: 0.65 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xb2934d, roughness: 0.62, metalness: 0.45 });
    const panel = new THREE.MeshStandardMaterial({ color: 0x263e4b, roughness: 0.32, metalness: 0.78 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xd59c45, emissive: 0x5b2f08, emissiveIntensity: 1.2, roughness: 0.4 });
    const scale = 1.28;
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, material = metal) => {
      const object = new THREE.Mesh(new THREE.BoxGeometry(w * scale, h * scale, d * scale), material);
      object.position.set(x, y, z);
      object.castShadow = object.receiveShadow = true;
      this.group.add(object);
      return object;
    };
    const cylinder = (radius: number, length: number, x: number, y: number, z: number, material = metal, axis: 'x' | 'y' | 'z' = 'y') => {
      const object = new THREE.Mesh(new THREE.CylinderGeometry(radius * scale, radius * scale, length * scale, 12), material);
      object.position.set(x, y, z);
      if (axis === 'x') object.rotation.z = Math.PI / 2;
      if (axis === 'z') object.rotation.x = Math.PI / 2;
      object.castShadow = object.receiveShadow = true;
      this.group.add(object);
      return object;
    };
    for (const [x, z] of [[-27, 17], [25, 18]]) {
      const y = this.heightAt(x, z);
      box(2.2, 1.1, 1.2, x, y + 0.55, z);
      for (let i = -3; i <= 3; i++) box(0.045, 1.14, 1.24, x + i * 0.3, y + 0.55, z, dark);
      for (const side of [-1, 1]) box(0.06, 0.9, 0.05, x + side * 0.45, y + 0.55, z + 0.63, accent);
      box(2.3, 0.12, 1.3, x, y + 1.16, z, dark);
    }
    for (let i = -1; i <= 1; i++) {
      const x = -32 + i * 1.65;
      const z = 6;
      const y = this.heightAt(x, z);
      cylinder(0.52, 1.8, x, y + 0.9, z);
      cylinder(0.56, 0.12, x, y + 1.35, z, accent);
      cylinder(0.22, 0.22, x, y + 1.91, z, dark);
      cylinder(0.08, 1.15, x, y + 0.35, z + 0.72, dark, 'x');
    }
    box(5.2, 0.16, 2.2, -32, this.heightAt(-32, 6) + 0.08, 6, dark);
    for (const zOffset of [-0.45, 0, 0.45]) {
      const y = this.heightAt(-31, -4 + zOffset);
      cylinder(0.1, 6.4, -31, y + 0.75 + zOffset * 0.35, -4 + zOffset, zOffset === 0 ? accent : metal, 'x');
      for (const x of [-34, -28]) box(0.12, 1.05, 0.12, x, this.heightAt(x, -4 + zOffset) + 0.52, -4 + zOffset, dark);
    }
    const rigY = this.heightAt(32, 4);
    box(3.4, 0.3, 3.4, 32, rigY + 0.15, 4, dark);
    for (const x of [31.2, 32.8]) for (const z of [3.2, 4.8]) cylinder(0.09, 5.4, x, rigY + 2.85, z);
    for (const y of [1.4, 3, 4.6]) {
      box(1.75, 0.09, 0.09, 32, rigY + y, 3.2);
      box(1.75, 0.09, 0.09, 32, rigY + y, 4.8);
      box(0.09, 0.09, 1.75, 31.2, rigY + y, 4);
      box(0.09, 0.09, 1.75, 32.8, rigY + y, 4);
    }
    box(2.1, 0.22, 2.1, 32, rigY + 5.55, 4, dark);
    cylinder(0.16, 6, 32, rigY + 2.95, 4, accent);
    cylinder(0.06, 1.8, 32.7, rigY + 6.45, 4, dark);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), glass);
    beacon.position.set(32.7, rigY + 7.38, 4);
    this.group.add(beacon);
    for (let i = -1; i <= 1; i++) {
      const x = 27 + i * 2.8;
      const z = -22;
      const y = this.heightAt(x, z);
      cylinder(0.055, 0.85, x, y + 0.42, z, dark);
      const solar = box(1.85, 0.09, 1.35, x, y + 0.86, z, panel);
      solar.rotation.x = -0.38;
      for (const offset of [-0.45, 0, 0.45]) box(0.025, 0.03, 1.36, x + offset, y + 0.92, z, metal);
    }
    for (const [x, z] of [[-2, 6], [6, 5]]) {
      const y = this.heightAt(x, z);
      box(1.15, 0.72, 0.9, x, y + 0.36, z);
      box(1.2, 0.09, 0.95, x, y + 0.76, z, accent);
      box(0.8, 0.52, 0.65, x + 0.75, y + 0.26, z + 0.35, dark);
    }
    for (const [x, z] of [[-25, 17], [23, 18]]) {
      const y = this.heightAt(x, z);
      cylinder(0.38, 0.52, x, y + 0.4, z, dark, 'z');
      cylinder(0.47, 0.08, x, y + 0.4, z - 0.3, metal, 'z');
      cylinder(0.47, 0.08, x, y + 0.4, z + 0.3, metal, 'z');
    }
  }

  private createBaseInfrastructure() {
    if (this.missionId !== 'relay') return;
    const asphalt = new THREE.MeshStandardMaterial({ color: 0x30383d, roughness: 0.9, metalness: 0.12 });
    const line = new THREE.MeshStandardMaterial({ color: 0xb4ad82, roughness: 0.72, metalness: 0.18 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x626c70, roughness: 0.58, metalness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x252e32, roughness: 0.76, metalness: 0.55 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xb79b4f, roughness: 0.66, metalness: 0.38 });
    const panel = new THREE.MeshStandardMaterial({ color: 0x294653, roughness: 0.34, metalness: 0.72 });
    const habMaterial = new THREE.MeshStandardMaterial({ color: 0xa5aaa6, roughness: 0.68, metalness: 0.5 });
    const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, material = metal) => {
      const object = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      object.position.set(x, y, z);
      object.castShadow = object.receiveShadow = true;
      this.group.add(object);
      return object;
    };
    const addCylinder = (radius: number, length: number, x: number, y: number, z: number, material = metal, axis: 'x' | 'y' | 'z' = 'y') => {
      const object = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), material);
      object.position.set(x, y, z);
      if (axis === 'x') object.rotation.z = Math.PI / 2;
      if (axis === 'z') object.rotation.x = Math.PI / 2;
      object.castShadow = object.receiveShadow = true;
      this.group.add(object);
      return object;
    };
    const groundPlane = (w: number, d: number, x: number, z: number, material: THREE.Material, offset = 0.05) => {
      const geometry = new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w)), Math.max(1, Math.round(d)));
      geometry.rotateX(-Math.PI / 2);
      const positions = geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const worldX = positions.getX(i) + x;
        const worldZ = positions.getZ(i) + z;
        positions.setY(i, this.heightAt(worldX, worldZ) + offset);
      }
      geometry.computeVertexNormals();
      const object = new THREE.Mesh(geometry, material);
      object.position.set(x, 0, z);
      object.receiveShadow = true;
      this.group.add(object);
    };

    const foundationMaterial = new THREE.MeshStandardMaterial({ color: 0x626d73, roughness: 0.88, metalness: 0.14 });
    groundPlane(40, 34, -1, -8, foundationMaterial, 0.045);
    // Loading aprons match the playable L-shaped deployment area.
    groundPlane(52, 8, -2, 22, foundationMaterial, 0.045);
    groundPlane(19, 9, -18.5, 13.5, foundationMaterial, 0.045);
    groundPlane(4.8, 52, -1, 0, asphalt, 0.055);
    for (let z = -24; z <= 24; z += 3.5) addBox(0.12, 0.025, 1.3, -1, this.heightAt(-1, z) + 0.085, z, line);
    for (const x of [-3.5, 1.5]) addBox(0.08, 0.02, 51, x, this.heightAt(x, 0) + 0.08, 0, accent);
    for (const x of [-22, -15, -8, 6, 13, 20]) addBox(.1, .025, 4.5, x, this.heightAt(x, 22) + .08, 22, line);
    groundPlane(0.55, 24, -8, -4, dark, 0.06);
    const pad = new THREE.Mesh(new THREE.RingGeometry(3.55, 3.82, 64), accent);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(-16, this.heightAt(-16, -18) + 0.075, -18);
    this.group.add(pad);
    for (const x of [-16.7, -15.3]) addBox(0.22, 0.03, 2.2, x, this.heightAt(x, -18) + 0.08, -18, line);
    addBox(1.4, 0.03, 0.22, -16, this.heightAt(-16, -18) + 0.085, -18, line);

    for (const [x, z] of [[-19, -2], [19, -4]]) {
      const y = this.heightAt(x, z);
      addBox(2.1, 0.25, 1.6, x, y + 0.12, z, dark);
      addBox(1.55, 1.05, 1.1, x, y + 0.77, z);
      for (let i = -3; i <= 3; i++) {
        addBox(0.08, 0.85, 0.12, x + i * 0.18, y + 0.77, z + 0.64, dark);
        addBox(0.08, 0.85, 0.12, x + i * 0.18, y + 0.77, z - 0.64, dark);
      }
      for (const offset of [-0.45, 0, 0.45]) {
        addCylinder(0.09, 0.48, x + offset, y + 1.53, z, dark);
        addCylinder(0.14, 0.08, x + offset, y + 1.77, z, accent);
      }
      addBox(0.7, 0.12, 0.05, x, y + 0.5, z + 0.58, accent);
      this.rocks.push({ x, z, r: 1.1, h: 1.4, visual: false });
    }

    const poleRows = [-24, 24];
    for (const x of poleRows) {
      const positions = [14, 4, -6, -16];
      for (let i = 0; i < positions.length; i++) {
        const z = positions[i];
        const y = this.heightAt(x, z);
        addCylinder(0.08, 3.6, x, y + 1.8, z, dark);
        addBox(1.4, 0.08, 0.08, x, y + 3.3, z);
        for (const side of [-0.5, 0.5]) addCylinder(0.1, 0.2, x + side, y + 3.46, z, accent);
        this.rocks.push({ x, z, r: 0.25, h: 2.5, visual: false });
        if (i < positions.length - 1) {
          const nextZ = positions[i + 1];
          const nextY = this.heightAt(x, nextZ);
          for (const side of [-0.5, 0.5]) {
            const curve = new THREE.CatmullRomCurve3([
              new THREE.Vector3(x + side, y + 3.5, z),
              new THREE.Vector3(x + side, (y + nextY) / 2 + 2.65, (z + nextZ) / 2),
              new THREE.Vector3(x + side, nextY + 3.5, nextZ),
            ]);
            const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.025, 5, false), dark);
            this.group.add(wire);
          }
        }
      }
    }
    for (const xOffset of [0, 0.38]) {
      const x = -14 + xOffset;
      const y = this.heightAt(x, -4);
      addCylinder(0.11, 24, x, y + 0.48, -4, xOffset === 0 ? accent : metal, 'z');
      for (let z = -16; z <= 8; z += 4) addBox(0.12, 0.55, 0.65, x, this.heightAt(x, z) + 0.27, z, dark);
    }
    for (const [x, z] of [[-23, -16], [-23, -6], [24, -2]]) {
      const y = this.heightAt(x, z);
      addBox(3.7, 0.22, 2.5, x, y + 0.12, z, dark);
      addCylinder(1.05, 3.4, x, y + 1.12, z, habMaterial, 'x');
      addBox(0.12, 1.25, 1.05, x + 1.73, y + 1.02, z, dark);
      for (const offset of [-0.75, 0.1, 0.85]) addBox(0.48, 0.32, 0.05, x + offset, y + 1.3, z + 1.04, panel);
      addBox(2.7, 0.1, 0.06, x, y + 0.65, z + 1.06, accent);
      this.rocks.push({ x, z, r: 1.65, h: 2, visual: false });
    }
  }

  private createOuterBase() {
    if (this.missionId !== 'relay') return;
    const concrete = new THREE.MeshStandardMaterial({ color: 0x687176, roughness: 0.78, metalness: 0.34 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x252e33, roughness: 0.76, metalness: 0.5 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xb89b50, roughness: 0.62, metalness: 0.4 });
    const windows = new THREE.MeshStandardMaterial({ color: 0x6093a4, emissive: 0x153c48, emissiveIntensity: 0.65, roughness: 0.35, metalness: 0.55 });
    const panel = new THREE.MeshStandardMaterial({ color: 0x294653, roughness: 0.34, metalness: 0.72 });
    const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, material = concrete) => {
      const object = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      object.position.set(x, y, z);
      this.group.add(object);
      return object;
    };
    const addCylinder = (radius: number, length: number, x: number, y: number, z: number, material = concrete, axis: 'x' | 'y' | 'z' = 'y') => {
      const object = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 14), material);
      object.position.set(x, y, z);
      if (axis === 'x') object.rotation.z = Math.PI / 2;
      if (axis === 'z') object.rotation.x = Math.PI / 2;
      this.group.add(object);
      return object;
    };
    const outerPlane = (w: number, d: number, x: number, z: number, material: THREE.Material) => {
      const geometry = new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(d / 2)));
      geometry.rotateX(-Math.PI / 2);
      const positions = geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const worldX = positions.getX(i) + x;
        const worldZ = positions.getZ(i) + z;
        positions.setY(i, this.visualHeightAt(worldX, worldZ) + 0.045);
      }
      geometry.computeVertexNormals();
      const object = new THREE.Mesh(geometry, material);
      object.position.set(x, 0, z);
      this.group.add(object);
    };
    const foundation = new THREE.MeshStandardMaterial({ color: 0x626d73, roughness: 0.88, metalness: 0.14 });
    const foundationPad = (x: number, z: number, width: number, depth: number) => {
      outerPlane(width, depth, x, z, foundation);
      for (const side of [-1, 1]) {
        addBox(0.12, 0.025, depth, x + side * width / 2, this.visualHeightAt(x + side * width / 2, z) + 0.07, z, accent);
        addBox(width, 0.025, 0.12, x, this.visualHeightAt(x, z + side * depth / 2) + 0.07, z + side * depth / 2, accent);
      }
      for (let px = x - width / 2 + 4; px < x + width / 2; px += 4) addBox(0.045, 0.02, depth, px, this.visualHeightAt(px, z) + 0.065, z, dark);
      for (let pz = z - depth / 2 + 4; pz < z + depth / 2; pz += 4) addBox(width, 0.02, 0.045, x, this.visualHeightAt(x, pz) + 0.065, pz, dark);
    };
    const road = (width: number, depth: number, x: number, z: number) => {
      outerPlane(width, depth, x, z, dark);
      if (width > depth) {
        for (let px = x - width / 2 + 2; px < x + width / 2; px += 4) addBox(1.5, 0.025, 0.12, px, this.visualHeightAt(px, z) + 0.075, z, accent);
      } else {
        for (let pz = z - depth / 2 + 2; pz < z + depth / 2; pz += 4) addBox(0.12, 0.025, 1.5, x, this.visualHeightAt(x, pz) + 0.075, pz, accent);
      }
    };
    const tower = (x: number, z: number, width: number, depth: number, floors: number) => {
      const ground = this.visualHeightAt(x, z);
      addBox(width + 1.4, 0.5, depth + 1.4, x, ground + 0.25, z, dark);
      for (let floor = 0; floor < floors; floor++) {
        const inset = floor * 0.12;
        const y = ground + 0.5 + floor * 1.35 + 0.675;
        addBox(width - inset, 1.28, depth - inset, x, y, z);
        addBox(width * 0.72, 0.22, 0.06, x, y + 0.2, z + (depth - inset) / 2 + 0.035, windows);
        addBox(width * 0.72, 0.22, 0.06, x, y + 0.2, z - (depth - inset) / 2 - 0.035, windows);
        if (floor % 2 === 0) addBox(width - inset + 0.12, 0.07, depth - inset + 0.12, x, y + 0.65, z, dark);
      }
      const roofY = ground + 0.5 + floors * 1.35;
      addBox(width * 0.72, 0.22, depth * 0.72, x, roofY, z, dark);
      addCylinder(0.08, 3.6, x, roofY + 1.9, z, accent);
      addBox(1.2, 0.08, 0.08, x, roofY + 3.3, z, accent);
    };
    const dome = (x: number, z: number, radius: number) => {
      const ground = this.visualHeightAt(x, z);
      addCylinder(radius, 1.1, x, ground + 0.55, z, dark);
      const shell = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), concrete);
      shell.scale.y = 0.48;
      shell.position.set(x, ground + 1.05, z);
      this.group.add(shell);
      addBox(radius * 0.85, radius * 0.55, 0.18, x, ground + radius * 0.3, z + radius * 0.87, dark);
      addBox(radius * 0.92, 0.14, 0.2, x, ground + radius * 0.63, z + radius * 0.87, accent);
    };
    foundationPad(46, -46, 12, 12);
    foundationPad(-48, -38, 14, 12);
    foundationPad(58, -58, 10, 12);
    foundationPad(-44, -26, 12, 12);
    foundationPad(-52, -30, 10, 10);
    foundationPad(-58, -52, 12, 12);
    road(5, 56, 4, -44);
    road(44, 4, 24, -42);
    road(4, 20, 48, -50);
    road(24, 4, -40, -30);
    road(4, 20, -54, -44);
    road(4, 12, -48, -28);
    road(14, 3, -43, 16);
    tower(46, -46, 5, 4, 7);
    tower(-48, -38, 6, 5, 5);
    tower(58, -58, 4, 4, 10);
    dome(-44, -26, 4);
    dome(-52, -30, 3.4);
    const spireY = this.visualHeightAt(-58, -52);
    addBox(4, 0.5, 4, -58, spireY + 0.25, -52, dark);
    addCylinder(0.22, 11, -58, spireY + 5.75, -52);
    const outerDish = new THREE.Mesh(new THREE.SphereGeometry(3.4, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.38), concrete);
    outerDish.scale.y = 0.34;
    outerDish.rotation.x = -0.65;
    outerDish.position.set(-58, spireY + 11.5, -52);
    this.group.add(outerDish);
    addBox(1.4, 0.3, 1.4, -58, spireY + 0.8, -52, accent);

    outerPlane(8, 76, 0, -62, dark);
    for (let z = -28; z >= -96; z -= 6) {
      addBox(0.18, 0.03, 2.3, 0, this.visualHeightAt(0, z) + 0.075, z, accent);
      for (const x of [-4.5, 4.5]) addBox(0.18, 0.12, 0.18, x, this.visualHeightAt(x, z) + 0.12, z, windows);
    }
    road(5, 48, -28, -42);
    for (const x of [30.7, 31.1]) {
      const y = this.visualHeightAt(x, -48);
      addCylinder(0.14, 46, x, y + 0.55, -48, x === 30.7 ? accent : concrete, 'z');
      for (let z = -28; z >= -68; z -= 8) addBox(0.18, 0.65, 0.65, x, this.visualHeightAt(x, z) + 0.32, z, dark);
    }
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        const x = -45 + col * 2.5;
        const z = 10 + row * 2;
        const y = this.visualHeightAt(x, z);
        addCylinder(0.045, 0.8, x, y + 0.4, z, dark);
        const solar = addBox(2.1, 0.08, 1.35, x, y + 0.85, z, panel);
        solar.rotation.x = -0.36;
      }
    }
    const roverY = this.visualHeightAt(-39, -24);
    addBox(1.8, 0.55, 2.6, -39, roverY + 0.65, -24, concrete);
    addBox(1.2, 0.55, 1.2, -39, roverY + 1.2, -24.3, windows);
    for (const x of [-39.8, -39.2]) for (const z of [-24.8, -23.2]) addCylinder(0.3, 0.18, x, roverY + 0.32, z, dark, 'x');
  }

  private createBastionEnvironment() {
    if (this.missionId !== 'bastion') return;
    const fortress = buildBastionEnvironment((x, z) => this.heightAt(x, z));
    this.group.add(fortress.group);
    this.rocks.push(...fortress.obstacles);
  }

  private createRelayEnvironment() {
    if (this.missionId !== 'relay') return;
    const concrete = new THREE.MeshStandardMaterial({ color: 0x676a67, roughness: 0.9, metalness: 0.16 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x586266, roughness: 0.58, metalness: 0.72 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x252d30, roughness: 0.74, metalness: 0.55 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xb3924d, roughness: 0.65, metalness: 0.4 });
    const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, material = concrete) => {
      const object = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      object.position.set(x, y, z);
      object.castShadow = object.receiveShadow = true;
      this.group.add(object);
    };
    const walls = [
      { x1: -20, x2: -13, z: 2 }, { x1: -7, x2: 5, z: 2 }, { x1: 12, x2: 22, z: 2 },
      { x1: -14, x2: -6, z: -9 }, { x1: 2, x2: 10, z: -9 }, { x1: 16, x2: 23, z: -9 },
    ];
    for (const wall of walls) {
      for (let x = wall.x1; x <= wall.x2 + 0.01; x += 1.35) {
        const y = this.heightAt(x, wall.z);
        const height = 0.8 + ((Math.round(x * 3) % 3 + 3) % 3) * 0.18;
        addBox(1.2, height, 0.5, x, y + height / 2, wall.z);
        addBox(1.24, 0.1, 0.54, x, y + height + 0.05, wall.z, dark);
        if (Math.round(x) % 4 === 0) addBox(0.35, 0.08, 0.54, x, y + 0.24, wall.z, accent);
        this.rocks.push({ x, z: wall.z, r: 0.62, h: 1.3, visual: false });
      }
    }
    for (const [x, z, w, d] of [[24, 10, 6.2, 5.2], [-26, -23, 6.8, 4.4]]) {
      const y = this.heightAt(x, z);
      addBox(w + .5, .25, d + .5, x, y + .125, z, dark);
      addBox(w, 2.3, d, x, y + 1.4, z, concrete);
      addBox(w + .35, .28, d + .35, x, y + 2.69, z, metal);
      addBox(w * .55, 1.7, .07, x, y + 1.1, z + d / 2 + .04, dark);
      addBox(w * .7, .18, .08, x, y + 2.25, z + d / 2 + .05, accent);
      for (const side of [-1, 1]) {
        addBox(.3, 2.35, d + .2, x + side * w * .4, y + 1.4, z, metal);
      }
      this.rocks.push({ x, z, r: Math.hypot(w, d) / 2, h: 2.8, visual: false,
        footprint: { id: `relay-service-${x}`, kind: 'container', x, z, radius: w / 2, height: 2.8, heading: 0, width: w + .5, depth: d + .5 } });
    }
    const stationY = this.heightAt(-1, -20);
    addBox(5.4, 0.35, 3.8, -1, stationY + 0.18, -20, dark);
    addBox(3.6, 1.7, 2.5, -1, stationY + 1.03, -20, metal);
    addBox(3.9, 0.18, 2.8, -1, stationY + 1.97, -20, dark);
    addBox(1.2, 0.22, 0.06, -1, stationY + 1.12, -18.72, accent);
    for (const x of [-2.1, 0.1]) addBox(0.55, 0.28, 0.06, x, stationY + 1.35, -18.71, dark);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.18, 5.2, 10), metal);
    mast.position.set(-1, stationY + 4.55, -20);
    mast.castShadow = true;
    this.group.add(mast);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.35, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.38), metal);
    dish.scale.y = 0.35;
    dish.rotation.x = -0.75;
    dish.position.set(-1, stationY + 7.1, -20);
    this.group.add(dish);
    this.rocks.push({ x: -1, z: -20, r: 2.5, h: 2.2, visual: false });
    for (const [x, z] of [[-9, -19], [10, -21]]) {
      const y = this.heightAt(x, z);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.85, 0.45, 12), dark);
      base.position.set(x, y + 0.22, z);
      base.castShadow = true;
      this.group.add(base);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 2.3, 8), metal);
      pole.position.set(x, y + 1.55, z);
      this.group.add(pole);
      const array = new THREE.Mesh(new THREE.SphereGeometry(0.85, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.38), metal);
      array.scale.y = 0.32;
      array.rotation.x = -0.65;
      array.position.set(x, y + 2.75, z);
      this.group.add(array);
      this.rocks.push({ x, z, r: 1.05, h: 1.6, visual: false });
    }
  }

  private createCraters() {
    const ringMaterial = new THREE.MeshStandardMaterial({ color: 0x56544f, roughness: 1, transparent: true, opacity: 0.34 });
    for (const crater of this.craterVisuals) {
      const geometry = new THREE.RingGeometry(crater.r * 0.88, crater.r * 1.1, 64);
      geometry.rotateX(-Math.PI / 2);
      const positions = geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const worldX = positions.getX(i) + crater.x;
        const worldZ = positions.getZ(i) + crater.z;
        positions.setY(i, this.heightAt(worldX, worldZ) + 0.08);
      }
      geometry.computeVertexNormals();
      const ring = new THREE.Mesh(geometry, ringMaterial);
      ring.position.set(crater.x, 0, crater.z);
      ring.receiveShadow = true;
      this.group.add(ring);
    }
  }
}

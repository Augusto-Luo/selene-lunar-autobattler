import * as THREE from 'three';
import type { DamageType, GameEvent, UnitKind } from './types';

interface Particle {
  active: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  r: number; g: number; b: number;
  gravity: number;
}

interface TransientMesh {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  grow: number;
  opacity: number;
  baseScale: THREE.Vector3;
  drift?: THREE.Vector3;
  spin?: THREE.Vector3;
}

type Point3 = { x: number; y: number; z: number };

export class EffectsSystem {
  readonly points: THREE.Points;
  trauma = 0;
  private particles: Particle[] = [];
  private transients: TransientMesh[] = [];
  private positions: Float32Array;
  private colors: Float32Array;
  private seed = 0x51e1e;

  constructor(private scene: THREE.Scene) {
    const max = 1600;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.positions.fill(9999);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(geometry, new THREE.PointsMaterial({
      size: 0.17, vertexColors: true, transparent: true, opacity: 0.92,
      depthWrite: false, sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < max; i++) this.particles.push({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, r: 1, g: 1, b: 1, gravity: 1.62 });
  }

  handle(event: GameEvent, reducedMotion: boolean) {
    if (event.type === 'shot') {
      this.weaponFire(event.kind, event.from, event.to, event.team, reducedMotion);
    } else if (event.type === 'flame') {
      this.flameCone(event.from, event.to);
      this.muzzleBlast(event.from, event.to, 0xffb84f, 0.55);
      const dx = event.to.x - event.from.x;
      const dz = event.to.z - event.from.z;
      const length = Math.max(0.1, Math.hypot(dx, dz));
      for (let i = 0; i < 22; i++) {
        const speed = 7 + this.random() * 6;
        this.spawn(event.from.x, event.from.y, event.from.z,
          dx / length * speed + (this.random() - 0.5) * 2.6,
          (this.random() - 0.2) * 1.8,
          dz / length * speed + (this.random() - 0.5) * 2.6,
          0.24 + this.random() * 0.3, this.random() > 0.45 ? 0xff9a32 : 0xffe09a, -0.2);
      }
    } else if (event.type === 'hit') {
      const color = this.damageColor(event.damageType);
      this.flash(event.x, event.y, event.z, event.heavy ? 0.24 : 0.12, 0xfff0c4, 0.065, 0.9);
      this.burst(event.x, event.y, event.z, event.heavy ? 16 : 6, color, event.heavy ? 4.6 : 2.5, 0.28);
      if (event.damageType === 'energy') this.impactArc(event.x, event.y, event.z);
      if (event.heavy) this.shockwave(event.x, event.y - 0.5, event.z, 0.22, color, 0.22, 2.4, 0.42);
    } else if (event.type === 'explosion') {
      this.explosion(event.x, event.y, event.z, event.heavy, reducedMotion);
    } else if (event.type === 'death') {
      const vehicle = event.kind === 'drone' || event.kind === 'tank' || event.kind === 'artillery';
      this.burst(event.x, event.y + 0.35, event.z, vehicle ? 26 : 14, 0x8d867a, vehicle ? 3.8 : 2.4, 1.2);
      this.burst(event.x, event.y + 0.45, event.z, vehicle ? 12 : 5, 0xff9a3c, 3.1, 0.45);
      if (vehicle) {
        this.flash(event.x, event.y + 0.5, event.z, 0.42, 0xff9b42, 0.16, 1.4);
        this.smokePuff(event.x, event.y + 0.65, event.z);
      }
    }
  }

  clear() {
    for (const particle of this.particles) particle.active = false;
    for (const item of this.transients) this.disposeTransient(item);
    this.transients = [];
    this.trauma = 0;
    this.positions.fill(9999);
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  rocketTrail(x: number, y: number, z: number) {
    this.spawn(x, y, z, (this.random() - 0.5) * 0.35, -0.55, (this.random() - 0.5) * 0.35, 0.42, 0xb8a58c, -0.1);
    if (this.random() > 0.42) this.spawn(x, y, z, 0, -0.35, 0, 0.15, 0xffc46a, 0);
    if (this.random() > 0.68) this.flash(x, y, z, 0.13 + this.random() * 0.08, 0xffb146, 0.07, 0.8);
    if (this.random() > 0.78) this.smoke(x, y, z, 0.16, 0x4a4642, 0.7, 1.8, 0.18);
  }

  smokePuff(x: number, y: number, z: number) {
    for (let i = 0; i < 2; i++) {
      this.smoke(x + (this.random() - 0.5) * 0.35, y + i * 0.18, z + (this.random() - 0.5) * 0.35,
        0.3 + this.random() * 0.18, i ? 0x424648 : 0x272d30, 2.4, 3.4, 0.3);
    }
    for (let i = 0; i < 4; i++) {
      this.spawn(x + (this.random() - 0.5) * 0.3, y, z + (this.random() - 0.5) * 0.3,
        (this.random() - 0.5) * 0.32, 0.35 + this.random() * 0.45, (this.random() - 0.5) * 0.32,
        1.4 + this.random() * 1.2, this.random() > 0.45 ? 0x3b4041 : 0x69665e, -0.12);
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      const index = i * 3;
      if (!particle.active) {
        this.positions[index] = 9999;
        continue;
      }
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.active = false;
        this.positions[index] = 9999;
        continue;
      }
      particle.vy -= particle.gravity * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.z += particle.vz * dt;
      particle.vx *= 1 - dt * 0.35;
      particle.vz *= 1 - dt * 0.35;
      const fade = Math.min(1, particle.life / Math.min(0.25, particle.maxLife));
      this.positions[index] = particle.x;
      this.positions[index + 1] = particle.y;
      this.positions[index + 2] = particle.z;
      this.colors[index] = particle.r * fade;
      this.colors[index + 1] = particle.g * fade;
      this.colors[index + 2] = particle.b * fade;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    for (const item of this.transients) {
      item.life -= dt;
      const t = 1 - Math.max(0, item.life) / item.maxLife;
      const material = item.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = (1 - t) ** 1.25 * item.opacity;
      if (item.grow) item.mesh.scale.copy(item.baseScale).multiplyScalar(1 + t * item.grow);
      if (item.drift) item.mesh.position.addScaledVector(item.drift, dt);
      if (item.spin) {
        item.mesh.rotation.x += item.spin.x * dt;
        item.mesh.rotation.y += item.spin.y * dt;
        item.mesh.rotation.z += item.spin.z * dt;
      }
    }
    for (const item of this.transients) if (item.life <= 0) this.disposeTransient(item);
    this.transients = this.transients.filter(item => item.life > 0);
    this.trauma = Math.max(0, this.trauma - dt * 1.35);
  }

  private weaponFire(kind: UnitKind, from: Point3, to: Point3, team: 'player' | 'enemy', reducedMotion: boolean) {
    const heavy = kind === 'tank' || kind === 'missile' || kind === 'mech';
    const sniper = kind === 'sniper';
    const artillery = kind === 'artillery';
    const friendly = team === 'player';
    const color = sniper ? 0x9eeeff : heavy ? 0xffc17a : friendly ? 0xf4cf83 : 0xff8068;
    if (kind === 'electric') {
      this.electricArc(from, to);
      this.flash(from.x, from.y, from.z, 0.24, 0x8deaff, 0.1, 1.2);
      this.muzzleBlast(from, to, 0x70dfff, 0.45);
      return;
    }
    if (!artillery) {
      this.beam(from, to, color, sniper ? 0.05 : heavy ? 0.065 : 0.022, sniper ? 0.26 : heavy ? 0.15 : 0.105);
      this.beam(from, to, sniper ? 0x367dff : 0xff7b37, sniper ? 0.1 : heavy ? 0.11 : 0.038, sniper ? 0.12 : 0.08, 0.42);
      if (sniper) this.railAfterimage(from, to);
    } else {
      const direction = this.direction(from, to);
      this.beam(from, { x: from.x + direction.x * 2.2, y: from.y + 2.1, z: from.z + direction.z * 2.2 }, 0xffb34d, 0.09, 0.16, 0.8);
      this.backblast(from, to);
    }
    this.muzzleBlast(from, to, sniper ? 0x8deaff : 0xffbd62, heavy || artillery ? 1.15 : sniper ? 0.75 : 0.5);
    this.burst(from.x, from.y, from.z, heavy || artillery ? 16 : 7, sniper ? 0x8deaff : 0xffc36b, heavy || artillery ? 4.2 : 2.2, 0.2);
    if ((heavy || artillery) && !reducedMotion) this.trauma = Math.min(1, this.trauma + (artillery ? 0.13 : 0.09));
  }

  private explosion(x: number, y: number, z: number, heavy: boolean, reducedMotion: boolean) {
    const scale = heavy ? 1.15 : 0.72;
    this.flash(x, y + 0.12, z, 0.62 * scale, 0xfff1c2, 0.075, 1.1);
    this.flash(x, y, z, 1.12 * scale, 0xffa33d, 0.24, 1.9);
    const fireColors = [0xffd27a, 0xff9a35, 0xd95732, 0xffb04a];
    const fireballs = heavy ? 5 : 3;
    for (let i = 0; i < fireballs; i++) {
      const angle = this.random() * Math.PI * 2;
      const distance = this.random() * 0.48 * scale;
      const size = (0.42 + this.random() * 0.45) * scale;
      this.fireball(x + Math.cos(angle) * distance, y + this.random() * 0.35, z + Math.sin(angle) * distance,
        size, fireColors[i % fireColors.length], 0.28 + this.random() * 0.2,
        new THREE.Vector3(Math.cos(angle) * 0.45, 0.8 + this.random() * 1.2, Math.sin(angle) * 0.45));
    }
    this.burst(x, y + 0.15, z, heavy ? 48 : 22, 0xffa33d, heavy ? 7.2 : 4.8, 0.62);
    this.burst(x, y + 0.2, z, heavy ? 30 : 14, 0x91877a, heavy ? 4.3 : 2.8, 1.35);
    this.shockwave(x, y - 0.55, z, 0.42 * scale, 0xffd08a, heavy ? 0.42 : 0.3, heavy ? 5.6 : 4.2, 0.72);
    this.shockwave(x, y - 0.53, z, 0.8 * scale, 0xa98a68, 0.72, 2.8, 0.25, false);
    this.scorch(x, y - 0.54, z, scale);
    const smokeCount = reducedMotion ? 2 : heavy ? 5 : 3;
    for (let i = 0; i < smokeCount; i++) {
      const angle = this.random() * Math.PI * 2;
      const radius = this.random() * 0.5 * scale;
      this.smoke(x + Math.cos(angle) * radius, y + 0.25 + this.random() * 0.35, z + Math.sin(angle) * radius,
        (0.36 + this.random() * 0.34) * scale, i % 2 ? 0x3b3c3d : 0x59534b,
        3.2 + this.random() * 2.2, 2.2 + this.random() * 1.2, 0.42,
        new THREE.Vector3(Math.cos(angle) * 0.22, 0.48 + this.random() * 0.4, Math.sin(angle) * 0.22));
    }
    if (!reducedMotion) this.trauma = Math.min(1, this.trauma + (heavy ? 0.28 : 0.11));
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: number, gravity = 1.62) {
    const particle = this.particles.find(item => !item.active);
    if (!particle) return;
    const c = new THREE.Color(color);
    Object.assign(particle, { active: true, x, y, z, vx, vy, vz, life, maxLife: life, r: c.r, g: c.g, b: c.b, gravity });
  }

  private burst(x: number, y: number, z: number, count: number, color: number, speed: number, life: number) {
    for (let i = 0; i < count; i++) {
      const angle = this.random() * Math.PI * 2;
      const horizontal = speed * (0.3 + this.random() * 0.7);
      this.spawn(x, y, z, Math.cos(angle) * horizontal, speed * (0.15 + this.random() * 0.75), Math.sin(angle) * horizontal, life * (0.55 + this.random() * 0.8), color);
    }
  }

  private beam(from: Point3, to: Point3, color: number, radius: number, life: number, opacity = 0.9) {
    const start = new THREE.Vector3(from.x, from.y, from.z);
    const end = new THREE.Vector3(to.x, to.y, to.z);
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length < 0.01) return;
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.45, length, 5), material);
    beam.position.copy(start).add(end).multiplyScalar(0.5);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    this.scene.add(beam);
    this.addTransient(beam, life, 0, opacity);
  }

  private muzzleBlast(from: Point3, to: Point3, color: number, scale: number) {
    const direction = this.direction(from, to);
    this.flash(from.x, from.y, from.z, 0.23 * scale, 0xfff3ce, 0.055, 0.65);
    this.flash(from.x, from.y, from.z, 0.42 * scale, color, 0.13, 1.6);
    const length = 1.25 * scale;
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const jet = new THREE.Mesh(new THREE.ConeGeometry(0.36 * scale, length, 8, 1, true), material);
    jet.position.set(from.x + direction.x * length * 0.45, from.y + direction.y * length * 0.45, from.z + direction.z * length * 0.45);
    jet.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction);
    this.scene.add(jet);
    this.addTransient(jet, 0.1, 0.8, 0.65);
  }

  private backblast(from: Point3, to: Point3) {
    const direction = this.direction(from, to);
    for (let i = 0; i < 3; i++) {
      this.smoke(from.x - direction.x * (0.35 + i * 0.25), from.y - 0.2, from.z - direction.z * (0.35 + i * 0.25),
        0.24 + i * 0.08, 0x71685a, 0.65 + i * 0.18, 2.4, 0.24,
        new THREE.Vector3(-direction.x * 0.8, 0.25, -direction.z * 0.8));
    }
  }

  private railAfterimage(from: Point3, to: Point3) {
    const direction = this.direction(from, to);
    for (let i = 1; i <= 4; i++) {
      const distance = i * 0.48;
      const material = new THREE.MeshBasicMaterial({ color: i % 2 ? 0x8deaff : 0x4d8fff, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.18, 16), material);
      ring.position.set(from.x + direction.x * distance, from.y + direction.y * distance, from.z + direction.z * distance);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
      this.scene.add(ring);
      this.addTransient(ring, 0.22 + i * 0.025, 1.6, 0.65);
    }
  }

  private electricArc(from: Point3, to: Point3) {
    let previous = { ...from };
    for (let i = 1; i <= 5; i++) {
      const t = i / 5;
      const next = {
        x: THREE.MathUtils.lerp(from.x, to.x, t) + (i < 5 ? (this.random() - 0.5) * 0.52 : 0),
        y: THREE.MathUtils.lerp(from.y, to.y, t) + (i < 5 ? (this.random() - 0.5) * 0.38 : 0),
        z: THREE.MathUtils.lerp(from.z, to.z, t) + (i < 5 ? (this.random() - 0.5) * 0.52 : 0),
      };
      this.beam(previous, next, i % 2 ? 0xa9f5ff : 0x55aaff, 0.03, 0.16, 0.95);
      previous = next;
    }
  }

  private impactArc(x: number, y: number, z: number) {
    for (let branch = 0; branch < 2; branch++) {
      const angle = this.random() * Math.PI * 2;
      this.electricArc({ x, y, z }, {
        x: x + Math.cos(angle) * (0.55 + this.random() * 0.35),
        y: y + 0.25 + this.random() * 0.45,
        z: z + Math.sin(angle) * (0.55 + this.random() * 0.35),
      });
    }
  }

  private flameCone(from: Point3, to: Point3) {
    const start = new THREE.Vector3(from.x, from.y, from.z);
    const direction = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
    const length = Math.min(5.4, direction.length());
    if (length < 0.1) return;
    const layers = [
      { radius: 1.55, length, color: 0xd9542c, opacity: 0.16, life: 0.18 },
      { radius: 1.0, length: length * 0.82, color: 0xff9a32, opacity: 0.28, life: 0.15 },
      { radius: 0.48, length: length * 0.58, color: 0xffe29a, opacity: 0.42, life: 0.12 },
    ];
    for (const layer of layers) {
      const material = new THREE.MeshBasicMaterial({ color: layer.color, transparent: true, opacity: layer.opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(layer.radius, layer.length, 14, 1, true), material);
      cone.position.copy(start).add(direction.clone().normalize().multiplyScalar(layer.length * 0.5));
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction.clone().normalize());
      this.scene.add(cone);
      this.addTransient(cone, layer.life, 0.18, layer.opacity);
    }
  }

  private shockwave(x: number, y: number, z: number, size: number, color: number, life: number, grow: number, opacity: number, additive = true) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(size, size + 0.1, 40), material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y, z);
    this.scene.add(ring);
    this.addTransient(ring, life, grow, opacity);
  }

  private scorch(x: number, y: number, z: number, scale: number) {
    const material = new THREE.MeshBasicMaterial({ color: 0x1d1b1c, transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide });
    const mark = new THREE.Mesh(new THREE.CircleGeometry(0.72 * scale, 18), material);
    mark.rotation.x = -Math.PI / 2;
    mark.rotation.z = this.random() * Math.PI;
    mark.position.set(x, y + 0.015, z);
    this.scene.add(mark);
    this.addTransient(mark, 12, 0.35, 0.34);
  }

  private flash(x: number, y: number, z: number, size: number, color: number, life: number, grow: number) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false });
    const flash = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 1), material);
    flash.position.set(x, y, z);
    this.scene.add(flash);
    this.addTransient(flash, life, grow, 0.92);
  }

  private fireball(x: number, y: number, z: number, size: number, color: number, life: number, drift: THREE.Vector3) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.78, blending: THREE.AdditiveBlending, depthWrite: false });
    const fireball = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 1), material);
    fireball.position.set(x, y, z);
    fireball.scale.set(1, 0.82, 1);
    this.scene.add(fireball);
    this.addTransient(fireball, life, 1.7, 0.78, drift, new THREE.Vector3(0.8, 1.2, 0.4));
  }

  private smoke(x: number, y: number, z: number, size: number, color: number, life: number, grow: number, opacity: number, drift = new THREE.Vector3(0, 0.45, 0)) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const cloud = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 1), material);
    cloud.position.set(x, y, z);
    this.scene.add(cloud);
    this.addTransient(cloud, life, grow, opacity, drift, new THREE.Vector3(0.15, 0.35, 0.1));
  }

  private addTransient(mesh: THREE.Mesh, life: number, grow: number, opacity: number, drift?: THREE.Vector3, spin?: THREE.Vector3) {
    this.transients.push({ mesh, life, maxLife: life, grow, opacity, baseScale: mesh.scale.clone(), drift, spin });
  }

  private disposeTransient(item: TransientMesh) {
    this.scene.remove(item.mesh);
    item.mesh.geometry.dispose();
    (item.mesh.material as THREE.Material).dispose();
  }

  private direction(from: Point3, to: Point3) {
    return new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z).normalize();
  }

  private damageColor(type: DamageType) {
    if (type === 'energy') return 0x8deaff;
    if (type === 'thermal') return 0xff8c38;
    if (type === 'explosive') return 0xffc16a;
    return 0xffc384;
  }

  private random() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
}

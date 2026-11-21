import { COMBAT_TUNING, UNIT_SPECS, WORLD, scaledRange } from './data';
import type { BattleStats, DamageType, Doctrine, GameEvent, Priority, Projectile, Team, Unit, UnitKind, Vec2 } from './types';
import type { MissionConfig } from './missions';
import { LunarTerrain } from './terrain';
import { canDeployAt } from './deployment';

const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const UNIT_GAP = 0.12;

export class BattleSimulation {
  units: Unit[] = [];
  projectiles: Projectile[] = [];
  events: GameEvent[] = [];
  stats: BattleStats = { time: 0, playerKills: 0, enemyKills: 0, damage: 0 };
  running = false;
  ended = false;
  victory = false;
  onEnd?: (victory: boolean) => void;
  private nextId = 1;
  private nextProjectileId = 1;
  waveIndex = 0;
  waveDelay = -1;

  constructor(readonly terrain: LunarTerrain, readonly mission: MissionConfig) {
    this.resetDeployment();
  }

  resetDeployment() {
    this.units = [];
    this.projectiles = [];
    this.events = [];
    this.stats = { time: 0, playerKills: 0, enemyKills: 0, damage: 0 };
    this.running = false;
    this.ended = false;
    this.victory = false;
    this.nextId = 1;
    this.nextProjectileId = 1;
    this.waveIndex = 0;
    this.waveDelay = -1;
    const enemyDeployment = this.mission.mode === 'defense' ? this.mission.waves?.[0] ?? this.mission.enemyDeployment : this.mission.enemyDeployment;
    for (const [team, deployment] of [['enemy', enemyDeployment], ['player', this.mission.playerDeployment]] as const) {
      for (const item of deployment) {
        const unit = this.addUnit(team, item.kind, item.x, item.z, item.doctrine, item.priority);
        if (item.heading !== undefined) unit.heading = item.heading;
      }
    }
  }

  clearPlayer() {
    this.units = this.units.filter(unit => unit.team === 'enemy');
  }

  addUnit(team: Team, kind: UnitKind, x: number, z: number, doctrine?: Doctrine, priority?: Priority) {
    const spec = UNIT_SPECS[kind];
    const defaultDoctrine: Doctrine = kind === 'sniper' || kind === 'artillery' || kind === 'missile' ? 'range' : 'advance';
    const unit: Unit = {
      id: this.nextId++, team, kind, x, z,
      heading: team === 'player' ? Math.PI : 0,
      hp: spec.hp, alive: true,
      doctrine: doctrine ?? defaultDoctrine,
      priority: priority ?? (kind === 'sniper' || kind === 'missile' ? 'threat' : 'nearest'),
      anchor: { x, z }, targetId: null, pendingTargetId: null,
      path: [], pathIndex: 0, pathGoal: null, blockedTime: 0, repath: 0, targetScan: Math.random() * 0.3,
      cooldown: Math.random() * spec.interval * 0.35, windup: 0, stun: 0,
      state: '待命', moving: false, kills: 0, damageDealt: 0, deathTime: 0,
      flankSign: this.nextId % 2 ? 1 : -1,
    };
    this.units.push(unit);
    return unit;
  }

  removeUnit(id: number) {
    const unit = this.units.find(item => item.id === id && item.team === 'player');
    if (unit) this.units = this.units.filter(item => item.id !== id);
  }

  canPlace(kind: UnitKind, x: number, z: number, ignoreId?: number) {
    const spec = UNIT_SPECS[kind];
    if (!canDeployAt(this.mission.id, x, z, spec.radius)) return false;
    if (!this.terrain.isWalkable(x, z, spec.radius)) return false;
    const samples = [[spec.radius, 0], [-spec.radius, 0], [0, spec.radius], [0, -spec.radius]] as const;
    const baseHeight = this.terrain.heightAt(x, z);
    if (samples.some(([dx, dz]) => Math.abs(this.terrain.heightAt(x + dx, z + dz) - baseHeight) > 0.9)) return false;
    return !this.units.some(unit => unit.alive && unit.id !== ignoreId && Math.hypot(x - unit.x, z - unit.z) < spec.radius + UNIT_SPECS[unit.kind].radius + 0.16);
  }

  findSpawnPosition(kind: UnitKind, preferred: Vec2): Vec2 | null {
    if (this.canPlace(kind, preferred.x, preferred.z)) return { x: preferred.x, z: preferred.z };
    for (let ring = 1; ring < 15; ring++) {
      for (let i = 0; i < 16; i++) {
        const angle = i / 16 * Math.PI * 2;
        const candidate = { x: preferred.x + Math.cos(angle) * ring * 0.75, z: preferred.z + Math.sin(angle) * ring * 0.75 };
        if (this.canPlace(kind, candidate.x, candidate.z)) return candidate;
      }
    }
    // A veteran may arrive far outside the next map's deployment shape. Search all legal
    // ground before putting that survivor in reserve; never charge for the relocation.
    let nearest: Vec2 | null = null, best = Infinity;
    for (let z = WORLD.minZ + 1; z < WORLD.maxZ; z += 1.5) for (let x = WORLD.minX + 1; x < WORLD.maxX; x += 1.5) {
      const distance = Math.hypot(x - preferred.x, z - preferred.z);
      if (distance < best && this.canPlace(kind, x, z)) { nearest = { x, z }; best = distance; }
    }
    return nearest;
  }

  start() {
    for (const unit of this.units) {
      unit.anchor = { x: unit.x, z: unit.z };
      unit.path = [];
      unit.pathGoal = null;
      unit.blockedTime = 0;
      unit.repath = 0;
      unit.targetId = null;
      unit.cooldown = Math.random() * UNIT_SPECS[unit.kind].interval * 0.3;
    }
    this.running = true;
    this.ended = false;
  }

  update(dt: number) {
    if (!this.running || this.ended) return;
    this.stats.time += dt;
    for (const unit of this.units) {
      if (!unit.alive) continue;
      this.updateUnit(unit, dt);
    }
    this.resolveUnitSpacing();
    this.updateProjectiles(dt);
    const playerAlive = this.units.some(unit => unit.team === 'player' && unit.alive);
    const enemyAlive = this.units.some(unit => unit.team === 'enemy' && unit.alive);
    if (this.mission.mode === 'defense' && !playerAlive) {
      this.running = false;
      this.ended = true;
      this.victory = false;
      this.onEnd?.(false);
      return;
    }
    if (this.mission.mode === 'defense' && !enemyAlive && this.waveIndex + 1 < (this.mission.waves?.length ?? 0)) {
      if (this.waveDelay < 0) {
        this.waveDelay = 5;
        this.events.push({ type: 'notice', text: `第 ${this.waveIndex + 2} 波增援将于 5 秒后抵达`, messageKey: '第 {wave} 波增援将于 5 秒后抵达', values: { wave: this.waveIndex + 2 } });
      }
      this.waveDelay -= dt;
      if (this.waveDelay <= 0) {
        this.waveIndex++;
        for (const item of this.mission.waves![this.waveIndex]) this.addUnit('enemy', item.kind, item.x, item.z, item.doctrine, item.priority);
        this.waveDelay = -1;
        this.events.push({ type: 'notice', text: `第 ${this.waveIndex + 1} 波围攻开始`, messageKey: '第 {wave} 波围攻开始', values: { wave: this.waveIndex + 1 } });
      }
      return;
    }
    if (!playerAlive || !enemyAlive || this.stats.time >= (this.mission.timeLimit ?? 180)) {
      this.running = false;
      this.ended = true;
      this.victory = !enemyAlive && playerAlive;
      this.onEnd?.(this.victory);
    }
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  private updateUnit(unit: Unit, dt: number) {
    const spec = UNIT_SPECS[unit.kind];
    unit.cooldown = Math.max(0, unit.cooldown - dt);
    unit.repath -= dt;
    unit.targetScan -= dt;
    unit.moving = false;
    if (unit.stun > 0) {
      unit.stun -= dt;
      unit.state = '电击硬直';
      return;
    }
    if (unit.windup > 0) {
      const pending = this.getUnit(unit.pendingTargetId);
      unit.windup -= dt;
      unit.state = unit.kind === 'sniper' ? '电磁蓄能' : '锁定目标';
      if (!pending) {
        unit.windup = 0;
        unit.pendingTargetId = null;
      } else {
        this.face(unit, pending, dt, 5);
        if (unit.windup <= 0) {
          this.fire(unit, pending);
          unit.cooldown = spec.interval;
          unit.pendingTargetId = null;
        }
      }
      return;
    }
    if (unit.targetScan <= 0 || !this.getUnit(unit.targetId)) {
      unit.targetId = this.chooseTarget(unit)?.id ?? null;
      unit.targetScan = 0.35 + Math.random() * 0.25;
    }
    // A rear-line priority must not make a shield walk through an enemy in reach.
    if (unit.kind === 'shield') {
      const contact = this.chooseTarget(unit, true);
      if (contact) unit.targetId = contact.id;
    }
    const target = this.getUnit(unit.targetId);
    if (!target) {
      unit.state = unit.doctrine === 'hold' ? '驻守阵地' : '搜索目标';
      if (unit.doctrine !== 'hold' && distance(unit, unit.anchor) > 1.5) this.moveToward(unit, unit.anchor, dt);
      return;
    }
    const dist = distance(unit, target);
    const range = this.effectiveRange(unit);
    const hasSight = this.hasFiringSolution(unit, target);
    const minimum = (spec.minRange ?? 0) * COMBAT_TUNING.range;

    if (unit.kind === 'shield' && dist <= this.shieldMeleeRange(target) && hasSight) {
      unit.state = '盾墙近战';
      unit.path.length = 0;
      unit.repath = 0;
      this.face(unit, target, dt, 2.4);
      if (unit.cooldown <= 0) {
        this.fire(unit, target);
        unit.cooldown = spec.interval;
      }
      return;
    }

    if (unit.doctrine === 'hold' && dist > range && distance(unit, unit.anchor) < 2.5) {
      unit.state = '驻守阵地';
      this.face(unit, target, dt, 3);
      return;
    }

    const repositionThreshold = minimum > 0 ? minimum + 0.8 : range * (unit.kind === 'sniper' ? 0.18 : 0.26);
    if (unit.doctrine === 'range' && dist < repositionThreshold) {
      const anchorDistance = distance(unit, unit.anchor);
      if (anchorDistance < 4.25) {
        const dx = unit.x - target.x;
        const dz = unit.z - target.z;
        const length = Math.max(0.01, Math.hypot(dx, dz));
        const destination = { x: unit.x + dx / length * 2.6, z: unit.z + dz / length * 2.6 };
        const fromAnchorX = destination.x - unit.anchor.x;
        const fromAnchorZ = destination.z - unit.anchor.z;
        const fromAnchorLength = Math.max(0.01, Math.hypot(fromAnchorX, fromAnchorZ));
        if (fromAnchorLength > 4.5) {
          destination.x = unit.anchor.x + fromAnchorX / fromAnchorLength * 4.5;
          destination.z = unit.anchor.z + fromAnchorZ / fromAnchorLength * 4.5;
        }
        this.terrain.constrain(destination, spec.radius);
        this.moveToward(unit, destination, dt);
        unit.state = '短距调整';
        return;
      }
      if (minimum > 0) {
        unit.state = '最小射程待命';
        this.face(unit, target, dt, 3);
        return;
      }
    }

    if (dist <= range && dist >= minimum && hasSight) {
      unit.state = unit.cooldown > 0 ? '火力压制' : '攻击';
      this.face(unit, target, dt, unit.kind === 'tank' ? 1.7 : 4);
      if (unit.cooldown <= 0) {
        if (spec.windup) {
          unit.windup = spec.windup;
          unit.pendingTargetId = target.id;
          unit.state = '锁定目标';
        } else {
          this.fire(unit, target);
          unit.cooldown = spec.interval;
        }
      }
      return;
    }

    if (unit.doctrine === 'hold' && distance(unit, unit.anchor) > 2.5 && dist > range) {
      this.moveToward(unit, unit.anchor, dt);
      unit.state = '返回阵地';
      return;
    }

    let destination: Vec2 = target;
    if (unit.doctrine === 'flank' && dist > range * 1.1) {
      destination = { x: target.x + unit.flankSign * 7, z: target.z + (unit.team === 'player' ? 3.5 : -3.5) };
      this.terrain.constrain(destination, spec.radius);
      unit.state = '侧翼迂回';
    } else {
      unit.state = hasSight ? '接敌推进' : '寻找射界';
    }
    this.moveToward(unit, destination, dt);
  }

  private chooseTarget(unit: Unit, meleeOnly = false) {
    let enemies = this.units.filter(other => other.alive && other.team !== unit.team);
    if (unit.kind === 'artillery') {
      const spotted = enemies.filter(enemy => this.isSpotted(unit, enemy));
      // Follow a search target when observers are lost; firing still needs vision.
      if (spotted.length) enemies = spotted;
    }
    let best: Unit | null = null;
    let bestScore = Infinity;
    for (const enemy of enemies) {
      const dist = distance(unit, enemy);
      if (meleeOnly && (dist > this.shieldMeleeRange(enemy) || !this.hasFiringSolution(unit, enemy))) continue;
      if (unit.doctrine === 'hold' && dist > UNIT_SPECS[unit.kind].vision * 1.3) continue;
      const spec = UNIT_SPECS[enemy.kind];
      let score = dist;
      if (unit.priority === 'threat') score -= spec.cost * 2.1 + spec.damage * 0.018;
      if (unit.priority === 'backline') score += (spec.range < 12 ? 9 : -7) + enemy.hp / spec.hp * 2;
      if (unit.priority === 'weak') score += enemy.hp / spec.hp * 13;
      if (score < bestScore) {
        best = enemy;
        bestScore = score;
      }
    }
    return best;
  }

  private shieldMeleeRange(target: Unit) {
    return scaledRange(UNIT_SPECS.shield) + UNIT_SPECS[target.kind].radius + 0.35;
  }

  private effectiveRange(unit: Unit) {
    const spec = UNIT_SPECS[unit.kind];
    return scaledRange(spec) * (this.terrain.isHigh(unit.x, unit.z) && spec.attack !== 'melee' && spec.attack !== 'cone' ? 1.15 : 1);
  }

  private hasFiringSolution(unit: Unit, target: Unit) {
    if (unit.kind === 'artillery') return this.isSpotted(unit, target);
    return this.terrain.hasLineOfSight(unit, target);
  }

  private isSpotted(unit: Unit, target: Unit) {
    return this.units.some(ally => {
      if (!ally.alive || ally.team !== unit.team) return false;
      const spec = UNIT_SPECS[ally.kind];
      const vision = spec.vision * (this.terrain.isHigh(ally.x, ally.z) ? 1.25 : 1);
      return distance(ally, target) <= vision && this.terrain.hasLineOfSight(ally, target);
    });
  }

  private face(unit: Unit, target: Vec2, dt: number, speed: number) {
    const desired = Math.atan2(target.x - unit.x, target.z - unit.z);
    let delta = desired - unit.heading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    unit.heading += THREEClamp(delta, -speed * dt, speed * dt);
  }

  private moveToward(unit: Unit, destination: Vec2, dt: number) {
    const spec = UNIT_SPECS[unit.kind];
    const canCrossTrenches = spec.locomotion === 'biped' || spec.locomotion === 'quad';
    if (unit.repath <= 0 || !unit.pathGoal || distance(unit.pathGoal, destination) > 2) {
      unit.path = this.terrain.findPath(unit, destination, spec.radius, canCrossTrenches);
      unit.pathIndex = 0;
      unit.pathGoal = { x: destination.x, z: destination.z };
      unit.repath = 0.7 + Math.random() * 0.35;
    }
    let waypoint = unit.path[unit.pathIndex];
    if (!waypoint) { unit.state = '路线受阻'; return; }
    // Skipping a near corner is safe only when the entire next segment is clear.
    while (distance(unit, waypoint) < .48 && unit.pathIndex < unit.path.length - 1 && this.terrain.canTraverse(unit, unit.path[unit.pathIndex + 1], spec.radius, canCrossTrenches)) {
      unit.pathIndex++;
      waypoint = unit.path[unit.pathIndex];
    }
    const dx = waypoint.x - unit.x;
    const dz = waypoint.z - unit.z;
    const length = Math.hypot(dx, dz);
    if (length < .00001) return;
    const speed = spec.speed * COMBAT_TUNING.speed * this.terrain.movementMultiplier(spec, unit.x, unit.z);
    const step = Math.min(length, speed * dt);
    const from = { x: unit.x, z: unit.z };
    const next = this.limitShieldMovement(unit, { x: unit.x + dx / length * step, z: unit.z + dz / length * step });
    unit.x = next.x;
    unit.z = next.z;
    this.face(unit, waypoint, dt, unit.kind === 'tank' || unit.kind === 'artillery' ? 2.2 : 5);
    unit.moving = distance(from, unit) > 0.00001;
    unit.blockedTime = distance(from, unit) < step * .15 ? unit.blockedTime + dt : 0;
    if (unit.blockedTime > .55) { unit.repath = 0; unit.blockedTime = 0; }
    if (!unit.moving && unit.kind === 'shield') unit.state = '等待通行';
  }

  private limitShieldMovement(unit: Unit, destination: Vec2, ignore?: Unit): Vec2 {
    const radius = UNIT_SPECS[unit.kind].radius;
    let position = { x: unit.x, z: unit.z };
    let remaining = { x: destination.x - unit.x, z: destination.z - unit.z };
    // Sweep before penetration: shield contacts stop/slide the mover instead of
    // feeding movement into the mass solver as a repeated push (including from behind).
    for (let slide = 0; slide < 3; slide++) {
      const next = { x: position.x + remaining.x, z: position.z + remaining.z };
      this.terrain.constrain(next, radius);
      const spec = UNIT_SPECS[unit.kind];
      const canCrossTrenches = spec.locomotion === 'biped' || spec.locomotion === 'quad';
      if (!this.terrain.canTraverse(position, next, radius, canCrossTrenches)) {
        // Clip an invalid movement step instead of teleporting through a thin obstacle.
        let low = 0, high = 1;
        for (let i = 0; i < 10; i++) {
          const fraction = (low + high) / 2;
          const point = { x: position.x + (next.x - position.x) * fraction, z: position.z + (next.z - position.z) * fraction };
          if (this.terrain.canTraverse(position, point, radius, canCrossTrenches)) low = fraction; else high = fraction;
        }
        next.x = position.x + (next.x - position.x) * low;
        next.z = position.z + (next.z - position.z) * low;
      }
      const dx = next.x - position.x;
      const dz = next.z - position.z;
      const lengthSq = dx * dx + dz * dz;
      if (lengthSq < 1e-12) break;
      let contact: Unit | null = null;
      let fraction = 1;
      for (const other of this.units) {
        if (!other.alive || other === unit || other === ignore || (unit.kind !== 'shield' && other.kind !== 'shield')) continue;
        const rx = position.x - other.x;
        const rz = position.z - other.z;
        const approach = rx * dx + rz * dz;
        if (approach >= 0) continue; // Moving away or tangentially must remain possible.
        const minimum = radius + UNIT_SPECS[other.kind].radius + UNIT_GAP + 0.0001;
        const separation = rx * rx + rz * rz - minimum * minimum;
        const discriminant = approach * approach - lengthSq * separation;
        if (discriminant < 0) continue;
        const hit = separation <= 0 ? 0 : (-approach - Math.sqrt(discriminant)) / lengthSq;
        if (hit < 0 || hit > fraction) continue;
        fraction = hit;
        contact = other;
      }
      if (!contact) return next;
      const travel = Math.max(0, fraction - 0.00001);
      position.x += dx * travel;
      position.z += dz * travel;
      const nx = position.x - contact.x;
      const nz = position.z - contact.z;
      const normalSq = nx * nx + nz * nz;
      if (normalSq < 1e-12) break; // Initial overlaps are repaired by the spacing pass.
      remaining = { x: dx * (1 - travel), z: dz * (1 - travel) };
      const inward = Math.min(0, (remaining.x * nx + remaining.z * nz) / normalSq);
      remaining.x -= nx * inward;
      remaining.z -= nz * inward;
    }
    return position;
  }

  private separateUnit(unit: Unit, other: Unit, nx: number, nz: number, amount: number) {
    if (amount <= 0.000001) return 0;
    const from = { x: unit.x, z: unit.z };
    const next = this.limitShieldMovement(unit, { x: unit.x + nx * amount, z: unit.z + nz * amount }, other);
    unit.x = next.x;
    unit.z = next.z;
    return Math.max(0, (next.x - from.x) * nx + (next.z - from.z) * nz);
  }

  private collisionMass(unit: Unit) {
    if (unit.kind === 'tank') return 8;
    if (unit.kind === 'mech') return 7;
    if (unit.kind === 'artillery') return 5.5;
    if (unit.kind === 'drone') return 2.8;
    if (unit.kind === 'shield') return 1.2;
    if (unit.kind === 'flame') return 1.35;
    return 1;
  }

  private resolveUnitSpacing() {
    const alive = this.units.filter(unit => unit.alive);
    for (let iteration = 0; iteration < 4; iteration++) {
      for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
          const a = alive[i];
          const b = alive[j];
          let dx = b.x - a.x;
          let dz = b.z - a.z;
          let dist = Math.hypot(dx, dz);
          const minimum = UNIT_SPECS[a.kind].radius + UNIT_SPECS[b.kind].radius + UNIT_GAP;
          if (dist >= minimum) continue;
          if (dist < 0.0001) {
            const angle = (a.id * 2.17 + b.id) % (Math.PI * 2);
            dx = Math.cos(angle);
            dz = Math.sin(angle);
            dist = 1;
          }
          const overlap = minimum - dist;
          const nx = dx / dist;
          const nz = dz / dist;
          const aMass = this.collisionMass(a);
          const bMass = this.collisionMass(b);
          const totalMass = aMass + bMass;
          const aShare = bMass / totalMass;
          const bShare = aMass / totalMass;
          const aMoved = this.separateUnit(a, b, -nx, -nz, overlap * aShare);
          const bMoved = this.separateUnit(b, a, nx, nz, overlap * bShare);
          // If a shield blocks a correction, return the unfulfilled separation
          // to the other unit rather than pushing the whole contact chain.
          const remaining = overlap - aMoved - bMoved;
          if (remaining > 0.000001) {
            const extra = this.separateUnit(a, b, -nx, -nz, remaining);
            this.separateUnit(b, a, nx, nz, remaining - extra);
          }
        }
      }
    }
  }

  private fire(unit: Unit, target: Unit) {
    const spec = UNIT_SPECS[unit.kind];
    if (!target.alive) return;
    const from = { x: unit.x, y: this.terrain.heightAt(unit.x, unit.z) + (unit.kind === 'mech' ? 2.4 : unit.kind === 'tank' || unit.kind === 'artillery' ? 1.5 : 1.2), z: unit.z };
    const to = { x: target.x, y: this.terrain.heightAt(target.x, target.z) + (UNIT_SPECS[target.kind].locomotion === 'foot' ? 0.9 : 0.65), z: target.z };
    if (spec.attack === 'cone') {
      this.events.push({ type: 'flame', kind: unit.kind, from, to, team: unit.team });
      const facing = Math.atan2(target.x - unit.x, target.z - unit.z);
      for (const enemy of this.units.filter(item => item.alive && item.team !== unit.team)) {
        const dist = distance(unit, enemy);
        if (dist > scaledRange(spec) + UNIT_SPECS[enemy.kind].radius) continue;
        const angle = Math.atan2(enemy.x - unit.x, enemy.z - unit.z);
        let delta = Math.abs(angle - facing);
        if (delta > Math.PI) delta = Math.PI * 2 - delta;
        if (delta < 0.58) this.dealDamage(unit, enemy, spec.damage, spec.damageType, false);
      }
      return;
    }
    this.events.push({ type: 'shot', kind: unit.kind, from, to, team: unit.team });
    if (spec.attack === 'rocket') {
      const duration = 1.15;
      this.projectiles.push({
        id: this.nextProjectileId++, team: unit.team, sourceId: unit.id, targetId: target.id,
        from, to, x: from.x, y: from.y, z: from.z, ttl: duration, duration,
        damage: spec.damage, aoe: spec.aoe ?? 0, damageType: spec.damageType,
      });
      return;
    }
    if (spec.aoe) {
      this.applyAreaDamage(unit, to, spec.aoe, spec.damage, spec.damageType);
      this.events.push({ type: 'explosion', x: to.x, y: to.y, z: to.z, heavy: unit.kind === 'tank' || unit.kind === 'missile' || unit.kind === 'mech' });
    } else {
      this.dealDamage(unit, target, spec.damage, spec.damageType, true);
      if (unit.kind === 'electric') target.stun = Math.max(target.stun, 0.32);
    }
  }

  private updateProjectiles(dt: number) {
    for (const projectile of this.projectiles) {
      projectile.ttl -= dt;
      const t = THREEClamp(1 - projectile.ttl / projectile.duration, 0, 1);
      projectile.x = projectile.from.x + (projectile.to.x - projectile.from.x) * t;
      projectile.z = projectile.from.z + (projectile.to.z - projectile.from.z) * t;
      projectile.y = projectile.from.y + (projectile.to.y - projectile.from.y) * t + Math.sin(t * Math.PI) * 8;
      if (projectile.ttl <= 0) {
        const source = this.getUnit(projectile.sourceId);
        if (source) this.applyAreaDamage(source, projectile.to, projectile.aoe, projectile.damage, projectile.damageType);
        this.events.push({ type: 'explosion', x: projectile.to.x, y: projectile.to.y, z: projectile.to.z, heavy: true });
      }
    }
    this.projectiles = this.projectiles.filter(projectile => projectile.ttl > 0);
  }

  private applyAreaDamage(source: Unit, center: Vec2, radius: number, damage: number, type: DamageType) {
    for (const target of this.units.filter(unit => unit.alive && unit.team !== source.team)) {
      const dist = distance(center, target);
      if (dist > radius + UNIT_SPECS[target.kind].radius) continue;
      const falloff = 1 - Math.min(0.55, dist / Math.max(radius, 0.1) * 0.55);
      this.dealDamage(source, target, damage * falloff, type, false);
    }
  }

  private dealDamage(source: Unit, target: Unit, rawDamage: number, type: DamageType, useCover: boolean) {
    const spec = UNIT_SPECS[target.kind];
    const armorScale = type === 'explosive' ? 0.55 : type === 'thermal' ? 0.45 : type === 'energy' ? 0.75 : 1;
    let reduction = spec.armor * armorScale;
    const dx = source.x - target.x;
    const dz = source.z - target.z;
    const length = Math.max(0.01, Math.hypot(dx, dz));
    const facingDot = Math.sin(target.heading) * dx / length + Math.cos(target.heading) * dz / length;
    if (facingDot > 0.25) reduction += spec.frontal * (type === 'explosive' ? 0.65 : 1);
    // Shaped charges counter heavy armor without increasing damage to infantry.
    if (source.kind === 'missile' && (target.kind === 'tank' || target.kind === 'mech')) reduction *= 0.5;
    if (useCover && type !== 'thermal') reduction += this.terrain.coverReduction(target, source);
    const damage = rawDamage * Math.max(0.22, 1 - Math.min(0.78, reduction));
    target.hp -= damage;
    source.damageDealt += damage;
    if (source.team === 'player') this.stats.damage += damage;
    this.events.push({ type: 'hit', x: target.x, y: this.terrain.heightAt(target.x, target.z) + 0.75, z: target.z, damageType: type, heavy: rawDamage > 80 });
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.deathTime = this.stats.time;
      target.moving = false;
      target.targetId = null;
      source.kills++;
      if (source.team === 'player') this.stats.playerKills++;
      else this.stats.enemyKills++;
      this.events.push({ type: 'death', x: target.x, y: this.terrain.heightAt(target.x, target.z), z: target.z, kind: target.kind, team: target.team });
    }
  }

  private getUnit(id: number | null) {
    if (id === null) return null;
    return this.units.find(unit => unit.id === id && unit.alive) ?? null;
  }
}

function THREEClamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

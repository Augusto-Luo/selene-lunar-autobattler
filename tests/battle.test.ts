import assert from 'node:assert/strict';
import { BattleSimulation } from '../src/battle';
import { UNIT_SPECS } from '../src/data';
import type { MissionConfig } from '../src/missions';
import type { LunarTerrain } from '../src/terrain';
import type { GameEvent, Team, Unit, Vec2 } from '../src/types';

// Isolate locomotion, contacts, target selection and damage from map geometry.
const terrain = {
  heightAt: () => 0, isHigh: () => false, hasLineOfSight: () => true,
  coverReduction: () => 0, movementMultiplier: () => 1, constrain() {},
  canTraverse: () => true,
  findPath: (_start: Vec2, end: Vec2) => [{ x: end.x, z: end.z }],
} as unknown as LunarTerrain;
const mission: MissionConfig = { id: 'custom', index: 'T', code: 'TEST', name: '盾兵接战回归', budget: 100, objective: '', success: '', timeLimit: 180, playerDeployment: [], enemyDeployment: [] };
const gap = (a: Unit, b: Unit) => UNIT_SPECS[a.kind].radius + UNIT_SPECS[b.kind].radius + .12;
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const assertAt = (unit: Unit, point: Vec2, label: string) => assert(distance(unit, point) < .0001, `${label}: displaced ${distance(unit, point).toFixed(4)} m`);
function start(sim: BattleSimulation) {
  sim.start();
  for (const unit of sim.units) { unit.hp = 1_000_000; unit.cooldown = 1_000_000; }
}
function advance(sim: BattleSimulation, seconds: number, observe?: () => void) {
  const events: GameEvent[] = [];
  for (let tick = 0; tick < Math.round(seconds * 30); tick++) {
    sim.update(1 / 30); events.push(...sim.drainEvents()); observe?.();
    assert(sim.units.every(unit => [unit.x, unit.z, unit.hp, unit.heading].every(Number.isFinite)));
  }
  return events;
}
let checks = 0;
function check(label: string, run: () => void) { run(); checks++; console.log(`PASS ${label}`); }

check('shields engage the enemy in front instead of pushing it toward a priority target', () => {
  for (const team of ['player', 'enemy'] as Team[]) for (const angle of [0, Math.PI / 4, Math.PI]) for (const reverse of [false, true]) {
    const other: Team = team === 'player' ? 'enemy' : 'player';
    const point = (z: number) => ({ x: Math.sin(angle) * z, z: Math.cos(angle) * z });
    const sim = new BattleSimulation(terrain, mission), from = point(6), behind = point(-6);
    const shield = sim.addUnit(team, 'shield', from.x, from.z, 'advance', 'threat');
    const front = sim.addUnit(other, 'rifle', 0, 0, 'hold');
    sim.addUnit(other, 'tank', behind.x, behind.z, 'hold');
    if (reverse) sim.units.reverse();
    start(sim); advance(sim, 10, () => assertAt(front, { x: 0, z: 0 }, 'stationary front line'));
    assert.equal(shield.state, '盾墙近战'); assert.equal(shield.targetId, front.id); assert.equal(shield.moving, false);
    assert(distance(shield, front) >= gap(shield, front) - .0001);
  }
});

check('an advancing shield cannot move a stationary ally out of the way', () => {
  for (const direction of [-1, 1]) for (const reverse of [false, true]) {
    const sim = new BattleSimulation(terrain, mission);
    const shield = sim.addUnit('player', 'shield', 0, direction * 6, 'advance');
    const ally = sim.addUnit('player', 'rifle', 0, direction * 3, 'hold');
    sim.addUnit('enemy', 'tank', 0, direction * -5, 'hold');
    if (reverse) sim.units.reverse();
    start(sim); advance(sim, 10, () => assertAt(ally, { x: 0, z: direction * 3 }, 'stationary ally'));
    assert(distance(shield, ally) >= gap(shield, ally) - .0001);
    assert.equal(shield.moving, false);
  }
});

check('pressure from behind does not translate into a shield pushing its opponent', () => {
  for (const reverse of [false, true]) {
    const sim = new BattleSimulation(terrain, mission);
    const shield = sim.addUnit('enemy', 'shield', 0, 0, 'advance');
    const front = sim.addUnit('player', 'rifle', 0, UNIT_SPECS.shield.radius + UNIT_SPECS.rifle.radius + .121, 'hold');
    const rear = sim.addUnit('enemy', 'electric', 0, -2, 'advance');
    const initialFront = { x: front.x, z: front.z };
    if (reverse) sim.units.reverse();
    start(sim); advance(sim, 10, () => {
      assertAt(shield, { x: 0, z: 0 }, 'engaged shield'); assertAt(front, initialFront, 'shield opponent');
      assert(distance(shield, rear) >= gap(shield, rear) - .0001);
    });
  }
});

check('crowd separation cannot transmit movement through an ally into a shield line', () => {
  for (const reverse of [false, true]) {
    const sim = new BattleSimulation(terrain, mission);
    const shield = sim.addUnit('enemy', 'shield', 0, 0, 'advance');
    const front = sim.addUnit('player', 'rifle', 0, 1.421, 'hold');
    sim.addUnit('enemy', 'rifle', 0, -1.421, 'hold');
    sim.addUnit('enemy', 'electric', 0, -4, 'advance');
    if (reverse) sim.units.reverse();
    start(sim); advance(sim, 10, () => {
      assertAt(shield, { x: 0, z: 0 }, 'shield under indirect crowd pressure');
      assertAt(front, { x: 0, z: 1.421 }, 'opponent under indirect crowd pressure');
    });
    for (let i = 0; i < sim.units.length; i++) for (let j = i + 1; j < sim.units.length; j++) assert(distance(sim.units[i], sim.units[j]) >= gap(sim.units[i], sim.units[j]) - .001);
  }
});

check('contact attacks deal limited damage on the existing melee cooldown', () => {
  const sim = new BattleSimulation(terrain, mission);
  const shield = sim.addUnit('player', 'shield', 0, 3, 'advance');
  const target = sim.addUnit('enemy', 'rifle', 0, 0, 'hold');
  start(sim); shield.cooldown = 0;
  const events = advance(sim, 5), shots = events.filter(event => event.type === 'shot' && event.kind === 'shield');
  assert(shots.length >= 4 && shots.length <= 5, `unexpected melee hit count: ${shots.length}`);
  assert(shield.damageDealt > 0 && shield.damageDealt <= UNIT_SPECS.shield.damage * 5);
  assert(Math.abs((1_000_000 - target.hp) - shield.damageDealt) < .000001);
  assertAt(target, { x: 0, z: 0 }, 'melee target');
  const contact = { x: shield.x, z: shield.z };
  advance(sim, 2); assertAt(shield, contact, 'shield after engagement');
});

check('shield contacts allow sliding around an ally without displacing it', () => {
  const sim = new BattleSimulation(terrain, mission);
  const shield = sim.addUnit('player', 'shield', -.8, 4, 'advance');
  const ally = sim.addUnit('player', 'rifle', 0, 0, 'hold');
  const target = sim.addUnit('enemy', 'tank', 0, -5, 'hold');
  start(sim); advance(sim, 8, () => {
    assertAt(ally, { x: 0, z: 0 }, 'ally beside a sliding shield');
    assert(distance(shield, ally) >= gap(shield, ally) - .0001);
  });
  assert.equal(shield.state, '盾墙近战'); assert.equal(shield.targetId, target.id);
  assert(shield.z < 0, 'shield should make progress around the ally');
});

check('units can retreat out of shield contact under their own range doctrine', () => {
  const sim = new BattleSimulation(terrain, mission);
  const shield = sim.addUnit('player', 'shield', 0, 0, 'hold');
  const sniper = sim.addUnit('enemy', 'sniper', 0, 2, 'range');
  start(sim); advance(sim, 2);
  assertAt(shield, { x: 0, z: 0 }, 'shield while its opponent withdraws');
  assert(sniper.z > 4, 'retreat should not be locked by shield contact');
});

check('a large movement step cannot tunnel through an allied shield', () => {
  const sim = new BattleSimulation({ ...terrain, movementMultiplier: () => 100 } as LunarTerrain, mission);
  const shield = sim.addUnit('player', 'shield', 0, 0, 'hold');
  const mover = sim.addUnit('player', 'electric', 0, -5, 'advance');
  sim.addUnit('enemy', 'rifle', 0, 5, 'hold');
  start(sim); advance(sim, 1 / 30);
  assertAt(shield, { x: 0, z: 0 }, 'shield struck by a large movement step');
  assert(mover.z < 0); assert(distance(mover, shield) >= gap(mover, shield) - .0001);
});

check('a shield does not hit through a blocked line of sight', () => {
  const sim = new BattleSimulation({ ...terrain, hasLineOfSight: () => false } as LunarTerrain, mission);
  const shield = sim.addUnit('player', 'shield', 0, 2, 'advance');
  sim.addUnit('enemy', 'rifle', 0, 0, 'hold');
  start(sim); shield.cooldown = 0;
  assert.equal(advance(sim, 3).filter(event => event.type === 'shot' && event.kind === 'shield').length, 0);
  assert.equal(shield.damageDealt, 0);
});

check('a shield can resume advancing after its engaged target dies', () => {
  const sim = new BattleSimulation(terrain, mission);
  const shield = sim.addUnit('player', 'shield', 0, 6, 'advance', 'threat');
  const front = sim.addUnit('enemy', 'rifle', 0, 0, 'hold');
  const back = sim.addUnit('enemy', 'tank', 0, -10, 'hold');
  start(sim); advance(sim, 3);
  assert.equal(shield.targetId, front.id);
  const contact = shield.z; front.alive = false; front.hp = 0;
  advance(sim, 1);
  assert.equal(shield.targetId, back.id); assert(shield.z < contact - 1); assert(shield.moving);
});

check('initial overlaps separate once without creating continuing shield movement', () => {
  const sim = new BattleSimulation(terrain, mission);
  const shield = sim.addUnit('player', 'shield', 0, 0, 'hold');
  const target = sim.addUnit('enemy', 'rifle', 0, 0, 'hold');
  start(sim); advance(sim, 1);
  assert(distance(shield, target) >= gap(shield, target) - .0001);
  const before = { shield: { x: shield.x, z: shield.z }, target: { x: target.x, z: target.z } };
  advance(sim, 3); assertAt(shield, before.shield, 'overlap shield'); assertAt(target, before.target, 'overlap target');
});

check('artillery searches after losing observers and only fires after acquiring vision', () => {
  const sim = new BattleSimulation(terrain, mission);
  const artillery = sim.addUnit('player', 'artillery', 0, 24, 'range');
  const target = sim.addUnit('enemy', 'shield', 0, -20, 'hold');
  start(sim); artillery.cooldown = 0;
  const opening = advance(sim, 3);
  assert.equal(artillery.targetId, target.id);
  assert(artillery.z < 20, 'a surviving artillery unit must search instead of waiting forever');
  assert(!opening.some(event => event.type === 'shot' && event.kind === 'artillery'));
  const later = advance(sim, 15);
  assert(later.some(event => event.type === 'shot' && event.kind === 'artillery'));
  assert(distance(artillery, target) <= UNIT_SPECS.artillery.vision + .1);
});

check('artillery prefers observed targets over unseen targets with higher threat', () => {
  const sim = new BattleSimulation(terrain, mission);
  const artillery = sim.addUnit('player', 'artillery', 0, 0, 'range', 'threat');
  const visible = sim.addUnit('enemy', 'rifle', 0, -16, 'hold');
  sim.addUnit('enemy', 'tank', 0, -30, 'hold');
  start(sim); advance(sim, 1 / 30);
  assert.equal(artillery.targetId, visible.id);
});

check('artillery search cannot bypass blocked spotting', () => {
  const sim = new BattleSimulation({ ...terrain, hasLineOfSight: () => false } as LunarTerrain, mission);
  const artillery = sim.addUnit('player', 'artillery', 0, 0, 'range');
  sim.addUnit('enemy', 'shield', 0, -14, 'hold');
  start(sim); artillery.cooldown = 0;
  assert(!advance(sim, 8).some(event => event.type === 'shot' && event.kind === 'artillery'));
  assert.equal(artillery.damageDealt, 0);
});

check('anti-armor missiles penetrate heavy armor while infantry and shield protection remain effective', () => {
  for (const [kind, minimum, maximum] of [['tank', 118, 123], ['mech', 134, 138], ['rifle', 150, 155], ['shield', 80, 85]] as const) {
    const sim = new BattleSimulation(terrain, mission);
    const missile = sim.addUnit('player', 'missile', 0, 15, 'range');
    sim.addUnit('enemy', kind, 0, 0, 'hold');
    start(sim); missile.cooldown = 0;
    const shots = advance(sim, 1.6).filter(event => event.type === 'shot' && event.kind === 'missile');
    assert.equal(shots.length, 1);
    assert(missile.damageDealt >= minimum && missile.damageDealt <= maximum, `${kind}: ${missile.damageDealt}`);
  }
});

check('an anti-armor soldier survives one tank shell but still needs protection from follow-up fire', () => {
  const sim = new BattleSimulation(terrain, mission);
  const tank = sim.addUnit('player', 'tank', 0, 0, 'advance');
  const missile = sim.addUnit('enemy', 'missile', 0, 15, 'hold');
  start(sim); tank.cooldown = 0; missile.hp = UNIT_SPECS.missile.hp;
  advance(sim, 1);
  assert(missile.alive && missile.hp > 0 && missile.hp < 10);
  advance(sim, 4);
  assert(!missile.alive);
});

console.log(`\n${checks} battle checks passed.`);

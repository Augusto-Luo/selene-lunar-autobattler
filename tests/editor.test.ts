import { TRAINING_FORMATIONS } from '../src/training-formations';
import assert from 'node:assert/strict';
import { BattleSimulation } from '../src/battle';
import { UNIT_SPECS } from '../src/data';
import { disposeObject } from '../src/dispose';
import { cloneLevel, createLevel, LevelHistory, levelCost, levelToMission, parseLevel } from '../src/level';
import type { LevelDocument, MapObject } from '../src/level';
import { validatePlaytest } from '../src/level-validation';
import { constrainToObject, createMapObject, distanceToObject, objectBlocksSegment, terrainHeight } from '../src/map-objects';
import { MISSION_LIST } from '../src/missions';
import { LunarTerrain } from '../src/terrain';
import { setLocale } from '../src/i18n';

// Existing validation assertions use the original Chinese text; locale coverage is separate.
setLocale('zh-CN', { updateUrl: false });

// Only 2D texture drawing is stubbed. Geometry, pathfinding and battle logic are real.
const context = { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect() {} };
Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } });
let seed = 8128;
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

let passed = 0;
function check(label: string, fn: () => void) { fn(); passed++; console.log(`PASS ${label}`); }
const blank = createLevel('blank');
check('all templates can be imported and stay within their budget', () => {
  for (const template of ['blank', 'tranquility', 'craters', 'relay', 'bastion'] as const) {
    const level = createLevel(template), decoded = parseLevel(JSON.stringify(level));
    assert.equal(decoded.name, level.name); assert.equal(decoded.units.length, level.units.length);
    assert(levelCost(decoded) <= level.budget);
    const ids = [...level.units, ...level.terrain.features, ...level.terrain.objects].map(e => e.id);
    assert.equal(ids.length, new Set(ids).size);
  }
});
check('malformed imports never change a draft', () => {
  const history = new LevelHistory(blank), original = JSON.stringify(history.current);
  for (const invalid of [null, [], {}, 'not JSON', { ...blank, version: 2 }, { ...blank, budget: Infinity }, { ...blank, timeLimit: -1 }, { ...blank, name: '' }, { ...blank, terrain: { features: [{ id: 'f', kind: 'hill', x: 0, z: 0, radius: 0, height: 1 }], objects: [] } }, { ...blank, units: [{ id: '__bad', team: 'enemy', kind: 'unknown', x: 0, z: 0 }] }]) assert.throws(() => parseLevel(invalid));
  const duplicate = createLevel(); duplicate.units[0].id = duplicate.units[1].id; assert.throws(() => history.commit(duplicate));
  assert.equal(JSON.stringify(history.current), original); assert.equal(history.canUndo, false);
});
check('undo / redo isolates revisions and invalid commits', () => {
  const history = new LevelHistory(blank), next = cloneLevel(blank); next.name = '第一稿';
  assert(history.commit(next)); next.name = '外部修改'; assert.equal(history.current.name, '第一稿');
  assert(history.undo()); assert.equal(history.current.name, blank.name); assert(history.redo()); assert.equal(history.current.name, '第一稿');
  assert(history.undo()); const alternative = cloneLevel(blank); alternative.budget = 82; history.commit(alternative); assert.equal(history.canRedo, false);
  assert.throws(() => history.commit({ ...blank, budget: -1 })); assert.equal(history.current.budget, 82);
});
check('manual JSON round trips preserve all tactics without persistent storage', () => {
  const level = createLevel('bastion'); level.units[0].heading = 1.23; level.units[0].doctrine = 'flank'; level.units[0].priority = 'weak';
  const original = cloneLevel(level), decoded = parseLevel(JSON.stringify(level));
  assert.deepEqual(decoded, original); decoded.name = 'Independent'; assert.notEqual(decoded.name, level.name);
});
check('edited terrain changes elevation, softness and movement', () => {
  const level = cloneLevel(blank); level.terrain.features = [{ id: 'hill', kind: 'hill', x: -10, z: 0, radius: 7, height: 3 }, { id: 'crater', kind: 'crater', x: 10, z: 0, radius: 5, height: 2 }, { id: 'soft', kind: 'soft', x: 0, z: 12, radius: 4, height: 0 }];
  assert(terrainHeight(level.terrain, -10, 0) > 2.9); assert(terrainHeight(level.terrain, 10, 0) < -1.9);
  const terrain = new LunarTerrain('custom', level.terrain);
  assert(terrain.isHigh(-10, 0)); assert(terrain.isSoft(0, 12)); assert(!terrain.isSoft(0, -12));
  assert(terrain.movementMultiplier(UNIT_SPECS.rifle, 0, 12) < 1);
  assert(terrain.movementMultiplier(UNIT_SPECS.tank, 0, 12) > terrain.movementMultiplier(UNIT_SPECS.rifle, 0, 12));
  disposeObject(terrain.group);
});
const wall: MapObject = { id: 'wall', kind: 'wall', x: 0, z: 0, radius: 5, height: 2, heading: 0 };
check('rotated building footprints agree with collision and shot blocking', () => {
  for (const heading of [0, Math.PI / 4, Math.PI / 2]) {
    const object = { ...wall, heading };
    const transform = (x: number, z: number) => ({ x: x * Math.cos(heading) + z * Math.sin(heading), z: -x * Math.sin(heading) + z * Math.cos(heading) });
    assert(distanceToObject(object, transform(4, 0)) < 0); assert(distanceToObject(object, transform(0, 2)) > 1);
    assert(objectBlocksSegment(object, transform(0, -3), transform(0, 3)));
    assert(!objectBlocksSegment(object, transform(6, -3), transform(6, 3)));
    const point = transform(0, 0); constrainToObject(object, point, .7); assert(distanceToObject(object, point) >= .7 - 1e-8);
    const mesh = createMapObject(object, 0); assert.equal(mesh.rotation.y, heading); assert.equal(mesh.userData.editorId, wall.id); disposeObject(mesh);
  }
});
check('low walls provide cover, tall walls block sight and pathfinding routes around them', () => {
  const level = cloneLevel(blank); level.terrain.objects = [{ ...wall, height: 1.1 }];
  const terrain = new LunarTerrain('custom', level.terrain);
  assert(terrain.isWalkable(0, 2, .5)); assert(!terrain.isWalkable(0, 0, .5));
  assert.equal(terrain.coverReduction({ x: 0, z: 1 }, { x: 0, z: -5 }), .35);
  assert(terrain.hasLineOfSight({ x: 0, z: -5 }, { x: 0, z: 5 }));
  level.terrain.objects[0].height = 2;
  assert(!terrain.hasLineOfSight({ x: 0, z: -5 }, { x: 0, z: 5 }));
  const path = terrain.findPath({ x: 0, z: -5 }, { x: 0, z: 5 }, .5);
  assert(path.length > 2); assert(path.some(point => Math.abs(point.x) > 5));
  assert(path.every(point => terrain.isWalkable(point.x, point.z, .5)));
  disposeObject(terrain.group);
});
check('trial validation identifies missing armies, budget and blocked / overlapping spawns', () => {
  const level = createLevel('blank'); const terrain = new LunarTerrain('custom', level.terrain);
  assert.equal(validatePlaytest(level, terrain).length, 2);
  const base = { id: 'p', kind: 'tank' as const, team: 'player' as const, x: 0, z: 10, heading: 0, doctrine: 'hold' as const, priority: 'nearest' as const };
  level.units = [base, { ...base, id: 'e', team: 'enemy', z: -10 }];
  assert.deepEqual(validatePlaytest(level, terrain), []);
  level.budget = 1; assert(validatePlaytest(level, terrain).some(issue => issue.message.includes('配额')));
  level.budget = 56; level.units[1].z = 10; assert(validatePlaytest(level, terrain).some(issue => issue.id === 'e'));
  level.units[1].z = -30; assert(validatePlaytest(level, terrain).some(issue => issue.message.includes('边界')));
  disposeObject(terrain.group);
});
check('all custom templates can run to settlement without changing their draft', () => {
  for (const template of ['tranquility', 'craters', 'relay', 'bastion'] as const) {
    const level = createLevel(template), original = JSON.stringify(level), terrain = new LunarTerrain('custom', cloneLevel(level).terrain);
    const issues = validatePlaytest(level, terrain); assert.deepEqual(issues, [], `${template}: ${JSON.stringify(issues)}`);
    level.units[0].heading = 1.2; const draft = JSON.stringify(level);
    const mission = levelToMission(level), sim = new BattleSimulation(terrain, mission);
    assert.equal(sim.units[0].heading, 1.2); assert.equal(sim.units[0].doctrine, level.units[0].doctrine); assert.equal(sim.units[0].priority, level.units[0].priority);
    let calls = 0; sim.onEnd = () => calls++; sim.start();
    for (let steps = 0; !sim.ended && steps < (level.timeLimit + 2) * 30; steps++) {
      sim.update(1 / 30); sim.drainEvents();
      assert(sim.units.every(unit => [unit.x, unit.z, unit.hp, unit.heading].every(Number.isFinite)));
    }
    assert(sim.ended); assert.equal(calls, 1); assert.equal(JSON.stringify(level), draft);
    sim.resetDeployment(); assert(!sim.running && !sim.ended); assert.equal(sim.units[0].heading, 1.2);
    assert.notEqual(original, draft); disposeObject(terrain.group);
  }
});
check('the four original missions still deploy, fight and reset', () => {
  for (const mission of MISSION_LIST) {
    const terrain = new LunarTerrain(mission.id), sim = new BattleSimulation(terrain, { ...mission, playerDeployment: TRAINING_FORMATIONS[mission.id as keyof typeof TRAINING_FORMATIONS] });
    const count = sim.units.length; sim.start();
    for (let steps = 0; !sim.ended && steps < ((mission.timeLimit ?? 180) + 2) * 30; steps++) { sim.update(1 / 30); sim.drainEvents(); }
    assert(sim.ended); assert(sim.stats.damage > 0); sim.resetDeployment(); assert.equal(sim.units.length, count); assert(!sim.running && !sim.ended); disposeObject(terrain.group);
  }
});
check('campaign armies start empty and all native waves spawn on accessible ground', () => {
  for (const mission of MISSION_LIST) {
    const terrain = new LunarTerrain(mission.id), sim = new BattleSimulation(terrain, mission);
    assert.equal(mission.playerDeployment.length, 0);
    assert.equal(sim.units.filter(unit => unit.team === 'player').length, 0);
    for (const unit of sim.units.filter(unit => unit.team === 'player')) assert(sim.canPlace(unit.kind, unit.x, unit.z, unit.id), `${mission.id}: illegal player ${unit.kind}`);
    for (const wave of mission.waves ?? [mission.enemyDeployment]) {
      for (const unit of wave) assert(terrain.isWalkable(unit.x, unit.z, UNIT_SPECS[unit.kind].radius), `${mission.id}: blocked enemy ${unit.kind} at ${unit.x},${unit.z}`);
      for (let i = 0; i < wave.length; i++) for (let j = i + 1; j < wave.length; j++) assert(Math.hypot(wave[i].x - wave[j].x, wave[i].z - wave[j].z) >= UNIT_SPECS[wave[i].kind].radius + UNIT_SPECS[wave[j].kind].radius + .12);
    }
    disposeObject(terrain.group);
  }
});
check('path waypoints do not retain entire combat units and their previous paths', () => {
  const terrain = new LunarTerrain('custom', { features: [], objects: [] });
  const target = { x: 4, z: 4, path: [{ x: -1, z: -1 }], hp: 100, id: 99 };
  for (const origin of [{ x: 0, z: 0 }, { x: 4, z: 4 }]) {
    const path = terrain.findPath(origin, target, .6);
    assert(path.length > 0);
    for (const point of path) assert.deepEqual(Object.keys(point).sort(), ['x', 'z']);
    assert.deepEqual(path.at(-1), { x: 4, z: 4 });
  }
  disposeObject(terrain.group);
});
console.log(`\n${passed} editor checks passed. WebGL rendering / pointer interactions require a real browser.`);

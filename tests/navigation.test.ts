import assert from 'node:assert/strict';
import { LunarTerrain } from '../src/terrain';
import { BattleSimulation } from '../src/battle';
import { UNIT_SPECS } from '../src/data';
import { disposeObject } from '../src/dispose';
import type { MapObject } from '../src/level';
import type { Unit, Vec2 } from '../src/types';
const context = { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect() {} };
Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } });
let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`); }
const wall = (id: string, x: number, z: number, radius: number, heading = 0): MapObject => ({ id, kind: 'wall', x, z, radius, height: 2, heading });
const custom = (objects: MapObject[]) => new LunarTerrain('custom', { features: [], objects });
function verify(terrain: LunarTerrain, from: Vec2, route: Vec2[], radius: number, cross = false) {
  for (const point of route) { assert(terrain.canTraverse(from, point, radius, cross), `unsafe segment ${JSON.stringify({ from, point })}`); assert.deepEqual(Object.keys(point).sort(), ['x', 'z']); from = point; }
}
check('open terrain uses a straight route without storing runtime objects', () => {
  const terrain = custom([]), goal = { x: 8, z: 6, hp: 120, path: [] }, from = { x: -8, z: -6 };
  const path = terrain.findPath(from, goal, .5); assert.deepEqual(path, [{ x: 8, z: 6 }]); verify(terrain, from, path, .5); disposeObject(terrain.group);
});
check('thin and rotated obstacles between grid cells are detected across entire path segments', () => {
  for (const heading of [0, .4, Math.PI / 2]) {
    const terrain = custom([wall('w', .2, .2, 5, heading)]), from = { x: -1, z: -8 }, goal = { x: 1, z: 8 };
    assert(!terrain.canTraverse(from, goal, .55)); const path = terrain.findPath(from, goal, .55);
    assert(path.length >= 2); assert.deepEqual(path.at(-1), goal); verify(terrain, from, path, .55); disposeObject(terrain.group);
  }
});
check('a U-shaped building requires exiting through its opening before approaching the target', () => {
  const terrain = custom([wall('base', 0, -4, 4.5), wall('left', -4, 0, 4.5, Math.PI / 2), wall('right', 4, 0, 4.5, Math.PI / 2)]);
  const from = { x: 0, z: 0 }, goal = { x: 0, z: -10 }, path = terrain.findPath(from, goal, .5);
  assert.deepEqual(path.at(-1), goal); assert(path.some(point => point.z > 5)); verify(terrain, from, path, .5); disposeObject(terrain.group);
});
check('an unreachable target never creates a direct segment through an enclosed wall', () => {
  const terrain = custom([wall('a', 0, -4, 4.5), wall('b', 0, 4, 4.5), wall('c', -4, 0, 4.5, Math.PI / 2), wall('d', 4, 0, 4.5, Math.PI / 2)]);
  const from = { x: 0, z: 0 }, goal = { x: 12, z: 0 }, path = terrain.findPath(from, goal, .5);
  assert.notDeepEqual(path.at(-1), goal); verify(terrain, from, path, .5);
  for (const point of path) assert(Math.abs(point.x) < 4 && Math.abs(point.z) < 4); disposeObject(terrain.group);
});
check('a goal inside a building resolves to safe ground without appending the blocked goal', () => {
  const terrain = custom([wall('w', 0, 0, 6)]), from = { x: 0, z: -8 }, goal = { x: 0, z: 0 }, path = terrain.findPath(from, goal, .5);
  assert.notDeepEqual(path.at(-1), goal); verify(terrain, from, path, .5); disposeObject(terrain.group);
});
check('unit footprint determines whether a narrow gate can be traversed', () => {
  const terrain = custom([wall('a', 0, -15.5, 14.5, Math.PI / 2), wall('b', 0, 15.5, 14.5, Math.PI / 2)]);
  const from = { x: -8, z: 0 }, goal = { x: 8, z: 0 }, small = terrain.findPath(from, goal, .4), large = terrain.findPath(from, goal, 1.6);
  assert.deepEqual(small.at(-1), goal); assert.notDeepEqual(large.at(-1), goal); verify(terrain, from, small, .4); verify(terrain, from, large, 1.6); disposeObject(terrain.group);
});
check('foot units route through trench bridges while legged units can cross directly', () => {
  const terrain = new LunarTerrain('craters'); terrain.rocks.length = 0;
  const from = { x: 0, z: 4 }, goal = { x: 0, z: 0 };
  assert(!terrain.canTraverse(from, goal, .5)); assert(terrain.canTraverse(from, goal, .5, true));
  const path = terrain.findPath(from, goal, .5); assert.deepEqual(path.at(-1), goal); verify(terrain, from, path, .5); assert(path.some(point => Math.abs(point.x) > 3)); disposeObject(terrain.group);
});
check('a real advancing unit reaches an enemy behind a wall without clipping corners', () => {
  const terrain = custom([wall('wall', 0, 0, 6)]);
  const sim = new BattleSimulation(terrain, { id: 'custom', index: 'T', code: '', name: '', budget: 120, objective: '', success: '', playerDeployment: [], enemyDeployment: [] });
  const mover = sim.addUnit('player', 'electric', 0, 9, 'advance'), enemy = sim.addUnit('enemy', 'tank', 0, -9, 'hold');
  sim.start(); for (const unit of sim.units) { unit.hp = 1e6; unit.cooldown = 1e6; }
  let from = { x: mover.x, z: mover.z };
  for (let tick = 0; tick < 50 * 30; tick++) { sim.update(1 / 30); sim.drainEvents(); assert(terrain.canTraverse(from, mover, UNIT_SPECS.electric.radius)); from = { x: mover.x, z: mover.z }; }
  assert(mover.z < -5); assert(Math.hypot(mover.x - enemy.x, mover.z - enemy.z) < 8); disposeObject(terrain.group);
});
check('an oversized movement step stops before a thin wall even with an obsolete route', () => {
  const terrain = custom([wall('wall', 0, 0, 8)]);
  const sim = new BattleSimulation(terrain, { id: 'custom', index: 'T', code: '', name: '', budget: 120, objective: '', success: '', playerDeployment: [], enemyDeployment: [] });
  const unit = sim.addUnit('player', 'drone', 0, 4), goal = { x: 0, z: -8 };
  unit.path = [goal]; unit.pathGoal = { ...goal }; unit.repath = 10;
  (sim as unknown as { moveToward: (unit: Unit, goal: Vec2, dt: number) => void }).moveToward(unit, goal, 5);
  assert(unit.z > .45); assert(terrain.canTraverse({ x: 0, z: 4 }, unit, UNIT_SPECS.drone.radius)); disposeObject(terrain.group);
});
check('unreachable routes back off instead of running A-star on every simulation tick', () => {
  const terrain = custom([wall('a', 0, -4, 4.5), wall('b', 0, 4, 4.5), wall('c', -4, 0, 4.5, Math.PI / 2), wall('d', 4, 0, 4.5, Math.PI / 2)]);
  const sim = new BattleSimulation(terrain, { id: 'custom', index: 'T', code: '', name: '', budget: 120, objective: '', success: '', playerDeployment: [], enemyDeployment: [] });
  const unit = sim.addUnit('player', 'rifle', 0, 0, 'advance'); sim.addUnit('enemy', 'tank', 16, 0, 'hold');
  const findPath = terrain.findPath.bind(terrain); let calls = 0;
  terrain.findPath = (...args) => { if (args[0] === unit) calls++; return findPath(...args); };
  sim.start(); for (let tick = 0; tick < 30; tick++) { sim.update(1 / 30); sim.drainEvents(); }
  assert(calls <= 3, `too many route searches: ${calls}`); assert(Math.abs(unit.x) < 4); disposeObject(terrain.group);
});
console.log(`${passed} navigation checks passed`);

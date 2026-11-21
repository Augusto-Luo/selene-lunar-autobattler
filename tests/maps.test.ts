import assert from 'node:assert/strict';
import { canDeployAt, deploymentGridSegments, deploymentPlan } from '../src/deployment';
import { BattleSimulation } from '../src/battle';
import { UNIT_ORDER, UNIT_SPECS } from '../src/data';
import { MISSION_LIST } from '../src/missions';
import { LunarTerrain } from '../src/terrain';
import { disposeObject } from '../src/dispose';
import type { BuiltInMissionId } from '../src/missions';
import type { Vec2 } from '../src/types';

const context = { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect() {} };
Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } });
const terrains = new Map(MISSION_LIST.map(m => [m.id, new LunarTerrain(m.id)]));
let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`); }
check('campaign maps have four different deployment geometries and tactical entry choices', () => {
  assert.equal(new Set(MISSION_LIST.map(m => JSON.stringify(deploymentPlan(m.id).zones))).size, 4);
  const cases: [BuiltInMissionId, Vec2[], Vec2[]][] = [
    ['tranquility', [{ x: 0, z: 15 }, { x: -23, z: 12 }, { x: 23, z: 12 }], [{ x: 32, z: 15 }, { x: 0, z: 3 }]],
    ['craters', [{ x: -14, z: 12 }, { x: 15, z: 15 }], [{ x: 0, z: 15 }, { x: 0, z: 22 }]],
    ['relay', [{ x: -18, z: 12 }, { x: 8, z: 22 }], [{ x: 8, z: 12 }, { x: 26, z: 22 }]],
    ['bastion', [{ x: 0, z: 15 }, { x: -12, z: 20 }], [{ x: 26, z: 15 }, { x: 0, z: 28 }]],
  ];
  for (const [id, legal, illegal] of cases) {
    const mission = MISSION_LIST.find(m => m.id === id)!, sim = new BattleSimulation(terrains.get(id)!, mission);
    for (const p of legal) assert(sim.canPlace('rifle', p.x, p.z), `${id}: ${JSON.stringify(p)}`);
    for (const p of illegal) assert(!sim.canPlace('rifle', p.x, p.z), `${id}: excluded ground allowed`);
  }
});
check('large footprints cannot straddle crater deployment edges or the relay concave corner', () => {
  assert(canDeployAt('craters', -8, 10.9, .1));
  assert(!canDeployAt('craters', -8, 10.9, .7));
  assert(canDeployAt('relay', -9.3, 17.8, .1));
  assert(!canDeployAt('relay', -9.3, 17.8, .7));
  assert(!canDeployAt('bastion', 18.8, 15, UNIT_SPECS.tank.radius));
  assert(!canDeployAt('relay', NaN, 20));
});
check('the displayed deployment grid is clipped to the same legal polygons', () => {
  for (const mission of MISSION_LIST) for (const zone of deploymentPlan(mission.id).zones) for (const axis of ['x', 'z'] as const) {
    for (let coordinate = -29.5; coordinate < 29; coordinate += 2) for (const [a, b] of deploymentGridSegments(zone, axis, coordinate)) {
      for (const t of [.01, .25, .5, .75, .99]) assert(canDeployAt(mission.id, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t), `${mission.id}: grid outside polygon`);
    }
  }
});
check('deployment exclusions do not become invisible movement walls after battle starts', () => {
  const terrain = terrains.get('craters')!;
  assert(!canDeployAt('craters', 0, 15, .5));
  assert(terrain.isWalkable(0, 15, .5));
  assert(terrain.canTraverse({ x: -4, z: 19 }, { x: 4, z: 19 }, .5));
});
check('every unit class can be relocated from a previous map to legal non-overlapping ground', () => {
  for (const mission of MISSION_LIST) {
    const sim = new BattleSimulation(terrains.get(mission.id)!, mission);
    for (const kind of UNIT_ORDER) {
      const point = sim.findSpawnPosition(kind, { x: 35, z: 28 });
      assert(point, `${mission.id}: stranded ${kind}`);
      assert(sim.canPlace(kind, point.x, point.z)); sim.addUnit('player', kind, point.x, point.z);
    }
    for (const unit of sim.units.filter(u => u.team === 'player')) assert(sim.canPlace(unit.kind, unit.x, unit.z, unit.id));
  }
});
check('fortress yard and industrial roads are level engineered surfaces without inherited hills', () => {
  const fort = terrains.get('bastion')!, relay = terrains.get('relay')!;
  for (const x of [-19, -10, 0, 10, 19]) for (const z of [3, 8, 14, 21, 27]) assert.equal(fort.heightAt(x, z), 1.6);
  for (const x of [-26, -14, 0, 14, 26]) for (const z of [-24, -12, 0, 12, 24]) assert.equal(relay.heightAt(x, z), .45);
  assert.equal(relay.craterVisuals.length, 0); assert(terrains.get('craters')!.heightAt(3, -3) < -1.5);
});
check('all five fortress assault directions have safe routes into the courtyard for their unit footprints', () => {
  const terrain = terrains.get('bastion')!, mission = MISSION_LIST[3], goal = { x: 0, z: 15 };
  for (const entry of mission.waves!.flat()) {
    const spec = UNIT_SPECS[entry.kind], cross = spec.locomotion === 'biped' || spec.locomotion === 'quad';
    const path = terrain.findPath(entry, goal, spec.radius, cross);
    assert.deepEqual(path.at(-1), goal, `unreachable ${entry.kind} from ${entry.x},${entry.z}`);
    let from: Vec2 = entry;
    for (const point of path) { assert(terrain.canTraverse(from, point, spec.radius, cross)); from = point; }
  }
});
check('new industrial buildings block their corners and route units safely around the full footprint', () => {
  const terrain = terrains.get('relay')!;
  for (const [x, z, w, d] of [[24, 10, 6.2, 5.2], [-26, -23, 6.8, 4.4]]) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) assert(!terrain.isWalkable(x + sx * (w / 2 - .05), z + sz * (d / 2 - .05), .2));
  }
  const start = { x: 24, z: 16 }, goal = { x: 24, z: 3 };
  assert(!terrain.canTraverse(start, goal, .5)); assert(!terrain.hasLineOfSight(start, goal));
  const path = terrain.findPath(start, goal, .5); assert.deepEqual(path.at(-1), goal);
  let from = start;
  for (const point of path) { assert(terrain.canTraverse(from, point, .5)); from = point; }
  const constrained = { x: 27, z: 12.5 }; terrain.constrain(constrained, .5);
  assert(terrain.isWalkable(constrained.x, constrained.z, .5));
});
check('custom editor missions retain their own full-width deployment rule', () => {
  assert(canDeployAt('custom', 30, 15, .5)); assert(canDeployAt('custom', 0, 15, .5));
  assert(!canDeployAt('custom', 0, -5, .5));
});
for (const terrain of terrains.values()) disposeObject(terrain.group);
console.log(`${passed} campaign map checks passed`);

import { build } from 'vite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = process.argv.slice(2);
const option = (name, fallback) => options.includes(name) ? options[options.indexOf(name) + 1] : fallback;
const samples = Number(option('--seeds', '24'));
const profiles = option('--profiles', 'default,advance,hold,no_artillery,snipers,tanks').split(',');
const missionIds = option('--missions', 'tranquility,craters,relay,bastion').split(',');
if (!Number.isInteger(samples) || samples < 1 || samples > 1000) throw new Error('--seeds must be an integer between 1 and 1000');
if (profiles.some(profile => !['default', 'advance', 'hold', 'no_artillery', 'snipers', 'tanks'].includes(profile))) throw new Error('Unknown campaign profile');
if (missionIds.some(id => !['tranquility', 'craters', 'relay', 'bastion'].includes(id))) throw new Error('Unknown mission');

const output = await build({ root, configFile: false, logLevel: 'error', build: { write: false, minify: false, lib: { entry: resolve(root, 'scripts/campaign-runtime.ts'), formats: ['es'], fileName: 'campaign-runtime' } } });
const chunk = (Array.isArray(output) ? output : [output]).flatMap(result => result.output).find(item => item.type === 'chunk' && item.isEntry);
if (!chunk) throw new Error('Campaign runtime bundle is missing');
const directory = await mkdtemp(join(tmpdir(), 'selene-campaign-'));
const originalDocument = globalThis.document;
// Only canvas texture creation is stubbed. Geometry, terrain, pathfinding and combat run normally.
const context = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect() {} };
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };

function seeded(seed, run) {
  const originalRandom = Math.random;
  let state = seed >>> 0;
  Math.random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  try { return run(); } finally { Math.random = originalRandom; }
}
function median(values) {
  const sorted = values.toSorted((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

try {
  const file = join(directory, 'runtime.mjs');
  await writeFile(file, chunk.code);
  const { BattleSimulation, LunarTerrain, MISSION_LIST, UNIT_SPECS, TRAINING_FORMATIONS } = await import(pathToFileURL(file).href);
  const cost = units => units.reduce((sum, unit) => sum + UNIT_SPECS[unit.kind].cost, 0);
  function configure(base, profile, terrain) {
    const mission = structuredClone(base);
    mission.playerDeployment = structuredClone(TRAINING_FORMATIONS[base.id]);
    if (profile === 'advance' || profile === 'hold') for (const unit of mission.playerDeployment) unit.doctrine = profile;
    if (profile === 'no_artillery') mission.playerDeployment = mission.playerDeployment.filter(unit => unit.kind !== 'artillery');
    if (profile === 'snipers' || profile === 'tanks') {
      const kind = profile === 'snipers' ? 'sniper' : 'tank';
      mission.playerDeployment = [];
      const deployment = new BattleSimulation(terrain, mission);
      for (let z = 8; z <= 24; z += 4) for (const x of [0, -4, 4, -8, 8, -12, 12, -16, 16, -20, 20, -24, 24, -28, 28]) {
        if (cost(mission.playerDeployment) + UNIT_SPECS[kind].cost > mission.budget) continue;
        if (!deployment.canPlace(kind, x, z)) continue;
        mission.playerDeployment.push({ kind, x, z, doctrine: 'range', priority: 'threat' });
        deployment.addUnit('player', kind, x, z, 'range', 'threat');
      }
    }
    return mission;
  }
  function simulate(mission, terrain, seed) {
    return seeded(seed, () => {
      const simulation = new BattleSimulation(terrain, mission);
      const players = simulation.units.filter(unit => unit.team === 'player');
      const initialCost = cost(players);
      let firstContact = null, firstLoss = null, lastDamage = 0;
      const waveStarts = [0];
      simulation.start();
      const limit = mission.timeLimit ?? 180;
      for (let tick = 0; !simulation.ended && tick < (limit + 6) * 30; tick++) {
        const wave = simulation.waveIndex;
        simulation.update(1 / 30);
        if (simulation.waveIndex !== wave) waveStarts.push(simulation.stats.time);
        for (const event of simulation.drainEvents()) {
          if (firstContact === null && (event.type === 'shot' || event.type === 'flame')) firstContact = simulation.stats.time;
          if (event.type === 'hit') lastDamage = simulation.stats.time;
          if (firstLoss === null && event.type === 'death' && event.team === 'player') firstLoss = simulation.stats.time;
        }
      }
      const survivors = players.filter(unit => unit.alive);
      return {
        seed, win: simulation.victory, ended: simulation.ended, time: simulation.stats.time,
        firstContact, firstLoss, idleTail: simulation.stats.time - lastDamage, waveStarts,
        survivors: survivors.length, lossValue: (initialCost - cost(survivors)) / initialCost,
        hpRemaining: survivors.reduce((sum, unit) => sum + unit.hp / UNIT_SPECS[unit.kind].hp * UNIT_SPECS[unit.kind].cost, 0) / initialCost,
        remaining: simulation.units.filter(unit => unit.alive && unit.team === 'enemy').map(unit => ({ kind: unit.kind, hp: unit.hp, x: unit.x, z: unit.z, state: unit.state })),
      };
    });
  }
  const report = { methodology: 'Real battle simulation at 30 Hz; seeded cooldown and AI timing. Automated benchmarks, not human win rates. Loss is destroyed supply / deployed supply. HP remaining is supply-weighted. No player intervention or replenishment.', samples, results: [] };
  for (const base of MISSION_LIST.filter(mission => missionIds.includes(mission.id))) {
    const terrain = seeded(12345, () => new LunarTerrain(base.id));
    for (const profile of profiles) {
      const mission = seeded(12345, () => configure(base, profile, terrain));
      const runs = Array.from({ length: samples }, (_, index) => simulate(mission, terrain, 1009 + index * 7919));
      const enemies = base.mode === 'defense' ? (base.waves ?? [base.enemyDeployment]).flat() : base.enemyDeployment;
      const summary = {
        wins: runs.filter(run => run.win).length, runs: samples,
        timeMedian: median(runs.map(run => run.time)), lossValueMedian: median(runs.map(run => run.lossValue)),
        hpRemainingMedian: median(runs.map(run => run.hpRemaining)),
        idleTimeouts: runs.filter(run => !run.win && run.idleTail > 30).length,
        unfinished: runs.filter(run => !run.ended).length,
      };
      report.results.push({ id: base.id, name: base.name, profile, budget: base.budget, spent: cost(mission.playerDeployment), enemyCost: cost(enemies), summary, runs });
      console.log(`${base.index} ${profile.padEnd(12)} ${summary.wins}/${samples}  ${summary.timeMedian.toFixed(1)} s  loss ${(summary.lossValueMedian * 100).toFixed(1)}%  HP ${(summary.hpRemainingMedian * 100).toFixed(1)}%  idle ${summary.idleTimeouts}`);
    }
  }
  const destination = option('--output', null);
  if (destination) await writeFile(resolve(destination), `${JSON.stringify(report, null, 2)}\n`);
} finally {
  globalThis.document = originalDocument;
  await rm(directory, { recursive: true, force: true });
}

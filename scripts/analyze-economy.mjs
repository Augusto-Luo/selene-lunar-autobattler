import { build } from 'vite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = process.argv.slice(2), option = (name, fallback) => options.includes(name) ? options[options.indexOf(name) + 1] : fallback;
const samples = Number(option('--seeds', '12'));
if (!Number.isSafeInteger(samples) || samples < 1 || samples > 1000) throw new Error('Invalid --seeds');
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
try {
  const file = join(directory, 'runtime.mjs'); await writeFile(file, chunk.code);
  const { BattleSimulation, LunarTerrain, MISSION_LIST, UNIT_SPECS, TRAINING_FORMATIONS, newCampaign, recruit, recordVictory, advanceCampaign, campaignSpent, CAMPAIGN_STARTING_FUNDS } = await import(pathToFileURL(file).href);
  const terrains = MISSION_LIST.map(mission => seeded(12345, () => new LunarTerrain(mission.id)));
  const runs = [];
  for (let sample = 0; sample < samples; sample++) {
    const state = newCampaign(), stages = [], seed = 1009 + sample * 7919;
    seeded(seed, () => {
      for (const [index, base] of MISSION_LIST.entries()) {
        const sim = new BattleSimulation(terrains[index], base), used = new Set(), runtimeIds = new Map();
        for (const slot of TRAINING_FORMATIONS[base.id]) {
          const point = sim.findSpawnPosition(slot.kind, slot); if (!point) continue;
          let soldier = state.army.find(unit => unit.kind === slot.kind && !used.has(unit.id));
          if (!soldier) soldier = recruit(state, slot.kind, point);
          if (!soldier) continue;
          used.add(soldier.id); Object.assign(soldier, { ...point, doctrine: slot.doctrine ?? 'advance', priority: slot.priority ?? 'nearest', deployed: true });
          const unit = sim.addUnit('player', soldier.kind, soldier.x, soldier.z, soldier.doctrine, soldier.priority); runtimeIds.set(unit.id, soldier.id);
        }
        for (const soldier of state.army.filter(unit => !used.has(unit.id))) {
          const point = sim.findSpawnPosition(soldier.kind, { x: soldier.x, z: Math.max(8, Math.min(23, soldier.z)) });
          if (!point) { soldier.deployed = false; continue; }
          Object.assign(soldier, point); soldier.deployed = true;
          const unit = sim.addUnit('player', soldier.kind, point.x, point.z, soldier.doctrine, soldier.priority); runtimeIds.set(unit.id, soldier.id);
        }
        const purchaseCost = campaignSpent(state), players = sim.units.filter(unit => unit.team === 'player');
        if (players.some(unit => !sim.canPlace(unit.kind, unit.x, unit.z, unit.id))) throw new Error('Illegal benchmark deployment');
        sim.start(); let lastDamage = 0;
        for (let tick = 0; !sim.ended && tick < ((base.timeLimit ?? 180) + 2) * 30; tick++) {
          sim.update(1 / 30); for (const event of sim.drainEvents()) if (event.type === 'hit') lastDamage = sim.stats.time;
        }
        const survivors = players.filter(unit => unit.alive).map(unit => runtimeIds.get(unit.id));
        stages.push({ mission: base.id, win: sim.victory, spent: purchaseCost, funds: state.funds, recruited: state.army.filter(unit => !unit.veteran).length, deployed: players.length, survivors: survivors.length, time: sim.stats.time, idleTail: sim.stats.time - lastDamage });
        if (!sim.victory) break;
        if (!recordVictory(state, { survivors, time: sim.stats.time, kills: sim.stats.playerKills })) throw new Error('Invalid settlement');
        if (index < 3 && !advanceCampaign(state)) throw new Error('Invalid stage progression');
      }
    });
    const complete = stages.length === 4 && stages.every(stage => stage.win);
    runs.push({ seed, complete, spent: campaignSpent(state), remaining: state.funds, stages });
    console.log(`Seed ${seed}: ${stages.filter(stage => stage.win).length}/4, spent $${campaignSpent(state)}, remaining $${state.funds}`);
  }
  const complete = runs.filter(run => run.complete), report = {
    methodology: 'Real 30 Hz combat; one shared fund, no stage income, only survivors heal and carry over. A scripted reference strategy fills editor reference formations using veterans first, then buys missing roles. No retry or player intervention. Results are simulated strategy performance, not human win rates.',
    startingFunds: CAMPAIGN_STARTING_FUNDS, samples,
    summary: { completed: complete.length, lowestClearCost: complete.length ? Math.min(...complete.map(run => run.spent)) : null, highestClearCost: complete.length ? Math.max(...complete.map(run => run.spent)) : null, stageWins: MISSION_LIST.map(mission => ({ mission: mission.id, wins: runs.filter(run => run.stages.some(stage => stage.mission === mission.id && stage.win)).length })), idleTimeouts: runs.flatMap(run => run.stages).filter(stage => !stage.win && stage.idleTail > 30).length },
    runs,
  };
  const output = option('--output', ''); if (output) await writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.summary));
} finally { globalThis.document = originalDocument; await rm(directory, { recursive: true, force: true }); }

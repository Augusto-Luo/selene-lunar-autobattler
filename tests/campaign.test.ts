import assert from 'node:assert/strict';
import { advanceCampaign, CAMPAIGN_STARTING_FUNDS, campaignComplete, campaignSpent, newCampaign, parseCampaign, recordVictory, recruit, retryStage, withdraw } from '../src/campaign';
import { UNIT_SPECS } from '../src/data';
import { MISSION_LIST } from '../src/missions';
let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS ${name}`); }
const buy = (state: ReturnType<typeof newCampaign>, kind: 'rifle' | 'tank' | 'sniper' = 'rifle') => { const unit = recruit(state, kind, { x: 0, z: 15 }); assert(unit); return unit; };
const win = (state: ReturnType<typeof newCampaign>, survivors = state.army.filter(unit => unit.deployed).map(unit => unit.id)) => recordVictory(state, { survivors, time: 32.5, kills: 8 });
check('campaign starts at stage one with one shared fund and every built-in army empty', () => {
  const state = newCampaign(); assert.equal(state.stage, 0); assert.equal(state.funds, CAMPAIGN_STARTING_FUNDS); assert.deepEqual(state.army, []);
  for (const mission of MISSION_LIST) assert.deepEqual(mission.playerDeployment, []);
});
check('purchases spend money and cancellation refunds once without creating credits', () => {
  const state = newCampaign(), soldier = buy(state, 'tank'); assert.equal(campaignSpent(state), UNIT_SPECS.tank.cost);
  assert(withdraw(state, soldier.id)); assert.equal(state.funds, CAMPAIGN_STARTING_FUNDS); assert.equal(withdraw(state, soldier.id), false); assert.equal(state.funds, CAMPAIGN_STARTING_FUNDS);
});
check('funds cannot go negative or be replenished by advancing', () => {
  const state = newCampaign(); while (recruit(state, 'tank', { x: 0, z: 15 })) { /* exhaust funds */ }
  while (recruit(state, 'rifle', { x: 0, z: 15 })) { /* spend the remainder */ }
  assert.equal(state.funds, 0); assert.equal(recruit(state, 'rifle', { x: 0, z: 15 }), null); assert(win(state)); assert(advanceCampaign(state)); assert.equal(state.funds, 0); assert.equal(campaignSpent(state), CAMPAIGN_STARTING_FUNDS);
});
check('a stage cannot be skipped, a duplicate victory cannot advance twice, and the final stage ends the campaign', () => {
  const state = newCampaign(); assert.equal(advanceCampaign(state), false); buy(state);
  for (let stage = 0; stage < 4; stage++) {
    assert.equal(state.stage, stage); assert(win(state)); assert.equal(win(state), false);
    if (stage < 3) { assert(advanceCampaign(state)); assert.equal(advanceCampaign(state), false); }
  }
  assert(campaignComplete(state)); assert.equal(advanceCampaign(state), false); assert.equal(state.victories.length, 3);
});
check('only survivors cross a victory boundary and retain their identity and orders', () => {
  const state = newCampaign(), survivor = buy(state, 'sniper'), casualty = buy(state, 'tank');
  survivor.doctrine = 'flank'; survivor.priority = 'weak'; survivor.heading = .7;
  const funds = state.funds; assert(win(state, [survivor.id])); assert(advanceCampaign(state));
  assert.deepEqual(state.army, [{ ...survivor, veteran: true }]); assert(!state.army.some(unit => unit.id === casualty.id)); assert.equal(state.funds, funds);
});
check('withdrawing a veteran keeps it in reserve, never refunds it, and preserves reserves between victories', () => {
  const state = newCampaign(), veteran = buy(state); assert(win(state)); assert(advanceCampaign(state));
  const funds = state.funds; assert(withdraw(state, veteran.id)); assert.equal(state.funds, funds); assert.equal(state.army[0].deployed, false);
  const newcomer = buy(state); assert(win(state, [newcomer.id])); assert(advanceCampaign(state));
  assert.equal(state.army.find(unit => unit.id === veteran.id)?.deployed, false); assert.equal(state.army.find(unit => unit.id === newcomer.id)?.veteran, true);
});
check('retry restores the editable stage without charging again or changing its opening army', () => {
  const state = newCampaign(); buy(state, 'tank'); buy(state); const army = structuredClone(state.army), funds = state.funds;
  for (let attempt = 0; attempt < 5; attempt++) { assert(win(state, [state.army[0].id])); retryStage(state); assert.deepEqual(state.army, army); assert.equal(state.funds, funds); assert.equal(state.stage, 0); }
  assert(withdraw(state, state.army[0].id)); assert.equal(state.funds, funds + UNIT_SPECS.tank.cost);
});
check('victory cannot mint soldiers, include reserves or contain duplicated survivors', () => {
  const state = newCampaign(), soldier = buy(state);
  assert.equal(win(state, []), false); assert.equal(win(state, ['unknown']), false); assert.equal(win(state, [soldier.id, soldier.id]), false);
  assert(win(state)); assert.equal(recruit(state, 'tank', { x: 0, z: 15 }), null); assert.equal(withdraw(state, soldier.id), false);
});
check('deployment and victory state clones never mutate the running campaign', () => {
  const state = newCampaign(); buy(state, 'tank');
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(parseCampaign(state), state); assert(win(state)); assert.deepEqual(parseCampaign(state), state);
    if (i < 3) assert(advanceCampaign(state));
  }
  const cloned = parseCampaign(state); cloned.army[0].x = 17; assert.notEqual(state.army[0].x, 17);
});
check('malformed checkpoints cannot add funds, duplicate troops, forge history or leak NaN into the game', () => {
  const state = newCampaign(); buy(state); const mutate = (run: (value: typeof state) => void) => { const invalid = structuredClone(state); run(invalid); assert.throws(() => parseCampaign(invalid)); };
  mutate(s => { s.funds++; }); mutate(s => { s.funds = Infinity; }); mutate(s => { s.stage = 3; }); mutate(s => { s.army.push({ ...s.army[0] }); }); mutate(s => { s.army[0].x = NaN; }); mutate(s => { s.army[0].veteran = true; }); mutate(s => { s.nextId = 1; }); mutate(s => { s.result = { survivors: ['fake'], time: 10, kills: 1 }; });
});
console.log(`${passed} campaign economy checks passed`);

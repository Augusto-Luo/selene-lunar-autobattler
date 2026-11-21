import { UNIT_ORDER, UNIT_SPECS, WORLD } from './data';
import { MISSION_LIST } from './missions';
import type { Doctrine, Priority, UnitKind, Vec2 } from './types';

export const CAMPAIGN_STARTING_FUNDS = 140;
export interface CampaignSoldier extends Vec2 {
  id: string;
  kind: UnitKind;
  heading: number;
  doctrine: Doctrine;
  priority: Priority;
  veteran: boolean;
  deployed: boolean;
}
export interface CampaignResult { survivors: string[]; time: number; kills: number }
export interface CampaignState {
  version: 1;
  stage: number;
  funds: number;
  nextId: number;
  army: CampaignSoldier[];
  victories: { mission: string; spent: number; time: number; survivors: number }[];
  result: CampaignResult | null;
}
const copy = <T>(value: T): T => structuredClone(value);
export function newCampaign(): CampaignState {
  return { version: 1, stage: 0, funds: CAMPAIGN_STARTING_FUNDS, nextId: 1, army: [], victories: [], result: null };
}
export const campaignSpent = (state: CampaignState) => CAMPAIGN_STARTING_FUNDS - state.funds;
export const campaignComplete = (state: CampaignState) => state.stage === MISSION_LIST.length - 1 && state.result !== null;

/** Purchases remain editable until the stage is won; retrying does not buy them again. */
export function recruit(state: CampaignState, kind: UnitKind, point: Vec2): CampaignSoldier | null {
  if (state.result || !UNIT_ORDER.includes(kind) || state.funds < UNIT_SPECS[kind].cost || state.army.length >= 80) return null;
  const soldier: CampaignSoldier = { id: `c-${state.nextId++}`, kind, x: point.x, z: point.z, heading: Math.PI, doctrine: ['sniper', 'missile', 'artillery'].includes(kind) ? 'range' : 'advance', priority: ['sniper', 'missile'].includes(kind) ? 'threat' : 'nearest', veteran: false, deployed: true };
  state.funds -= UNIT_SPECS[kind].cost; state.army.push(soldier);
  return soldier;
}
export function withdraw(state: CampaignState, id: string): boolean {
  if (state.result) return false;
  const soldier = state.army.find(item => item.id === id);
  if (!soldier) return false;
  if (soldier.veteran) soldier.deployed = false;
  else { state.funds += UNIT_SPECS[soldier.kind].cost; state.army = state.army.filter(item => item !== soldier); }
  return true;
}
export function recordVictory(state: CampaignState, result: CampaignResult): boolean {
  if (state.result || result.survivors.length === 0) return false;
  const deployed = new Set(state.army.filter(item => item.deployed).map(item => item.id));
  if (new Set(result.survivors).size !== result.survivors.length || result.survivors.some(id => !deployed.has(id))) return false;
  if (!Number.isFinite(result.time) || result.time < 0 || !Number.isSafeInteger(result.kills) || result.kills < 0) return false;
  state.result = copy(result);
  return true;
}
export function advanceCampaign(state: CampaignState): boolean {
  if (!state.result || campaignComplete(state)) return false;
  const survivors = new Set(state.result.survivors);
  state.victories.push({ mission: MISSION_LIST[state.stage].id, spent: campaignSpent(state), time: state.result.time, survivors: survivors.size });
  state.army = state.army.filter(item => !item.deployed || survivors.has(item.id)).map(item => ({ ...item, veteran: true }));
  state.stage++; state.result = null;
  return true;
}
export function retryStage(state: CampaignState) { state.result = null; }

/** Reject malformed saves instead of introducing money, duplicate soldiers or skipped stages. */
export function parseCampaign(value: unknown): CampaignState {
  if (typeof value === 'string') { if (value.length > 200_000) throw new Error('Invalid campaign'); value = JSON.parse(value); }
  if (!value || typeof value !== 'object') throw new Error('Invalid campaign');
  const state = value as CampaignState;
  const integer = (n: number, min: number, max: number) => Number.isSafeInteger(n) && n >= min && n <= max;
  if (state.version !== 1 || !integer(state.stage, 0, 3) || !integer(state.funds, 0, CAMPAIGN_STARTING_FUNDS) || !integer(state.nextId, 1, Number.MAX_SAFE_INTEGER) || !Array.isArray(state.army) || state.army.length > 80 || !Array.isArray(state.victories) || state.victories.length !== state.stage) throw new Error('Invalid campaign');
  const ids = new Set<string>();
  for (const soldier of state.army) {
    if (!soldier || !/^c-\d+$/.test(soldier.id) || ids.has(soldier.id) || Number(soldier.id.slice(2)) >= state.nextId || !UNIT_ORDER.includes(soldier.kind) || typeof soldier.veteran !== 'boolean' || typeof soldier.deployed !== 'boolean' || (!soldier.veteran && !soldier.deployed) || (state.stage === 0 && soldier.veteran) || !['advance', 'hold', 'flank', 'range'].includes(soldier.doctrine) || !['nearest', 'threat', 'backline', 'weak'].includes(soldier.priority) || !Number.isFinite(soldier.heading) || !Number.isFinite(soldier.x) || !Number.isFinite(soldier.z) || soldier.x < WORLD.minX || soldier.x > WORLD.maxX || soldier.z < WORLD.minZ || soldier.z > WORLD.maxZ) throw new Error('Invalid campaign soldier');
    ids.add(soldier.id);
  }
  let previousSpent = 0;
  for (const [index, win] of state.victories.entries()) {
    if (!win || win.mission !== MISSION_LIST[index].id || !integer(win.spent, previousSpent, campaignSpent(state)) || !Number.isFinite(win.time) || win.time < 0 || !integer(win.survivors, 1, 80)) throw new Error('Invalid campaign history');
    previousSpent = win.spent;
  }
  const currentPurchases = state.army.filter(item => !item.veteran).reduce((sum, item) => sum + UNIT_SPECS[item.kind].cost, 0);
  if (campaignSpent(state) !== previousSpent + currentPurchases) throw new Error('Invalid campaign balance');
  if (state.result !== null) {
    const trial = copy(state); trial.result = null;
    if (!state.result || !Array.isArray(state.result.survivors) || !recordVictory(trial, state.result)) throw new Error('Invalid campaign result');
  }
  return copy(state);
}

import { t } from './i18n';
import { ENEMY_DEPLOYMENT } from './data';
import type { Doctrine, Priority, UnitKind } from './types';

export type BuiltInMissionId = 'tranquility' | 'craters' | 'relay' | 'bastion';
export type MissionId = BuiltInMissionId | 'custom';

export interface DeploymentEntry {
  kind: UnitKind;
  x: number;
  z: number;
  doctrine?: Doctrine;
  priority?: Priority;
  heading?: number;
}

export interface MissionConfig {
  id: MissionId;
  index: string;
  name: string;
  code: string;
  budget: number;
  mode?: 'defense';
  waves?: DeploymentEntry[][];
  timeLimit?: number;
  focus?: string;
  hint?: string;
  objective: string;
  success: string;
  victoryTitle?: string;
  playerDeployment: DeploymentEntry[];
  enemyDeployment: DeploymentEntry[];
}

const BASTION_WAVE: DeploymentEntry[] = [
  // First wave, north: a light four-unit assault.
  { kind: 'shield', x: -4, z: -19, doctrine: 'advance' },
  { kind: 'shield', x: 0, z: -19, doctrine: 'advance' },
  { kind: 'rifle', x: -7, z: -22, doctrine: 'advance' },
  { kind: 'rifle', x: 3, z: -23, doctrine: 'advance' },
  // First wave, east: fast flankers with a shield escort.
  { kind: 'drone', x: 29, z: 10, doctrine: 'flank', priority: 'backline' },
  { kind: 'shield', x: 27, z: 18, doctrine: 'advance' },
  // First wave, south: the rear breach team.
  // Enter through the gate: the strip behind the south wall is too narrow for navigation cells.
  { kind: 'shield', x: -1.3, z: 29, doctrine: 'advance' },
  { kind: 'rifle', x: 1.3, z: 29, doctrine: 'advance' },
  // First wave, west: light flankers.
  { kind: 'drone', x: -29, z: 9, doctrine: 'flank', priority: 'backline' },
  { kind: 'electric', x: -30, z: 13, doctrine: 'advance' },
  // First wave, new north-western diagonal assault.
  { kind: 'shield', x: -24, z: -16, doctrine: 'advance' },
  { kind: 'rifle', x: -27, z: -18, doctrine: 'advance' },
];

const BASTION_REINFORCEMENTS: DeploymentEntry[] = [
  // Second wave, north: heavy armor, flame and long-range support.
  { kind: 'tank', x: 7, z: -21, doctrine: 'advance', priority: 'threat' },
  { kind: 'flame', x: 1, z: -22, doctrine: 'advance' },
  { kind: 'missile', x: -10, z: -23, doctrine: 'range', priority: 'threat' },
  { kind: 'artillery', x: 5, z: -27, doctrine: 'range', priority: 'backline' },
  // Second wave, east: a heavy mech breach.
  { kind: 'mech', x: 26, z: 14, doctrine: 'advance', priority: 'threat' },
  // Second wave, south: artillery behind the breach.
  { kind: 'artillery', x: 0, z: 28.7, doctrine: 'range', priority: 'backline' },
  // Second wave, west: anti-armor crossfire and heavy armor.
  { kind: 'missile', x: -32, z: 18, doctrine: 'range', priority: 'threat' },
  { kind: 'tank', x: -27, z: 20, doctrine: 'advance', priority: 'threat' },
  // Second wave, north-west: a mech with anti-armor cover.
  { kind: 'mech', x: -20, z: -17, doctrine: 'advance', priority: 'threat' },
  { kind: 'missile', x: -29, z: -22, doctrine: 'range', priority: 'threat' },
];

export const MISSIONS: Record<BuiltInMissionId, MissionConfig> = {
  tranquility: {
    id: 'tranquility', index: '01', get name() { return t("静海防线"); }, get code() { return t("MISSION / 01"); }, budget: 30,
    get focus() { return t("基础阵型"); },
    get hint() { return t("从空编队开始，花钱购买部队；保留资金和幸存者，为后续三关做准备。"); },
    get objective() { return t("协同推进，清除通信前哨的步兵守军。"); },
    get success() { return t("通信前哨已被我方控制，静海区域恢复联络。"); },
    playerDeployment: [],
    enemyDeployment: ENEMY_DEPLOYMENT,
  },
  craters: {
    id: 'craters', index: '02', get name() { return t("陨石坑群"); }, get code() { return t("MISSION / 02"); }, budget: 54,
    get focus() { return t("地形与曲射"); },
    get hint() { return t("火箭炮需要友军提供视野；无人车迂回后排，避免全军挤在正面。"); },
    get objective() { return t("利用曲射与侧翼通道，瓦解环形坑守军。"); },
    get success() { return t("环形坑守军已被清除，通往第谷中继站的路线开放。"); },
    playerDeployment: [],
    enemyDeployment: [
      { kind: 'shield', x: -3, z: -1, doctrine: 'hold' },
      { kind: 'shield', x: 6, z: -2, doctrine: 'hold' },
      { kind: 'rifle', x: -4, z: -5, doctrine: 'hold' },
      { kind: 'rifle', x: 2, z: -6, doctrine: 'hold' },
      { kind: 'rifle', x: 9, z: -5, doctrine: 'hold' },
      { kind: 'flame', x: 3, z: -3, doctrine: 'hold' },
      { kind: 'sniper', x: -10, z: -4, doctrine: 'range', priority: 'threat' },
      { kind: 'sniper', x: 16, z: -5, doctrine: 'range', priority: 'threat' },
      { kind: 'tank', x: 4, z: -12, doctrine: 'hold', priority: 'threat' },
      { kind: 'missile', x: -5, z: -12, doctrine: 'range', priority: 'threat' },
      { kind: 'missile', x: 11, z: -12, doctrine: 'range', priority: 'threat' },
      { kind: 'drone', x: -12, z: -12, doctrine: 'flank', priority: 'backline' },
      { kind: 'artillery', x: 3, z: -20, doctrine: 'range', priority: 'backline' },
    ],
  },
  relay: {
    id: 'relay', index: '03', get name() { return t("第谷中继站"); }, get code() { return t("MISSION / 03"); }, budget: 68,
    get focus() { return t("混编与反装甲"); },
    get hint() { return t("导弹优先重甲，喷火清理步兵；机甲突破时保留后排掩护。"); },
    get objective() { return t("突破废墟通道，清除中继站混编守军。"); },
    get success() { return t("第谷中继站恢复运行，前往高地堡垒的路线已开放。"); },
    playerDeployment: [],
    enemyDeployment: [
      { kind: 'shield', x: -4, z: 0, doctrine: 'hold' },
      { kind: 'shield', x: 7, z: -2, doctrine: 'hold' },
      { kind: 'rifle', x: -8, z: -4, doctrine: 'hold' },
      { kind: 'rifle', x: 1, z: -6, doctrine: 'hold' },
      { kind: 'rifle', x: 10, z: -5, doctrine: 'hold' },
      { kind: 'flame', x: 3, z: -1, doctrine: 'hold' },
      { kind: 'sniper', x: -14, z: -7, doctrine: 'range', priority: 'threat' },
      { kind: 'sniper', x: 16, z: -7.5, doctrine: 'range', priority: 'threat' },
      { kind: 'tank', x: 4, z: -15, doctrine: 'hold', priority: 'threat' },
      { kind: 'tank', x: 10, z: -17, doctrine: 'hold', priority: 'threat' },
      { kind: 'missile', x: -6, z: -14, doctrine: 'range', priority: 'threat' },
      { kind: 'missile', x: 11, z: -13, doctrine: 'range', priority: 'threat' },
      { kind: 'drone', x: -18, z: -14, doctrine: 'flank', priority: 'backline' },
      { kind: 'mech', x: -2, z: -11, doctrine: 'hold', priority: 'threat' },
      { kind: 'artillery', x: 5, z: -22, doctrine: 'range', priority: 'backline' },
    ],
  },
  bastion: {
    id: 'bastion', index: '04', get name() { return t("高地堡垒"); }, get code() { return t("MISSION / 04"); }, budget: 78, mode: 'defense', timeLimit: 360,
    get focus() { return t("多方向连续防御"); },
    get hint() { return t("盾兵守入口，机动部队支援侧翼；第二波增加破甲火力，重甲避免扎堆。"); },
    get objective() { return t("依托扩建堡垒，击退两波五方向围攻。"); },
    get success() { return t("高地堡垒仍在坚守，五路围攻部队已全部击退。"); },
    get victoryTitle() { return t("高地堡垒守住了"); },
    playerDeployment: [],
    enemyDeployment: BASTION_WAVE,
    waves: [BASTION_WAVE, BASTION_REINFORCEMENTS],
  },
};

export const MISSION_LIST = [MISSIONS.tranquility, MISSIONS.craters, MISSIONS.relay, MISSIONS.bastion];

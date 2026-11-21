import { t } from './i18n';
import type { Doctrine, Priority, UnitKind, UnitSpec } from './types';

export const COMBAT_TUNING = { range: 1.18, speed: 1.15 };

export function scaledRange(spec: UnitSpec) {
  return spec.range * (spec.attack === 'melee' ? 1 : COMBAT_TUNING.range);
}

export const UNIT_SPECS: Record<UnitKind, UnitSpec> = {
  electric: {
    kind: 'electric', get name() { return t("电杖步兵"); }, get short() { return t("电杖"); }, code: 'INF-01', get role() { return t("近战控制"); }, cost: 2,
    hp: 135, radius: 0.58, speed: 3.5, range: 1.8, vision: 18, damage: 28, interval: 0.9,
    armor: 0.08, frontal: 0, damageType: 'energy', attack: 'melee', locomotion: 'foot',
    get description() { return t("接触放电可短暂打断目标。借掩体接近，克制缓慢装甲单位。"); },
  },
  drone: {
    kind: 'drone', get name() { return t("履带无人车"); }, get short() { return t("无人车"); }, code: 'RCV-02', get role() { return t("快速迂回"); }, cost: 3,
    hp: 215, radius: 0.95, speed: 5.2, range: 7.5, vision: 22, damage: 18, interval: 0.55,
    armor: 0.18, frontal: 0.08, damageType: 'kinetic', attack: 'hitscan', locomotion: 'tracked',
    get description() { return t("高速轻型平台，适合侧翼切入炮兵与狙击阵地。"); },
  },
  mech: {
    kind: 'mech', get name() { return t("二足式机甲"); }, get short() { return t("机甲"); }, code: 'MECH-03', get role() { return t("重型突破"); }, cost: 7,
    hp: 740, radius: 1.25, speed: 2.1, range: 2.6, vision: 20, damage: 84, interval: 1.6,
    armor: 0.32, frontal: 0.18, damageType: 'kinetic', attack: 'melee', locomotion: 'biped', aoe: 2.5,
    get description() { return t("高装甲范围攻击，能强闯狭口；松软月壤会显著降低机动。"); },
  },
  sniper: {
    kind: 'sniper', get name() { return t("电磁狙击兵"); }, get short() { return t("狙击"); }, code: 'RAIL-04', get role() { return t("超远程精确打击"); }, cost: 4,
    hp: 110, radius: 0.58, speed: 2.6, range: 23, vision: 28, damage: 128, interval: 3.4,
    armor: 0.04, frontal: 0, damageType: 'energy', attack: 'hitscan', locomotion: 'foot', windup: 1.15,
    get description() { return t("蓄能后造成高额单体伤害。高地可扩大视野和有效射程。"); },
  },
  shield: {
    kind: 'shield', get name() { return t("重装盾牌兵"); }, get short() { return t("盾兵"); }, code: 'AEG-05', get role() { return t("正面承伤"); }, cost: 3,
    hp: 350, radius: 0.72, speed: 2.2, range: 1.9, vision: 17, damage: 17, interval: 1.1,
    armor: 0.28, frontal: 0.5, damageType: 'kinetic', attack: 'melee', locomotion: 'foot',
    get description() { return t("正面护盾大幅减伤，适合守住狭口；侧后方防御较弱。"); },
  },
  flame: {
    kind: 'flame', get name() { return t("喷火装甲兵"); }, get short() { return t("喷火"); }, code: 'THM-06', get role() { return t("扇形范围压制"); }, cost: 4,
    hp: 270, radius: 0.72, speed: 2.5, range: 5.5, vision: 18, damage: 13, interval: 0.24,
    armor: 0.2, frontal: 0.1, damageType: 'thermal', attack: 'cone', locomotion: 'foot', aoe: 2.8,
    get description() { return t("自持氧化高温射流，惩罚密集阵型，对重甲效果有限。"); },
  },
  rifle: {
    kind: 'rifle', get name() { return t("突击枪兵"); }, get short() { return t("枪兵"); }, code: 'INF-07', get role() { return t("中距通用火力"); }, cost: 2,
    hp: 160, radius: 0.58, speed: 3, range: 10.5, vision: 22, damage: 19, interval: 0.65,
    armor: 0.08, frontal: 0, damageType: 'kinetic', attack: 'hitscan', locomotion: 'foot',
    get description() { return t("稳定的中距离自动火力，能高效利用岩体和高地。"); },
  },
  missile: {
    kind: 'missile', get name() { return t("反装甲导弹兵"); }, get short() { return t("导弹"); }, code: 'ATG-08', get role() { return t("远程破甲"); }, cost: 4,
    hp: 150, radius: 0.6, speed: 2.5, range: 17, vision: 23, damage: 158, interval: 4.2,
    armor: 0.05, frontal: 0, damageType: 'explosive', attack: 'shell', locomotion: 'foot', aoe: 1.2, windup: 1.35,
    get description() { return t("破甲弹头对坦克、机甲忽略一半装甲减伤；需要前排掩护，避免近身。"); },
  },
  tank: {
    kind: 'tank', get name() { return t("四足主战坦克"); }, get short() { return t("坦克"); }, code: 'QBT-09', get role() { return t("四足重装直射"); }, cost: 8,
    hp: 700, radius: 1.5, speed: 2.4, range: 16, vision: 24, damage: 148, interval: 3,
    armor: 0.45, frontal: 0.35, damageType: 'kinetic', attack: 'shell', locomotion: 'quad', aoe: 1, windup: 0.65,
    get description() { return t("四足承载长身管主炮，复杂地形适应力较强；正面厚重，侧后方薄弱。"); },
  },
  artillery: {
    kind: 'artillery', get name() { return t("自行火箭炮"); }, get short() { return t("火箭炮"); }, code: 'MLRS-10', get role() { return t("曲射范围杀伤"); }, cost: 6,
    hp: 240, radius: 1.2, speed: 1.9, range: 30, vision: 18, damage: 108, interval: 4.8,
    armor: 0.14, frontal: 0.08, damageType: 'explosive', attack: 'rocket', locomotion: 'tracked', aoe: 3.4, minRange: 8, windup: 1.1,
    get description() { return t("越过地形打击密集阵地，需要友军视野；有最小射程。"); },
  },
};

export const UNIT_ORDER: UnitKind[] = ['rifle', 'shield', 'electric', 'flame', 'sniper', 'missile', 'drone', 'mech', 'tank', 'artillery'];
export const DOCTRINES: { id: Doctrine; label: string; hint: string }[] = [
  { id: 'advance', get label() { return t("推进"); }, get hint() { return t("主动接敌并利用沿途掩体"); } },
  { id: 'hold', get label() { return t("驻守"); }, get hint() { return t("守住阵地锚点，不远离部署区"); } },
  { id: 'flank', get label() { return t("迂回"); }, get hint() { return t("从侧翼接近目标，减少正面暴露"); } },
  { id: 'range', get label() { return t("保持射程"); }, get hint() { return t("与目标维持安全距离，适合远程单位"); } },
];
export const PRIORITIES: { id: Priority; label: string }[] = [
  { id: 'nearest', get label() { return t("最近目标"); } },
  { id: 'threat', get label() { return t("高威胁"); } },
  { id: 'backline', get label() { return t("脆弱后排"); } },
  { id: 'weak', get label() { return t("低生命"); } },
];

export const WORLD = { minX: -36, maxX: 36, minZ: -30, maxZ: 30, deployMinZ: 6, deployMaxZ: 26 };

export const DEFAULT_DEPLOYMENT: { kind: UnitKind; x: number; z: number; doctrine?: Doctrine; priority?: Priority }[] = [
  { kind: 'shield', x: -5.2, z: 12, doctrine: 'advance' },
  { kind: 'shield', x: 0.2, z: 12.2, doctrine: 'advance' },
  { kind: 'rifle', x: -6.8, z: 16, doctrine: 'advance', priority: 'nearest' },
  { kind: 'rifle', x: -0.5, z: 16.4, doctrine: 'advance', priority: 'nearest' },
  { kind: 'sniper', x: -11.4, z: 6.9, doctrine: 'range', priority: 'threat' },
  { kind: 'tank', x: 9.5, z: 11, doctrine: 'advance', priority: 'threat' },
  { kind: 'rifle', x: 4, z: 18, doctrine: 'advance', priority: 'nearest' },
  { kind: 'rifle', x: -12, z: 17, doctrine: 'advance', priority: 'nearest' },
];

export const ENEMY_DEPLOYMENT: { kind: UnitKind; x: number; z: number; doctrine?: Doctrine; priority?: Priority }[] = [
  { kind: 'shield', x: -5.4, z: -11.5 },
  { kind: 'shield', x: 0.1, z: -11.7 },
  { kind: 'rifle', x: -6.8, z: -16 },
  { kind: 'rifle', x: -1.2, z: -16.5 },
  { kind: 'flame', x: 3.2, z: -10.5 },
  { kind: 'sniper', x: -11.7, z: -6.5, doctrine: 'range', priority: 'threat' },
];

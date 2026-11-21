import { TRAINING_FORMATIONS } from './training-formations';
import { t, localizedError } from './i18n';
import { DOCTRINES, PRIORITIES, UNIT_ORDER, UNIT_SPECS, WORLD } from './data';
import { MISSIONS } from './missions';
import type { BuiltInMissionId, MissionConfig } from './missions';
import type { Doctrine, Priority, Team, UnitKind } from './types';

export type FeatureKind = 'hill' | 'crater' | 'soft';
export type ObjectKind = 'rock' | 'wall' | 'bunker' | 'container' | 'radar';
export interface TerrainFeature { id: string; kind: FeatureKind; x: number; z: number; radius: number; height: number }
export interface MapObject { id: string; kind: ObjectKind; x: number; z: number; radius: number; height: number; heading: number }
export interface LevelTerrain { features: TerrainFeature[]; objects: MapObject[] }
export interface LevelUnit { id: string; team: Team; kind: UnitKind; x: number; z: number; heading: number; doctrine: Doctrine; priority: Priority }
export interface LevelDocument { version: 1; name: string; budget: number; timeLimit: number; terrain: LevelTerrain; units: LevelUnit[] }

export const MAX_LEVEL_UNITS = 80;
export const MAX_LEVEL_OBJECTS = 64;
export const MAX_LEVEL_FEATURES = 40;
export const FEATURE_NAMES: Record<FeatureKind, string> = { get hill() { return t("高地"); }, get crater() { return t("陨石坑"); }, get soft() { return t("松软月壤"); } };
export const OBJECT_NAMES: Record<ObjectKind, string> = { get rock() { return t("岩体"); }, get wall() { return t("防御墙"); }, get bunker() { return t("掩体堡"); }, get container() { return t("货柜"); }, get radar() { return t("雷达站"); } };

export function cloneLevel(level: LevelDocument): LevelDocument { return JSON.parse(JSON.stringify(level)); }
export function newEntityId() { return `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }

export function createLevel(template: BuiltInMissionId | 'blank' = 'tranquility'): LevelDocument {
  const source = MISSIONS[template === 'blank' ? 'tranquility' : template];
  const level: LevelDocument = { version: 1, name: template === 'blank' ? t("未命名月面任务") : t("{p0} · 自定义", { p0: source.name }), budget: source.budget, timeLimit: source.timeLimit ?? 180, terrain: { features: [], objects: [] }, units: [] };
  if (template === 'blank') return level;
  const feature = (kind: FeatureKind, x: number, z: number, radius: number, height: number) => level.terrain.features.push({ id: newEntityId(), kind, x, z, radius, height });
  const object = (kind: ObjectKind, x: number, z: number, radius: number, height: number, heading = 0) => level.terrain.objects.push({ id: newEntityId(), kind, x, z, radius, height, heading });
  if (template === 'tranquility') {
    feature('hill', -11.7, 0.2, 9, 2.7); feature('hill', 1.5, -3.5, 7, 1.25); feature('crater', 12.3, -1.8, 5.2, 1.05);
    feature('soft', 10.8, 8.3, 5.2, 0); feature('soft', -18.5, -1.4, 3.8, 0);
    object('rock', -3.6, 2.4, 1.7, 1.1); object('rock', 4.6, 1.1, 1.4, 2.5); object('rock', 10.8, 4.2, 1.9, 1.15); object('rock', -15.8, 6.1, 1.35, 1.6);
    object('radar', 24, -20, 2, 5);
  } else if (template === 'craters') {
    feature('crater', 3, -3, 13.5, 2.2); feature('crater', -20, -11, 6, 1.4); feature('crater', 22, -8, 5.5, 1.2); feature('crater', -18, 15, 4, 1);
    feature('soft', 3, -3, 10.5, 0); object('rock', -3.6, 3.4, 1.5, 1.1); object('rock', 19.2, -14.4, 1.6, 1.8);
    object('wall', 1, 6, 3.4, 1.1); object('bunker', 23, -20, 2, 2);
  } else if (template === 'relay') {
    feature('hill', 3, -9, 14, 2.2); feature('hill', -15, -4, 9, 1.05); feature('crater', -22, 8, 5, .8);
    feature('soft', 20, 10, 4.8, 0); object('radar', 25, -20, 2.5, 7); object('container', -25, -18, 2.5, 2.4); object('wall', 22, 0, 4, 1.2, Math.PI / 2);
  } else {
    feature('hill', 0, 14, 18, 3.4); feature('crater', -22, -8, 5, .7); feature('crater', 22, -10, 4.5, .6);
    feature('soft', -20, 8, 4.4, 0); feature('soft', 20, 8, 4.8, 0);
    object('wall', -12, 6, 3, 1.1); object('wall', 12, 6, 3, 1.1); object('radar', 0, 4, 2, 5);
  }
  for (const team of ['enemy', 'player'] as const) {
    const entries = team === 'enemy' ? source.enemyDeployment : TRAINING_FORMATIONS[template];
    for (const entry of entries) level.units.push({ ...entry, id: newEntityId(), team, heading: entry.heading ?? (team === 'player' ? Math.PI : 0), doctrine: entry.doctrine ?? (['sniper', 'artillery', 'missile'].includes(entry.kind) ? 'range' : 'advance'), priority: entry.priority ?? 'nearest' });
  }
  return level;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw localizedError(() => t("{p0}格式不正确", { p0: t(label) }));
  return value as Record<string, unknown>;
}
function number(value: unknown, min: number, max: number, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw localizedError(() => t("{p0}应在 {p1}–{p2} 之间", { p0: t(label), p1: min, p2: max }));
  return value;
}
function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) throw localizedError(() => t("{p0}无效", { p0: t(label) }));
  return value as T;
}
function array(value: unknown, max: number, label: string) {
  if (!Array.isArray(value) || value.length > max) throw localizedError(() => t("{p0}最多 {p1} 项", { p0: t(label), p1: max }));
  return value;
}

/** Validate imported / stored data before it reaches geometry, AI or HTML. */
export function parseLevel(input: unknown): LevelDocument {
  if (typeof input === 'string') {
    if (input.length > 2_000_000) throw localizedError(() => t("关卡文件过大"));
    try { input = JSON.parse(input); } catch { throw localizedError(() => t("无法解析关卡 JSON")); }
  }
  const data = record(input, "关卡");
  if (data.version !== 1) throw localizedError(() => t("不支持此关卡文件版本"));
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 48) throw localizedError(() => t("任务名称需为 1–48 个字符"));
  const terrain = record(data.terrain, "地形");
  const ids = new Set<string>();
  const position = (item: Record<string, unknown>) => {
    if (typeof item.id !== 'string' || !/^[\w-]{1,64}$/.test(item.id) || ids.has(item.id)) throw localizedError(() => t("对象编号无效或重复"));
    ids.add(item.id);
    return { id: item.id, x: number(item.x, WORLD.minX, WORLD.maxX, "X 坐标"), z: number(item.z, WORLD.minZ, WORLD.maxZ, "Z 坐标") };
  };
  const heading = (value: unknown) => number(value, -1000, 1000, "朝向");
  return {
    version: 1, name: data.name.trim(), budget: number(data.budget, 1, 999, "补给配额"), timeLimit: number(data.timeLimit, 10, 1800, "时间上限"),
    terrain: {
      features: array(terrain.features, MAX_LEVEL_FEATURES, "地形区域").map(value => {
        const item = record(value, "地形区域");
        return { ...position(item), kind: choice(item.kind, ['hill', 'crater', 'soft'], "地形类型"), radius: number(item.radius, 1, 20, "地形半径"), height: number(item.height, 0, 6, "地形高度") };
      }),
      objects: array(terrain.objects, MAX_LEVEL_OBJECTS, "建筑与岩体").map(value => {
        const item = record(value, "建筑");
        return { ...position(item), kind: choice(item.kind, ['rock', 'wall', 'bunker', 'container', 'radar'], "建筑类型"), radius: number(item.radius, .4, 6, "建筑尺寸"), height: number(item.height, .3, 10, "建筑高度"), heading: heading(item.heading) };
      }),
    },
    units: array(data.units, MAX_LEVEL_UNITS, "双方单位").map(value => {
      const item = record(value, "单位");
      return { ...position(item), team: choice(item.team, ['player', 'enemy'], "阵营"), kind: choice(item.kind, UNIT_ORDER, "兵种"), heading: heading(item.heading), doctrine: choice(item.doctrine, DOCTRINES.map(d => d.id), "行动方式"), priority: choice(item.priority, PRIORITIES.map(p => p.id), "目标优先级") };
    }),
  };
}

export function levelToMission(level: LevelDocument): MissionConfig {
  return { id: 'custom', index: 'E', code: t('CUSTOM MISSION'), name: level.name, budget: level.budget, timeLimit: level.timeLimit, objective: t("消灭所有敌方单位。"), success: t("自定义任务完成。"), playerDeployment: level.units.filter(u => u.team === 'player').map(u => ({ ...u })), enemyDeployment: level.units.filter(u => u.team === 'enemy').map(u => ({ ...u })) };
}

export function levelCost(level: LevelDocument) { return level.units.filter(u => u.team === 'player').reduce((sum, u) => sum + UNIT_SPECS[u.kind].cost, 0); }

export class LevelHistory {
  private undoStack: LevelDocument[] = [];
  private redoStack: LevelDocument[] = [];
  current: LevelDocument;
  constructor(initial: LevelDocument) { this.current = cloneLevel(initial); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  commit(next: LevelDocument) {
    const valid = parseLevel(next);
    if (JSON.stringify(valid) === JSON.stringify(this.current)) return false;
    this.undoStack.push(cloneLevel(this.current));
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.redoStack = []; this.current = valid;
    return true;
  }
  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push(cloneLevel(this.current)); this.current = previous; return true;
  }
  redo() {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(cloneLevel(this.current)); this.current = next; return true;
  }
}

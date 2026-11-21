import { t } from './i18n';
import { UNIT_SPECS, WORLD } from './data';
import { levelCost } from './level';
import type { LevelDocument } from './level';
import type { LunarTerrain } from './terrain';

export interface LevelIssue { id?: string; message: string }

export function validatePlaytest(level: LevelDocument, terrain: Pick<LunarTerrain, 'isWalkable' | 'heightAt'>): LevelIssue[] {
  const issues: LevelIssue[] = [];
  if (!level.units.some(u => u.team === 'player')) issues.push({ message: t("至少部署一个我方单位") });
  if (!level.units.some(u => u.team === 'enemy')) issues.push({ message: t("至少部署一个敌方单位") });
  if (levelCost(level) > level.budget) issues.push({ message: t("我方补给 {p0} 超过配额 {p1}，请增加配额或撤回单位", { p0: levelCost(level), p1: level.budget }) });
  for (let i = 0; i < level.units.length; i++) {
    const unit = level.units[i], spec = UNIT_SPECS[unit.kind];
    const label = `${unit.team === 'player' ? t("我方") : t("敌方")} ${spec.name}`;
    if (!terrain.isWalkable(unit.x, unit.z, spec.radius)) issues.push({ id: unit.id, message: t("{p0}与建筑、岩体或地图边界重叠", { p0: label }) });
    else if (level.units.slice(0, i).some(other => Math.hypot(other.x - unit.x, other.z - unit.z) < spec.radius + UNIT_SPECS[other.kind].radius + .08)) issues.push({ id: unit.id, message: t("{p0}与其他单位站位重叠", { p0: label }) });
  }
  return issues;
}

export function insideMap(x: number, z: number, radius = 0) { return x >= WORLD.minX + radius && x <= WORLD.maxX - radius && z >= WORLD.minZ + radius && z <= WORLD.maxZ - radius; }

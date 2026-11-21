import { WORLD } from './data';
import type { MissionId } from './missions';
import type { Vec2 } from './types';

export interface DeploymentZone { readonly id: string; readonly points: readonly Vec2[] }
interface DeploymentPlan { readonly hint: string; readonly zones: readonly DeploymentZone[] }
const rectangle = (id: string, x1: number, z1: number, x2: number, z2: number): DeploymentZone => ({ id, points: [{ x: x1, z: z1 }, { x: x2, z: z1 }, { x: x2, z: z2 }, { x: x1, z: z2 }] });
const plans: Record<MissionId, DeploymentPlan> = {
  tranquility: {
    hint: '前哨 · 宽正面部署，建立步兵与火力线',
    zones: [rectangle('front', -28, 7, 28, 25.5)],
  },
  craters: {
    hint: '坑群 · 两翼分路部署，绕开中央坑底',
    zones: [
      { id: 'west-rim', points: [{ x: -29, z: 25 }, { x: -29, z: 12 }, { x: -16, z: 7 }, { x: -5, z: 12 }, { x: -5, z: 25 }] },
      { id: 'east-rim', points: [{ x: 4, z: 25 }, { x: 4, z: 14 }, { x: 15, z: 9 }, { x: 28, z: 12 }, { x: 28, z: 25 }] },
    ],
  },
  relay: {
    hint: '中继站 · 西侧前进阵地与南侧集结场',
    zones: [{ id: 'loading-apron', points: [{ x: -28, z: 9 }, { x: -9, z: 9 }, { x: -9, z: 18 }, { x: 24, z: 18 }, { x: 24, z: 26 }, { x: -28, z: 26 }] }],
  },
  bastion: {
    hint: '堡垒 · 院内部署，兼顾正门、侧门与后门',
    zones: [rectangle('courtyard', -19, 6, 19, 25.5)],
  },
  custom: {
    hint: '青色区域为部署区 · 单位圆环表示实际占位',
    zones: [rectangle('custom', WORLD.minX, WORLD.deployMinZ, WORLD.maxX, WORLD.deployMaxZ)],
  },
};

export const deploymentPlan = (mission: MissionId): DeploymentPlan => plans[mission];

/** The entire circular footprint must fit inside one visible zone, including concave corners. */
export function insideDeploymentZone(zone: DeploymentZone, x: number, z: number, radius = 0) {
  let inside = false;
  const points = zone.points;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i], dx = b.x - a.x, dz = b.z - a.z;
    const along = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    if (Math.hypot(x - a.x - along * dx, z - a.z - along * dz) + 1e-7 < radius) return false;
    if ((a.z > z) !== (b.z > z) && x < a.x + (z - a.z) * dx / dz) inside = !inside;
  }
  return inside;
}

export const canDeployAt = (mission: MissionId, x: number, z: number, radius = 0) =>
  Number.isFinite(x) && Number.isFinite(z) && plans[mission].zones.some(zone => insideDeploymentZone(zone, x, z, radius));

/** Exact polygon intersections keep grid lines out of excluded gaps and L-shaped notches. */
export function deploymentGridSegments(zone: DeploymentZone, axis: 'x' | 'z', value: number): [Vec2, Vec2][] {
  const other = axis === 'x' ? 'z' : 'x', crossings: number[] = [];
  for (let i = 0; i < zone.points.length; i++) {
    const a = zone.points[i], b = zone.points[(i + 1) % zone.points.length];
    if ((a[axis] <= value && b[axis] > value) || (b[axis] <= value && a[axis] > value)) crossings.push(a[other] + (b[other] - a[other]) * (value - a[axis]) / (b[axis] - a[axis]));
  }
  crossings.sort((a, b) => a - b);
  const result: [Vec2, Vec2][] = [];
  for (let i = 0; i + 1 < crossings.length; i += 2) result.push(axis === 'x' ? [{ x: value, z: crossings[i] }, { x: value, z: crossings[i + 1] }] : [{ x: crossings[i], z: value }, { x: crossings[i + 1], z: value }]);
  return result;
}

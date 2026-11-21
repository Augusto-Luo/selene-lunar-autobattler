export type Team = 'player' | 'enemy';
export type UnitKind = 'electric' | 'drone' | 'mech' | 'sniper' | 'shield' | 'flame' | 'rifle' | 'missile' | 'tank' | 'artillery';
export type Doctrine = 'advance' | 'hold' | 'flank' | 'range';
export type Priority = 'nearest' | 'threat' | 'backline' | 'weak';
export type DamageType = 'kinetic' | 'energy' | 'explosive' | 'thermal';
export type Phase = 'deployment' | 'battle' | 'victory' | 'defeat';
export type CameraMode = 'tactical' | 'frontline' | 'free';
export type TerrainOverlay = 'none' | 'terrain' | 'sight' | 'defense';

export interface UnitSpec {
  kind: UnitKind;
  name: string;
  short: string;
  code: string;
  role: string;
  cost: number;
  hp: number;
  radius: number;
  speed: number;
  range: number;
  vision: number;
  damage: number;
  interval: number;
  armor: number;
  frontal: number;
  damageType: DamageType;
  attack: 'melee' | 'hitscan' | 'shell' | 'rocket' | 'cone';
  locomotion: 'foot' | 'tracked' | 'biped' | 'quad';
  aoe?: number;
  minRange?: number;
  windup?: number;
  description: string;
}

export interface Vec2 {
  x: number;
  z: number;
}

export interface Unit {
  id: number;
  team: Team;
  kind: UnitKind;
  x: number;
  z: number;
  heading: number;
  hp: number;
  alive: boolean;
  doctrine: Doctrine;
  priority: Priority;
  anchor: Vec2;
  targetId: number | null;
  pendingTargetId: number | null;
  path: Vec2[];
  pathIndex: number;
  pathGoal: Vec2 | null;
  blockedTime: number;
  repath: number;
  targetScan: number;
  cooldown: number;
  windup: number;
  stun: number;
  state: string;
  moving: boolean;
  kills: number;
  damageDealt: number;
  deathTime: number;
  flankSign: number;
}

export interface Projectile {
  id: number;
  team: Team;
  sourceId: number;
  targetId: number | null;
  from: Vec2 & { y: number };
  to: Vec2 & { y: number };
  x: number;
  y: number;
  z: number;
  ttl: number;
  duration: number;
  damage: number;
  aoe: number;
  damageType: DamageType;
}

export type GameEvent =
  | { type: 'shot'; kind: UnitKind; from: Vec2 & { y: number }; to: Vec2 & { y: number }; team: Team }
  | { type: 'flame'; kind: UnitKind; from: Vec2 & { y: number }; to: Vec2 & { y: number }; team: Team }
  | { type: 'hit'; x: number; y: number; z: number; damageType: DamageType; heavy: boolean }
  | { type: 'explosion'; x: number; y: number; z: number; heavy: boolean }
  | { type: 'death'; x: number; y: number; z: number; kind: UnitKind; team: Team }
  | { type: 'notice'; text: string; messageKey?: string; values?: Record<string, string | number> };

export interface BattleStats {
  time: number;
  playerKills: number;
  enemyKills: number;
  damage: number;
}

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { UNIT_SPECS, WORLD, scaledRange } from './data';
import type { CameraMode, GameEvent, Phase, Team, TerrainOverlay, UnitKind, Vec2 } from './types';
import { LunarTerrain } from './terrain';
import { BattleSimulation } from './battle';
import { createUnitModel } from './models';
import { EffectsSystem } from './effects';
import { createHorizonTerrain } from './horizon';
import { disposeObject } from './dispose';
import { t, onLocaleChange } from './i18n';
import { deploymentGridSegments, deploymentPlan } from './deployment';

interface UnitView {
  group: THREE.Group;
  ring: THREE.Mesh;
  label: HTMLDivElement;
  hpFill: HTMLSpanElement;
  deadAt: number;
  smokeAt: number;
  recoilAt: number;
  recoilBaseZ: number;
  turretBaseZ: number;
  turretBaseRotationX: number;
}

interface CameraTween {
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  elapsed: number;
}

export class BattleRenderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(43, 1, 0.1, 2000);
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly effects: EffectsSystem;
  readonly canvas: HTMLCanvasElement;
  cameraMode: CameraMode = 'tactical';
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private views = new Map<number, UnitView>();
  private projectileViews = new Map<number, THREE.Mesh>();
  private aimLines = new Map<number, THREE.Line>();
  private labelLayer = document.createElement('div');
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private ground: THREE.Mesh;
  private deploymentZone = new THREE.Group();
  private overlayGroups: Record<Exclude<TerrainOverlay, 'none'>, THREE.Group>;
  private rangeLine: THREE.LineLoop;
  private ghost: THREE.Group | null = null;
  private ghostKind: UnitKind | null = null;
  private ghostTeam: Team | null = null;
  private ghostRing: THREE.Mesh | null = null;
  private cameraTween: CameraTween | null = null;
  private visualTime = 0;
  private resizeObserver: ResizeObserver;
  private worldDecorations = new THREE.Group();

  constructor(readonly container: HTMLElement, public terrain: LunarTerrain, public simulation: BattleSimulation) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;
    this.canvas = this.renderer.domElement;
    this.canvas.id = 'battlefield';
    this.canvas.setAttribute('aria-label', t('可交互的月面三维战场'));
    container.appendChild(this.canvas);
    this.labelLayer.className = 'unit-labels';
    container.appendChild(this.labelLayer);
    this.scene.background = new THREE.Color(0x020406);
    this.scene.fog = new THREE.FogExp2(0x080a0c, 0.0023);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, 0.04).texture;
    this.scene.environmentIntensity = 0.32;
    room.dispose();
    pmrem.dispose();
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 110;
    this.controls.minPolarAngle = 0.18;
    this.controls.maxPolarAngle = Math.PI * 0.465;
    this.controls.mouseButtons.LEFT = undefined;
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    this.controls.target.set(0, 0, 0);
    this.ground = terrain.group.getObjectByName('ground') as THREE.Mesh;
    this.scene.add(terrain.group);
    this.worldDecorations.add(createHorizonTerrain(terrain));
    this.scene.add(this.worldDecorations);
    this.effects = new EffectsSystem(this.scene);
    this.createLighting();
    this.createSky();
    this.createDeploymentZone();
    this.overlayGroups = this.createOverlays();
    this.rangeLine = this.makeGroundCircle(0, 0, 1, 0xe5ad51, true);
    this.rangeLine.visible = false;
    this.scene.add(this.rangeLine);
    this.setCameraMode('tactical', true);
    this.refreshUnits();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    onLocaleChange(container, () => {
      this.canvas.setAttribute('aria-label', t('可交互的月面三维战场'));
      for (const [id, view] of this.views) {
        const unit = this.simulation.units.find(item => item.id === id);
        if (!unit) continue;
        view.label.querySelector('.unit-label-name')!.textContent = UNIT_SPECS[unit.kind].short;
        view.label.querySelector('.unit-label-state')!.textContent = unit.windup > 0 ? t(unit.state) : '';
      }
    });
  }

  setCameraMode(mode: CameraMode, immediate = false) {
    this.cameraMode = mode;
    if (mode === 'free') {
      this.controls.enabled = true;
      this.cameraTween = null;
      return;
    }
    const bastion = this.terrain.missionId === 'bastion';
    const toPosition = mode === 'tactical'
      ? bastion ? new THREE.Vector3(42, 32, 54) : new THREE.Vector3(39, 24, 50)
      : bastion ? new THREE.Vector3(34, 19, 40) : new THREE.Vector3(32, 13, 36);
    const toTarget = mode === 'tactical'
      ? bastion ? new THREE.Vector3(0, 2.5, 12) : new THREE.Vector3(0, 2, -4)
      : bastion ? new THREE.Vector3(0, 3, 14) : new THREE.Vector3(0, 1.1, -4);
    if (immediate || this.reducedMotion) {
      this.camera.position.copy(toPosition);
      this.controls.target.copy(toTarget);
      this.camera.lookAt(toTarget);
      this.controls.update();
    } else {
      this.cameraTween = { fromPosition: this.camera.position.clone(), toPosition, fromTarget: this.controls.target.clone(), toTarget, elapsed: 0 };
    }
    this.controls.enabled = false;
  }

  setPhase(phase: Phase) {
    this.deploymentZone.visible = phase === 'deployment';
    if (phase !== 'deployment') this.setGhost(null);
  }

  setEditorView() {
    this.setCameraMode('free');
    this.camera.position.set(0, 78, 36);
    this.controls.target.set(0, 0, 0);
    this.camera.lookAt(this.controls.target); this.controls.update();
  }

  /** Keep one WebGL context and the current camera while applying a map revision. */
  replaceWorld(terrain: LunarTerrain, simulation: BattleSimulation) {
    if (terrain !== this.terrain) {
      disposeObject(this.terrain.group);
      disposeObject(this.worldDecorations);
      disposeObject(this.deploymentZone);
      for (const group of Object.values(this.overlayGroups)) disposeObject(group);
      this.terrain = terrain;
      this.ground = terrain.group.getObjectByName('ground') as THREE.Mesh;
      this.scene.add(terrain.group);
      this.worldDecorations = new THREE.Group();
      this.worldDecorations.add(createHorizonTerrain(terrain));
      this.scene.add(this.worldDecorations);
      this.deploymentZone = new THREE.Group(); this.createDeploymentZone();
      this.overlayGroups = this.createOverlays();
    }
    for (const view of this.views.values()) { disposeObject(view.group); disposeObject(view.ring); view.label.remove(); }
    this.views.clear();
    for (const mesh of this.projectileViews.values()) disposeObject(mesh);
    for (const line of this.aimLines.values()) disposeObject(line);
    this.projectileViews.clear(); this.aimLines.clear();
    if (this.ghost) disposeObject(this.ghost);
    if (this.ghostRing) disposeObject(this.ghostRing);
    this.ghost = null; this.ghostKind = null; this.ghostTeam = null; this.ghostRing = null;
    this.effects.clear(); this.simulation = simulation;
    this.refreshUnits(); this.rangeLine.visible = false;
  }

  setOverlay(mode: TerrainOverlay) {
    for (const [key, group] of Object.entries(this.overlayGroups)) group.visible = key === mode;
  }

  setGhost(kind: UnitKind | null, point?: Vec2, valid = false, team: Team = 'player', heading = Math.PI) {
    if (!kind || !point) {
      if (this.ghost) this.ghost.visible = false;
      if (this.ghostRing) this.ghostRing.visible = false;
      return;
    }
    if (!this.ghost || this.ghostKind !== kind || this.ghostTeam !== team) {
      if (this.ghost) disposeObject(this.ghost);
      if (this.ghostRing) disposeObject(this.ghostRing);
      this.ghostKind = kind;
      this.ghostTeam = team;
      this.ghost = createUnitModel(kind, team);
      this.ghost.traverse(object => {
        if (object instanceof THREE.Mesh) {
          const source = object.material as THREE.MeshStandardMaterial;
          const material = source.clone();
          material.transparent = true;
          material.opacity = 0.5;
          material.depthWrite = false;
          object.material = material;
        }
      });
      this.scene.add(this.ghost);
      const radius = UNIT_SPECS[kind].radius;
      this.ghostRing = new THREE.Mesh(new THREE.RingGeometry(radius + 0.12, radius + 0.24, 40), new THREE.MeshBasicMaterial({ color: 0x78d7c6, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
      this.ghostRing.rotation.x = -Math.PI / 2;
      this.scene.add(this.ghostRing);
    }
    this.ghost.visible = true;
    this.ghost.position.set(point.x, this.terrain.heightAt(point.x, point.z) + 0.03, point.z);
    this.ghost.rotation.y = heading;
    if (this.ghostRing) {
      this.ghostRing.visible = true;
      this.ghostRing.position.set(point.x, this.terrain.heightAt(point.x, point.z) + 0.07, point.z);
      (this.ghostRing.material as THREE.MeshBasicMaterial).color.set(valid ? 0x78d7c6 : 0xef6656);
    }
  }

  refreshUnits() {
    const ids = new Set(this.simulation.units.map(unit => unit.id));
    for (const [id, view] of this.views) {
      if (!ids.has(id)) {
        disposeObject(view.group); disposeObject(view.ring);
        view.label.remove();
        this.views.delete(id);
      }
    }
    for (const unit of this.simulation.units) {
      if (this.views.has(unit.id)) continue;
      const group = createUnitModel(unit.kind, unit.team);
      group.userData.unitId = unit.id;
      const radius = UNIT_SPECS[unit.kind].radius;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius + 0.12, radius + 0.2, 36),
        new THREE.MeshBasicMaterial({ color: unit.team === 'player' ? 0x65c6cf : 0xcf6652, transparent: true, opacity: 0.64, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      this.scene.add(group, ring);
      const label = document.createElement('div');
      label.className = `unit-label ${unit.team}`;
      label.innerHTML = `<span class="unit-label-name">${UNIT_SPECS[unit.kind].short}</span><span class="unit-label-state"></span><span class="unit-hp"><span></span></span>`;
      this.labelLayer.appendChild(label);
      const turret = group.userData.turret as THREE.Group | undefined;
      const recoil = (group.userData.recoil ?? turret?.userData.recoil) as THREE.Group | undefined;
      this.views.set(unit.id, {
        group, ring, label, hpFill: label.querySelector('.unit-hp > span')!, deadAt: 0, smokeAt: 0,
        recoilAt: -100, recoilBaseZ: recoil?.position.z ?? 0, turretBaseZ: turret?.position.z ?? 0, turretBaseRotationX: turret?.rotation.x ?? 0,
      });
    }
  }

  handleEvent(event: GameEvent) {
    if (event.type === 'shot' && (event.kind === 'tank' || event.kind === 'artillery' || event.kind === 'missile')) {
      const source = this.simulation.units.find(unit => unit.alive && unit.kind === event.kind && unit.team === event.team && Math.hypot(unit.x - event.from.x, unit.z - event.from.z) < 0.1);
      if (source) {
        const view = this.views.get(source.id);
        if (view) view.recoilAt = this.visualTime;
      }
    }
    this.effects.handle(event, this.reducedMotion);
  }

  /** Client coordinates let onboarding markers follow the real camera and terrain. */
  projectToScreen(point: Vec2, height = .1): { x: number; y: number } | null {
    const projected = new THREE.Vector3(point.x, this.terrain.heightAt(point.x, point.z) + height, point.z).project(this.camera);
    if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) return null;
    const rect = this.container.getBoundingClientRect();
    return { x: rect.left + (projected.x * .5 + .5) * rect.width, y: rect.top + (-projected.y * .5 + .5) * rect.height };
  }

  screenToGround(clientX: number, clientY: number): Vec2 | null {
    this.setPointer(clientX, clientY);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.ground, false)[0];
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  }

  pickMapObject(clientX: number, clientY: number): string | null {
    this.setPointer(clientX, clientY);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const hit of this.raycaster.intersectObject(this.terrain.group, true)) {
      let object: THREE.Object3D | null = hit.object;
      while (object && object !== this.terrain.group) {
        if (typeof object.userData.editorId === 'string') return object.userData.editorId;
        object = object.parent;
      }
      // A ground hit in front of a structure occludes that structure.
      if (hit.object === this.ground) return null;
    }
    return null;
  }

  pickUnit(clientX: number, clientY: number) {
    this.setPointer(clientX, clientY);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const groups = [...this.views.values()].map(view => view.group);
    const hit = this.raycaster.intersectObjects(groups, true)[0];
    if (!hit) return null;
    let object: THREE.Object3D | null = hit.object;
    while (object && object.userData.unitId === undefined) object = object.parent;
    return object?.userData.unitId ?? null;
  }

  update(dt: number, phase: Phase, selectedId: number | null, overlay: TerrainOverlay) {
    this.visualTime += dt;
    this.refreshUnits();
    if (this.cameraTween) {
      this.cameraTween.elapsed += dt;
      const raw = Math.min(1, this.cameraTween.elapsed / 0.46);
      const t = 1 - (1 - raw) ** 3;
      this.camera.position.lerpVectors(this.cameraTween.fromPosition, this.cameraTween.toPosition, t);
      this.controls.target.lerpVectors(this.cameraTween.fromTarget, this.cameraTween.toTarget, t);
      if (raw >= 1) this.cameraTween = null;
    }
    if (this.cameraMode === 'free') {
      this.controls.target.x = THREE.MathUtils.clamp(this.controls.target.x, WORLD.minX, WORLD.maxX);
      this.controls.target.z = THREE.MathUtils.clamp(this.controls.target.z, WORLD.minZ, WORLD.maxZ);
    }
    this.controls.update();
    for (const unit of this.simulation.units) {
      const view = this.views.get(unit.id);
      if (!view) continue;
      const spec = UNIT_SPECS[unit.kind];
      const groundY = this.terrain.heightAt(unit.x, unit.z);
      const vehicleWreck = unit.kind === 'drone' || unit.kind === 'tank' || unit.kind === 'artillery';
      if (!unit.alive && view.deadAt === 0) {
        view.deadAt = this.visualTime;
        if (vehicleWreck) {
          view.group.traverse(object => {
            if (object instanceof THREE.Mesh) {
              const material = object.material as THREE.MeshStandardMaterial;
              if (material.emissive) material.emissiveIntensity = 0;
            }
          });
        }
      }
      const deathProgress = unit.alive ? 0 : Math.min(1, (this.visualTime - view.deadAt) / 0.85);
      view.group.position.set(unit.x, groundY + 0.03 - deathProgress * (vehicleWreck ? 0.07 : 0.2), unit.z);
      view.group.rotation.y = unit.heading;
      view.group.rotation.z = vehicleWreck ? 0 : deathProgress * (unit.id % 2 ? 1.28 : -1.28);
      if (vehicleWreck && !unit.alive && this.visualTime >= view.smokeAt) {
        this.effects.smokePuff(unit.x, groundY + 0.85, unit.z);
        view.smokeAt = this.visualTime + 0.16 + Math.random() * 0.12;
      }
      const turret = view.group.userData.turret as THREE.Group | undefined;
      const recoil = (view.group.userData.recoil ?? turret?.userData.recoil) as THREE.Group | undefined;
      const recoilDuration = unit.kind === 'tank' ? 0.72 : unit.kind === 'artillery' ? 0.58 : 0.42;
      const recoilAttack = unit.kind === 'tank' ? 0.085 : 0.06;
      const recoilElapsed = this.visualTime - view.recoilAt;
      let kick = 0;
      if (unit.alive && recoilElapsed >= 0 && recoilElapsed < recoilDuration) {
        kick = recoilElapsed < recoilAttack ? recoilElapsed / recoilAttack : (1 - (recoilElapsed - recoilAttack) / (recoilDuration - recoilAttack)) ** 2;
      }
      kick *= this.reducedMotion ? 0.35 : 1;
      const recoilDistance = unit.kind === 'tank' ? 0.34 : unit.kind === 'artillery' ? 0.24 : unit.kind === 'missile' ? 0.14 : 0;
      const recoilPitch = unit.kind === 'tank' ? 0.075 : unit.kind === 'artillery' ? 0.055 : unit.kind === 'missile' ? 0.035 : 0;
      const bodyBack = unit.kind === 'tank' ? 0.065 : unit.kind === 'artillery' ? 0.04 : 0;
      if (recoil) {
        recoil.position.z = view.recoilBaseZ - kick * recoilDistance;
        recoil.rotation.x = -kick * recoilPitch;
      }
      if (turret) {
        turret.position.z = view.turretBaseZ - kick * bodyBack;
        turret.rotation.x = (vehicleWreck ? deathProgress * 0.2 : view.turretBaseRotationX) - kick * recoilPitch * 0.65;
      }
      const bob = unit.moving && spec.locomotion === 'foot' ? Math.sin(this.visualTime * 9 + unit.id) * 0.045 : 0;
      view.group.position.y += bob;
      const walkLegs = view.group.userData.walkLegs as THREE.Group[] | undefined;
      if (walkLegs) {
        const quad = spec.locomotion === 'quad';
        walkLegs.forEach((leg, index) => {
          const offset = quad && (index === 1 || index === 2) ? Math.PI : index === 3 ? 0 : index * Math.PI;
          leg.rotation.x = unit.moving ? Math.sin(this.visualTime * (quad ? 5.5 : 5) + unit.id + offset) * (quad ? 0.13 : 0.34) : 0;
        });
      } else {
        const legs = [view.group.userData.leftLeg, view.group.userData.rightLeg] as (THREE.Group | undefined)[];
        if (legs[0] && legs[1]) {
          const swing = unit.moving ? Math.sin(this.visualTime * 9 + unit.id) * 0.34 : 0;
          legs[0].rotation.x = swing;
          legs[1].rotation.x = -swing;
        }
      }
      view.ring.position.set(unit.x, groundY + 0.075, unit.z);
      view.ring.visible = unit.alive;
      const selected = selectedId === unit.id;
      const ringMaterial = view.ring.material as THREE.MeshBasicMaterial;
      ringMaterial.color.set(selected ? 0xf0b653 : unit.team === 'player' ? 0x65c6cf : 0xcf6652);
      ringMaterial.opacity = selected ? 0.95 : 0.58;
      this.updateLabel(unit.id, view, groundY, phase, selected);
      this.updateAimLine(unit.id, view, groundY);
    }
    for (const [id, view] of this.views) {
      if (!this.simulation.units.some(unit => unit.id === id)) {
        this.scene.remove(view.group, view.ring);
        view.label.remove();
        this.views.delete(id);
      }
    }
    this.updateProjectiles();
    this.updateRange(selectedId, phase, overlay);
    this.effects.update(dt);
    const shake = this.effects.trauma ** 2 * 0.18;
    const original = this.camera.position.clone();
    if (shake > 0.001) {
      this.camera.position.x += Math.sin(this.visualTime * 41) * shake;
      this.camera.position.y += Math.sin(this.visualTime * 33) * shake * 0.65;
    }
    this.renderer.render(this.scene, this.camera);
    this.camera.position.copy(original);
  }

  private updateLabel(id: number, view: UnitView, groundY: number, phase: Phase, selected: boolean) {
    const unit = this.simulation.units.find(item => item.id === id)!;
    const spec = UNIT_SPECS[unit.kind];
    const visible = unit.alive && (selected || unit.hp < spec.hp || phase === 'deployment');
    view.label.style.display = visible ? '' : 'none';
    if (!visible) return;
    const height = unit.kind === 'mech' ? 4.25 : spec.locomotion === 'tracked' ? 2.4 : 2.25;
    const projected = new THREE.Vector3(unit.x, groundY + height, unit.z).project(this.camera);
    if (projected.z > 1) {
      view.label.style.display = 'none';
      return;
    }
    const x = (projected.x * 0.5 + 0.5) * this.container.clientWidth;
    const y = (-projected.y * 0.5 + 0.5) * this.container.clientHeight;
    view.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    view.label.classList.toggle('selected', selected);
    view.hpFill.style.width = `${Math.max(0, unit.hp / spec.hp * 100)}%`;
    const state = view.label.querySelector<HTMLSpanElement>('.unit-label-state')!;
    state.textContent = unit.windup > 0 ? t(unit.state) : '';
  }

  private updateAimLine(id: number, view: UnitView, groundY: number) {
    const unit = this.simulation.units.find(item => item.id === id)!;
    const target = this.simulation.units.find(item => item.id === unit.pendingTargetId && item.alive);
    let line = this.aimLines.get(id);
    if (!unit.alive || unit.windup <= 0 || !target) {
      if (line) line.visible = false;
      return;
    }
    if (!line) {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: unit.team === 'player' ? 0x8ee7ed : 0xff6855, transparent: true, opacity: 0.52, depthWrite: false }));
      this.scene.add(line);
      this.aimLines.set(id, line);
    }
    line.visible = true;
    const positions = line.geometry.attributes.position;
    positions.setXYZ(0, unit.x, groundY + 1.35, unit.z);
    positions.setXYZ(1, target.x, this.terrain.heightAt(target.x, target.z) + 0.8, target.z);
    positions.needsUpdate = true;
  }

  private updateProjectiles() {
    const ids = new Set(this.simulation.projectiles.map(projectile => projectile.id));
    for (const projectile of this.simulation.projectiles) {
      let mesh = this.projectileViews.get(projectile.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.ConeGeometry(0.14, 0.55, 6),
          new THREE.MeshBasicMaterial({ color: projectile.team === 'player' ? 0xffd18a : 0xff8a68 }),
        );
        this.scene.add(mesh);
        this.projectileViews.set(projectile.id, mesh);
      }
      mesh.position.set(projectile.x, projectile.y, projectile.z);
      const direction = new THREE.Vector3(projectile.to.x - projectile.x, projectile.to.y - projectile.y, projectile.to.z - projectile.z);
      if (direction.lengthSq() > 0.0001) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      this.effects.rocketTrail(projectile.x, projectile.y, projectile.z);
    }
    for (const [id, mesh] of this.projectileViews) {
      if (!ids.has(id)) {
        disposeObject(mesh);
        this.projectileViews.delete(id);
      }
    }
  }

  private updateRange(selectedId: number | null, phase: Phase, overlay: TerrainOverlay) {
    const unit = this.simulation.units.find(item => item.id === selectedId && item.alive);
    if (!unit || (phase !== 'deployment' && overlay !== 'sight')) {
      this.rangeLine.visible = false;
      return;
    }
    const spec = UNIT_SPECS[unit.kind];
    const range = scaledRange(spec) * (this.terrain.isHigh(unit.x, unit.z) && spec.attack !== 'melee' && spec.attack !== 'cone' ? 1.15 : 1);
    this.rangeLine.visible = true;
    const positions = this.rangeLine.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const angle = i / positions.count * Math.PI * 2;
      const x = unit.x + Math.cos(angle) * range;
      const z = unit.z + Math.sin(angle) * range;
      positions.setXYZ(i, x, this.terrain.heightAt(x, z) + 0.13, z);
    }
    positions.needsUpdate = true;
    this.rangeLine.geometry.computeBoundingSphere();
  }

  private createLighting() {
    const hemisphere = new THREE.HemisphereLight(0xb8c4d2, 0x39342c, 1.18);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xfff1d8, 3.1);
    sun.position.set(-24, 38, 19);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -46;
    sun.shadow.camera.right = sun.shadow.camera.top = 46;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 100;
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.025;
    this.scene.add(sun);
  }

  private createSky() {
    const positions: number[] = [];
    for (let i = 0; i < 1200; i++) {
      const radius = 500 + Math.random() * 400;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.49;
      positions.push(Math.cos(theta) * Math.sin(phi) * radius, Math.cos(phi) * radius, Math.sin(theta) * Math.sin(phi) * radius);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const stars = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xd6e0e8, size: 1.15, transparent: true, opacity: 0.76, fog: false, depthWrite: false }));
    this.scene.add(stars);
  }

  private createDeploymentZone() {
    const points: THREE.Vector3[] = [];
    const addSegment = (a: Vec2, b: Vec2) => {
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        const x0 = THREE.MathUtils.lerp(a.x, b.x, t0);
        const z0 = THREE.MathUtils.lerp(a.z, b.z, t0);
        const x1 = THREE.MathUtils.lerp(a.x, b.x, t1);
        const z1 = THREE.MathUtils.lerp(a.z, b.z, t1);
        points.push(new THREE.Vector3(x0, this.terrain.heightAt(x0, z0) + 0.24, z0), new THREE.Vector3(x1, this.terrain.heightAt(x1, z1) + 0.24, z1));
      }
    };
    const zones = deploymentPlan(this.terrain.missionId).zones;
    for (const zone of zones) {
      const minX = Math.min(...zone.points.map(p => p.x)), maxX = Math.max(...zone.points.map(p => p.x));
      const minZ = Math.min(...zone.points.map(p => p.z)), maxZ = Math.max(...zone.points.map(p => p.z));
      for (let x = minX + 2.8; x < maxX; x += 2.8) for (const [a, b] of deploymentGridSegments(zone, 'x', x)) addSegment(a, b);
      for (let z = minZ + 2.4; z < maxZ; z += 2.4) for (const [a, b] of deploymentGridSegments(zone, 'z', z)) addSegment(a, b);
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x4fc1c8, transparent: true, opacity: 0.28, depthWrite: false, depthTest: false }));
    lines.name = 'deployment-grid'; this.deploymentZone.add(lines);
    points.length = 0;
    for (const zone of zones) for (let i = 0; i < zone.points.length; i++) addSegment(zone.points[i], zone.points[(i + 1) % zone.points.length]);
    const border = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x89dcd5, transparent: true, opacity: 0.72, depthWrite: false, depthTest: false }));
    border.name = 'deployment-boundary'; this.deploymentZone.add(border);
    this.scene.add(this.deploymentZone);
  }

  private createOverlays(): Record<Exclude<TerrainOverlay, 'none'>, THREE.Group> {
    const terrain = new THREE.Group();
    for (const feature of this.terrain.definition?.features ?? []) if (feature.kind === 'hill') terrain.add(this.makeGroundCircle(feature.x, feature.z, feature.radius, 0xe3b45e));
    if (this.terrain.missionId !== 'tranquility') {
      for (const crater of this.terrain.craterVisuals) terrain.add(this.makeGroundCircle(crater.x, crater.z, crater.r, 0xe3b45e));
    } else {
      terrain.add(this.makeGroundCircle(-11.7, 0.2, 6.8, 0xe3b45e));
    }
    for (const zone of this.terrain.softZones) terrain.add(this.makeGroundCircle(zone.x, zone.z, zone.r, 0x9c8f7b));
    const sight = new THREE.Group();
    if (this.terrain.missionId !== 'tranquility') {
      for (const crater of this.terrain.craterVisuals) sight.add(this.makeGroundCircle(crater.x, crater.z, crater.r, 0x68cbd5));
    } else {
      sight.add(this.makeGroundCircle(-11.7, 0.2, 6.8, 0x68cbd5));
    }
    for (const rock of this.terrain.rocks.filter(rock => rock.h >= 1.45)) sight.add(this.makeGroundCircle(rock.x, rock.z, rock.r + 0.35, 0xd36b5c));
    const defense = new THREE.Group();
    for (const rock of this.terrain.rocks.filter(rock => rock.h < 1.45)) defense.add(this.makeGroundCircle(rock.x, rock.z, rock.r + 1.1, 0x73c69c));
    for (const group of [terrain, sight, defense]) {
      group.visible = false;
      this.scene.add(group);
    }
    return { terrain, sight, defense };
  }

  private makeGroundCircle(x: number, z: number, radius: number, color: number, unitCircle = false) {
    const count = unitCircle ? 128 : 96;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2;
      const px = x + Math.cos(angle) * radius;
      const pz = z + Math.sin(angle) * radius;
      positions[i * 3] = px;
      positions[i * 3 + 1] = this.terrain.heightAt(px, pz) + 0.13;
      positions[i * 3 + 2] = pz;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.72, depthWrite: false }));
  }

  private setPointer(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
  }

  private resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}

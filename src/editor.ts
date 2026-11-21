import { t, label, localizedError, languageSwitcher, bindLanguageSwitcher, onLocaleChange, translateElements, preserveFormState, routeHref } from './i18n';
import * as THREE from 'three';
import { AudioSystem } from './audio';
import { BattleSimulation } from './battle';
import { DOCTRINES, PRIORITIES, UNIT_ORDER, UNIT_SPECS, WORLD } from './data';
import { disposeObject } from './dispose';
import { cloneLevel, createLevel, FEATURE_NAMES, LevelHistory, levelCost, levelToMission, MAX_LEVEL_FEATURES, MAX_LEVEL_OBJECTS, MAX_LEVEL_UNITS, newEntityId, OBJECT_NAMES, parseLevel } from './level';
import type { FeatureKind, LevelDocument, LevelUnit, MapObject, ObjectKind, TerrainFeature } from './level';
import { insideMap, validatePlaytest } from './level-validation';
import type { LevelIssue } from './level-validation';
import { MISSIONS, MISSION_LIST } from './missions';
import type { BuiltInMissionId } from './missions';
import { BattleRenderer } from './renderer';
import { installPixelArtPreview } from './pixel-art-preview';
import { LunarTerrain } from './terrain';
import { createUnitThumbnails } from './thumbnails';
import type { Doctrine, Phase, Priority, Team, TerrainOverlay, UnitKind, Vec2 } from './types';
import './editor.css';

type Tab = 'terrain' | 'objects' | 'units';
type Tool = 'select' | 'erase' | 'unit' | FeatureKind | ObjectKind;
type Entity = { type: 'unit'; value: LevelUnit } | { type: 'feature'; value: TerrainFeature } | { type: 'object'; value: MapObject };
interface Drag { id: string; pointerId: number; offset: Vec2; point: Vec2; moved: boolean; valid: boolean }
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const degrees = (radians: number) => Math.round(((radians * 180 / Math.PI) % 360 + 360) % 360);
const time = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

export function mountEditor() { new LevelEditor(document.querySelector<HTMLDivElement>('#app')!); }

class LevelEditor {
  private history: LevelHistory;
  private terrain: LunarTerrain;
  private simulation: BattleSimulation;
  private renderer: BattleRenderer;
  private audio = new AudioSystem();
  private thumbnails: Record<UnitKind, string>;
  private unitIds = new Map<string, number>();
  private terrainJSON = '';
  private selected: string | null = null;
  private tab: Tab = 'terrain';
  private tool: Tool = 'select';
  private unitKind: UnitKind = 'rifle';
  private team: Team = 'enemy';
  private doctrine: Doctrine = 'hold';
  private priority: Priority = 'nearest';
  private radius = 6;
  private height = 2;
  private heading = 0;
  private snap = true;
  private drag: Drag | null = null;
  private guides = new THREE.Group();
  private cursor = new THREE.Group();
  private overlay: TerrainOverlay = 'none';
  private issues: LevelIssue[] = [];
  private showIssues = false;
  private testing = false;
  private paused = false;
  private speed = 1;
  private logs: (() => string)[] = [];
  private toastTimer = 0;
  private toastContent: (() => string) | null = null;
  private lastFrame = 0;
  private accumulator = 0;
  private hudTime = 0;

  constructor(private app: HTMLDivElement) {
    const queryMission = new URLSearchParams(location.search).get('mission');
    const template: BuiltInMissionId = queryMission && Object.hasOwn(MISSIONS, queryMission) ? queryMission as BuiltInMissionId : 'tranquility';
    const initial = createLevel(template);
    this.history = new LevelHistory(initial);
    document.title = t("SELENE // 关卡工坊");
    this.app.className = 'app editor-app';
    this.app.innerHTML = `
      <header class="editor-header">
        <div class="editor-brand"><span class="brand-mark" aria-hidden="true"></span><div><strong>SELENE <span>${label("/ 关卡工坊")}</span></strong><small id="editor-mode">${label("地图编辑")}</small></div></div>
        <div class="editor-header-actions">
          ${languageSwitcher()}
          <a class="secondary-button editor-link" href="${routeHref({ mission: template })}">${label("返回任务")}</a>
          <div class="editor-edit-actions"><button class="secondary-button" data-action="undo" title="${t("撤销 ⌘/Ctrl+Z")}" data-i18n-title="撤销 ⌘/Ctrl+Z">${label("撤销")}</button><button class="secondary-button" data-action="redo" title="${t("重做 ⇧⌘Z / Ctrl+Y")}" data-i18n-title="重做 ⇧⌘Z / Ctrl+Y">${label("重做")}</button><span class="editor-divider"></span><button class="secondary-button" data-action="export">${label("导出 JSON")}</button><button class="secondary-button" data-action="import">${label("导入")}</button></div>
          <button id="editor-play" class="primary-button" data-action="test">${label("试战 →")}</button>
          <button id="editor-return" class="primary-button hidden" data-action="return">${label("返回编辑")}</button>
        </div>
      </header>
      <main class="editor-workspace">
        <aside class="editor-toolbox" aria-label="${t("地图编辑工具")}" data-i18n-aria-label="地图编辑工具">
          <div class="editor-tool-switch"><button data-tool="select" class="active" title="${t("选择 / 拖动 [V]")}" data-i18n-title="选择 / 拖动 [V]">${label("选择")} <kbd>V</kbd></button><button data-tool="erase" title="${t("删除对象 [X]")}" data-i18n-title="删除对象 [X]">${label("橡皮")} <kbd>X</kbd></button></div>
          <div class="editor-tabs" role="tablist" aria-label="${t("对象类型")}" data-i18n-aria-label="对象类型"><button role="tab" data-tab="terrain">${label("地形")}</button><button role="tab" data-tab="objects">${label("建筑")}</button><button role="tab" data-tab="units">${label("兵力")}</button></div>
          <div class="editor-tool-scroll"><div id="editor-palette"></div><div id="editor-placement"></div>
            <div class="editor-section-heading"><span>${label("场景对象")}</span><span id="editor-object-count"></span></div><div id="editor-entities" class="editor-entities"></div>
          </div>
          <div class="editor-template"><label for="editor-template">${label("从模板开始")}</label><div><select id="editor-template"><option value="blank" data-i18n="空白月面">${t("空白月面")}</option>${MISSION_LIST.map(m => `<option value="${m.id}" ${template === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}</select><button class="secondary-button" data-action="template" title="${t("载入模板，可撤销")}" data-i18n-title="载入模板，可撤销">${label("载入")}</button></div><p>${label("模板中的每个对象都可移动、调整或删除。")}</p></div>
        </aside>
        <section id="editor-viewport" class="viewport editor-viewport" aria-label="${t("关卡三维编辑视口")}" data-i18n-aria-label="关卡三维编辑视口">
          <div class="editor-viewport-toolbar"><div class="tool-group"><button class="tool-button active" data-view="editor">${label("俯视")}</button><button class="tool-button" data-view="tactical">${label("战术")}</button><button class="tool-button" data-view="frontline">${label("前线")}</button></div><div class="tool-group"><button class="tool-button active" data-overlay="none">${label("标准")}</button><button class="tool-button" data-overlay="terrain">${label("地形")}</button><button class="tool-button" data-overlay="sight">${label("射界")}</button><button class="tool-button" data-overlay="defense">${label("掩体")}</button></div></div>
          <div id="editor-map-caption" class="editor-map-caption">${label("选择对象查看属性，拖动调整位置")}</div>
          <div id="editor-coordinate" class="terrain-readout">X 0.0 · Z 0.0</div>
          <div class="control-hint">${label("右键环绕 · 滚轮缩放 · 中键平移")}</div>
        </section>
        <aside class="editor-inspector" aria-label="${t("对象属性与关卡设置")}" data-i18n-aria-label="对象属性与关卡设置"><div class="editor-inspector-header"><h2 id="editor-inspector-title">${label("任务设置")}</h2><button class="editor-text-button" data-action="settings">${label("任务设置")}</button></div><div id="editor-inspector-content"></div></aside>
      </main>
      <footer class="editor-footer"><div class="editor-footer-copy"><div id="editor-summary"></div><div id="editor-save-status" role="status" aria-live="polite">${label("仅当前页面保留编辑，刷新会清空；可手动导出 JSON。")}</div></div><button id="editor-validation" class="editor-text-button" data-action="issues"></button><label class="editor-snap"><input id="editor-snap" type="checkbox" checked> ${label("吸附 0.5 m")}</label><div id="editor-test-controls" class="hidden"><button class="secondary-button" data-action="pause">${label("暂停")}</button><button class="secondary-button" data-action="step">${label("单步 1/30 秒")}</button><select id="editor-speed" aria-label="${t("试战速度")}" data-i18n-aria-label="试战速度"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select><button class="secondary-button" data-action="restart">${label("重新试战")}</button></div></footer>
      <input id="editor-import-file" type="file" accept=".json,application/json" hidden>
      <div id="editor-toast" class="toast" role="status" aria-live="polite"></div>`;
    this.terrain = new LunarTerrain('custom', cloneLevel(initial).terrain);
    this.terrainJSON = JSON.stringify(initial.terrain);
    this.simulation = new BattleSimulation(this.terrain, levelToMission(initial));
    this.mapUnitIds();
    this.renderer = new BattleRenderer(this.$('#editor-viewport'), this.terrain, this.simulation);
    installPixelArtPreview(this.renderer);
    this.renderer.setPhase('battle'); this.renderer.setEditorView();
    this.renderer.scene.add(this.guides, this.cursor);
    this.thumbnails = createUnitThumbnails();
    this.bindEvents(); this.renderAll();
    bindLanguageSwitcher(this.app);
    onLocaleChange(this.app, () => this.refreshLanguage(template));
    this.lastFrame = performance.now();
    requestAnimationFrame(this.animate);
  }

  private get level() { return this.history.current; }
  private refreshLanguage(template: BuiltInMissionId) {
    preserveFormState(this.app, () => {
      translateElements(this.app);
      document.title = t('SELENE // 关卡工坊');
      this.$<HTMLAnchorElement>('.editor-link').href = routeHref({ mission: template });
      for (const mission of MISSION_LIST) this.$<HTMLOptionElement>(`#editor-template option[value="${mission.id}"]`).textContent = mission.name;
      this.issues = validatePlaytest(this.level, this.terrain);
      this.renderPalette(); this.renderPlacement(); this.renderEntities(); this.renderInspector(); this.renderHUD();
      this.$('#editor-mode').textContent = this.testing ? t('试战调试') : t('地图编辑');
      this.updateCaption();
      if (this.$('#editor-toast').classList.contains('visible') && this.toastContent) this.$('#editor-toast').textContent = this.toastContent();
    });
  }
  private $<T extends HTMLElement = HTMLElement>(selector: string) { return this.app.querySelector<T>(selector)!; }
  private entity(id = this.selected): Entity | null {
    const unit = this.level.units.find(item => item.id === id); if (unit) return { type: 'unit', value: unit };
    const feature = this.level.terrain.features.find(item => item.id === id); if (feature) return { type: 'feature', value: feature };
    const object = this.level.terrain.objects.find(item => item.id === id); return object ? { type: 'object', value: object } : null;
  }
  private entityName(entity: Entity) { return entity.type === 'unit' ? `${entity.value.team === 'player' ? t("我方") : t("敌方")} · ${UNIT_SPECS[entity.value.kind].name}` : entity.type === 'feature' ? FEATURE_NAMES[entity.value.kind] : OBJECT_NAMES[entity.value.kind]; }
  private mapUnitIds() {
    this.unitIds.clear();
    for (const team of ['enemy', 'player'] as const) {
      const runtime = this.simulation.units.filter(unit => unit.team === team);
      this.level.units.filter(unit => unit.team === team).forEach((unit, index) => this.unitIds.set(unit.id, runtime[index].id));
    }
  }

  private syncWorld(force = false) {
    const nextTerrainJSON = JSON.stringify(this.level.terrain);
    if (nextTerrainJSON !== this.terrainJSON || force) {
      if (nextTerrainJSON !== this.terrainJSON) this.terrain = new LunarTerrain('custom', cloneLevel(this.level).terrain);
      this.terrainJSON = nextTerrainJSON;
      this.simulation = new BattleSimulation(this.terrain, levelToMission(this.level));
      this.mapUnitIds(); this.renderer.replaceWorld(this.terrain, this.simulation);
    } else {
      // Keep models / textures for property changes and unit drags.
      const liveIds = new Set(this.level.units.map(unit => unit.id));
      for (const [key, id] of this.unitIds) if (!liveIds.has(key)) { this.simulation.units = this.simulation.units.filter(unit => unit.id !== id); this.unitIds.delete(key); }
      for (const unit of this.level.units) {
        let runtime = this.simulation.units.find(item => item.id === this.unitIds.get(unit.id));
        if (runtime && (runtime.kind !== unit.kind || runtime.team !== unit.team)) { this.simulation.units = this.simulation.units.filter(item => item !== runtime); runtime = undefined; }
        if (!runtime) { runtime = this.simulation.addUnit(unit.team, unit.kind, unit.x, unit.z, unit.doctrine, unit.priority); this.unitIds.set(unit.id, runtime.id); }
        Object.assign(runtime, { x: unit.x, z: unit.z, heading: unit.heading, doctrine: unit.doctrine, priority: unit.priority, anchor: { x: unit.x, z: unit.z } });
      }
      Object.assign(this.simulation.mission, levelToMission(this.level));
      this.renderer.refreshUnits();
    }
    this.renderer.setPhase('battle'); this.renderer.setOverlay(this.overlay);
  }

  private commit(edit: (level: LevelDocument) => void) {
    if (this.testing) return;
    const next = cloneLevel(this.level); edit(next);
    try {
      if (!this.history.commit(next)) return;
      this.syncWorld(); this.renderAll();
    } catch (error) { this.toast(() => error instanceof Error ? error.message : t("无法应用修改")); this.renderInspector(); }
  }
  private replaceLevel(level: LevelDocument) {
    if (this.testing) return;
    if (this.history.commit(level)) { this.selected = null; this.tool = 'select'; this.syncWorld(); this.renderAll(); }
  }
  private renderAll() {
    this.issues = validatePlaytest(this.level, this.terrain);
    if (!this.entity()) this.selected = null;
    this.renderPalette(); this.renderPlacement(); this.renderEntities(); this.renderInspector(); this.renderHUD(); this.drawGuides();
  }

  private renderPalette() {
    for (const button of this.app.querySelectorAll<HTMLButtonElement>('[data-tab]')) { const active = button.dataset.tab === this.tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); }
    for (const button of this.app.querySelectorAll<HTMLButtonElement>('[data-tool]')) { const active = button.dataset.tool === this.tool; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); }
    const palette = this.$('#editor-palette');
    if (this.tab === 'units') palette.innerHTML = `<div class="editor-team-switch"><button data-team="enemy" class="${this.team === 'enemy' ? 'active enemy' : ''}">${label("敌方部队")}</button><button data-team="player" class="${this.team === 'player' ? 'active friendly' : ''}">${label("我方部队")}</button></div><div class="editor-unit-palette">${UNIT_ORDER.map(kind => `<button class="editor-unit-choice ${this.tool === 'unit' && this.unitKind === kind ? 'active' : ''}" data-unit="${kind}" aria-pressed="${this.tool === 'unit' && this.unitKind === kind}"><img src="${this.thumbnails[kind]}" alt="" draggable="false"><strong>${UNIT_SPECS[kind].name}</strong><span>${UNIT_SPECS[kind].cost} ${label("补给")}</span></button>`).join('')}</div>`;
    else {
      const choices = this.tab === 'terrain' ? Object.entries(FEATURE_NAMES) : Object.entries(OBJECT_NAMES);
      const subtitles: Record<string, string> = { hill: t("高度与视野"), crater: t("凹陷与坑沿"), soft: t("移动减速"), rock: t("遮挡与掩护"), wall: t("线性防御工事"), bunker: t("圆形实体建筑"), container: t("矩形障碍"), radar: t("通信设施") };
      palette.innerHTML = `<div class="editor-feature-palette">${choices.map(([kind, name]) => `<button class="editor-feature-choice ${this.tool === kind ? 'active' : ''}" data-tool="${kind}" aria-pressed="${this.tool === kind}"><span class="editor-shape shape-${kind}" aria-hidden="true"></span><strong>${name}</strong><small>${subtitles[kind]}</small></button>`).join('')}</div>`;
    }
  }

  private numberField(label: string, field: string, value: number, min: number, max: number, step: number, scope = 'field') { return `<label class="editor-field"><span>${label}</span><input type="number" data-${scope}="${field}" value="${Number(value.toFixed(2))}" min="${min}" max="${max}" step="${step}"></label>`; }
  private selectField(label: string, field: string, value: string, options: { id: string; label: string }[], scope = 'field') { return `<label class="editor-field"><span>${label}</span><select data-${scope}="${field}">${options.map(item => `<option value="${item.id}" ${item.id === value ? 'selected' : ''}>${item.label}</option>`).join('')}</select></label>`; }
  private renderPlacement() {
    let html = '';
    if (this.tool === 'unit') html = `<h3>${label("新单位战术")}</h3>${this.selectField(t("行动方式"), 'doctrine', this.doctrine, DOCTRINES, 'place')}${this.selectField(t("目标优先级"), 'priority', this.priority, PRIORITIES, 'place')}${this.numberField(t("朝向 / °"), 'heading', degrees(this.heading), 0, 359, 15, 'place')}`;
    else if (this.tool !== 'select' && this.tool !== 'erase') {
      const feature = this.tab === 'terrain';
      html = `<h3>${feature ? t("新地形参数") : t("新建筑参数")}</h3><div class="editor-field-grid">${this.numberField(feature ? t("半径 / m") : this.tool === 'wall' || this.tool === 'container' ? t("半长 / m") : t("半径 / m"), 'radius', this.radius, feature ? 1 : .4, feature ? 20 : 6, .5, 'place')}${this.tool !== 'soft' ? this.numberField(this.tool === 'crater' ? t("深度 / m") : t("高度 / m"), 'height', this.height, feature ? .1 : .3, feature ? 6 : 10, .25, 'place') : ''}${!feature ? this.numberField(t("朝向 / °"), 'heading', degrees(this.heading), 0, 359, 15, 'place') : ''}</div>`;
    }
    this.$('#editor-placement').innerHTML = html;
  }

  private renderEntities() {
    const entities: Entity[] = [...this.level.terrain.features.map(value => ({ type: 'feature' as const, value })), ...this.level.terrain.objects.map(value => ({ type: 'object' as const, value })), ...this.level.units.map(value => ({ type: 'unit' as const, value }))];
    this.$('#editor-object-count').textContent = String(entities.length);
    this.$('#editor-entities').innerHTML = entities.length ? entities.map(entity => `<button class="editor-entity ${this.selected === entity.value.id ? 'active' : ''}" data-select="${entity.value.id}" aria-pressed="${this.selected === entity.value.id}"><span class="editor-entity-dot ${entity.type === 'unit' ? entity.value.team : 'neutral'}"></span><span>${this.entityName(entity)}</span><small>${entity.value.x.toFixed(1)}, ${entity.value.z.toFixed(1)}</small></button>`).join('') : `<p class="editor-empty">${label("从上方选择工具，在地图上点击添加。")}</p>`;
  }

  private renderInspector() {
    if (this.testing) { this.renderDebug(); return; }
    const entity = this.entity();
    this.$('#editor-inspector-title').textContent = entity ? this.entityName(entity) : t("任务设置");
    let html = '';
    if (entity) {
      const value = entity.value;
      html = `<p class="editor-context">${label("拖动调整位置，也可以输入精确坐标。")}</p><div class="editor-field-grid">${this.numberField('X / m', 'x', value.x, WORLD.minX, WORLD.maxX, .5)}${this.numberField('Z / m', 'z', value.z, WORLD.minZ, WORLD.maxZ, .5)}</div>`;
      if (entity.type === 'unit') {
        html += `<img class="editor-selected-portrait" src="${this.thumbnails[entity.value.kind]}" alt="${UNIT_SPECS[entity.value.kind].name}">${this.selectField(t("阵营"), 'team', entity.value.team, [{ id: 'enemy', label: t("敌方") }, { id: 'player', label: t("我方") }])}${this.selectField(t("兵种"), 'kind', entity.value.kind, UNIT_ORDER.map(id => ({ id, label: UNIT_SPECS[id].name })))}${this.numberField(t("朝向 / °"), 'heading', degrees(entity.value.heading), 0, 359, 15)}<div class="editor-section-heading">${label("战术命令")}</div>${this.selectField(t("行动方式"), 'doctrine', entity.value.doctrine, DOCTRINES)}<p class="editor-context">${DOCTRINES.find(item => item.id === entity.value.doctrine)!.hint}</p>${this.selectField(t("目标优先级"), 'priority', entity.value.priority, PRIORITIES)}`;
      } else {
        html += `<div class="editor-field-grid">${this.numberField(entity.type === 'feature' ? t("半径 / m") : value.kind === 'wall' || value.kind === 'container' ? t("半长 / m") : t("半径 / m"), 'radius', entity.value.radius, entity.type === 'feature' ? 1 : .4, entity.type === 'feature' ? 20 : 6, .5)}${entity.value.kind !== 'soft' ? this.numberField(value.kind === 'crater' ? t("深度 / m") : t("高度 / m"), 'height', entity.value.height, entity.type === 'feature' ? 0 : .3, entity.type === 'feature' ? 6 : 10, .25) : ''}${entity.type === 'object' ? this.numberField(t("朝向 / °"), 'heading', degrees(entity.value.heading), 0, 359, 15) : ''}</div>`;
        html += `<p class="editor-context">${entity.type === 'feature' ? value.kind === 'hill' ? t("高地提高视野和直射射程；坡度过大时需要绕行。") : value.kind === 'crater' ? t("深度改变地面高度，坑沿可影响射界。") : t("进入区域后降低移动速度，履带单位受影响较小。") : value.kind === 'radar' ? t("雷达站是实体障碍，不提供额外探测加成。") : t("建筑参与碰撞。低于 1.45 m 提供掩护，更高时阻挡直射视线。")}</p>`;
      }
      html += `<div class="editor-object-actions"><button class="secondary-button" data-action="duplicate">${label("复制")}</button><button class="secondary-button danger" data-action="delete">${label("删除 [Del]")}</button></div>`;
    } else {
      html = `<label class="editor-field"><span>${label("任务名称")}</span><input data-level="name" value="${escape(this.level.name)}" maxlength="48"></label><div class="editor-field-grid">${this.numberField(t("补给配额"), 'budget', this.level.budget, 1, 999, 1, 'level')}${this.numberField(t("时间上限 / 秒"), 'timeLimit', this.level.timeLimit, 10, 1800, 10, 'level')}</div><div class="editor-rule"><span>${label("胜利条件")}</span><strong>${label("消灭全部敌军")}</strong><p>${label("双方都可在全图布置。每次试战从当前编队开始，不改变草稿。")}</p></div><div class="editor-section-heading">${label("编辑快捷键")}</div><dl class="editor-shortcuts"><dt>${label("选择 / 橡皮")}</dt><dd>V / X</dd><dt>${label("旋转 45°")}</dt><dd>R</dd><dt>${label("删除选中")}</dt><dd>Delete</dd><dt>${label("撤销 / 重做")}</dt><dd>⌘Z / ⇧⌘Z</dd><dt>${label("开始试战")}</dt><dd>⌘↵ / Ctrl+↵</dd></dl>`;
    }
    if (this.issues.length) html += `<div class="editor-issues"><button class="editor-text-button" data-action="issues">${this.issues.length} ${label("项试战检查待处理")} ${this.showIssues ? '−' : '+'}</button>${this.showIssues ? `<ul>${this.issues.map(issue => `<li>${issue.id ? `<button data-select="${issue.id}">${escape(issue.message)}</button>` : escape(issue.message)}</li>`).join('')}</ul>` : ''}</div>`;
    this.$('#editor-inspector-content').innerHTML = html;
  }

  private renderHUD() {
    const player = this.testing ? this.simulation.units.filter(u => u.team === 'player' && u.alive).length : this.level.units.filter(u => u.team === 'player').length;
    const enemy = this.testing ? this.simulation.units.filter(u => u.team === 'enemy' && u.alive).length : this.level.units.filter(u => u.team === 'enemy').length;
    this.$('#editor-summary').textContent = this.testing ? t("{p0} · {p1} · 我方 {p2} / 敌方 {p3}", { p0: this.simulation.ended ? this.simulation.victory ? t("我方胜利") : t("我方失败 / 超时") : this.paused ? t("试战已暂停") : t("试战进行中"), p1: time(this.simulation.stats.time), p2: player, p3: enemy }) : t("我方 {p0} / 敌方 {p1} · 补给 {p2} / {p3}", { p0: player, p1: enemy, p2: levelCost(this.level), p3: this.level.budget });
    this.$('#editor-summary').classList.toggle('editor-error', !this.testing && levelCost(this.level) > this.level.budget);
    const status = this.$('#editor-save-status');
    status.textContent = t('仅当前页面保留编辑，刷新会清空；可手动导出 JSON。');
    this.$('#editor-validation').textContent = this.testing ? '' : this.issues.length ? t("{p0} 项待处理", { p0: this.issues.length }) : t("✓ 可以试战");
    this.$('#editor-validation').classList.toggle('editor-error', this.issues.length > 0);
    for (const action of ['undo', 'redo'] as const) this.$<HTMLButtonElement>(`[data-action="${action}"]`).disabled = this.testing || !(action === 'undo' ? this.history.canUndo : this.history.canRedo);
    this.$<HTMLButtonElement>('[data-action="pause"]').textContent = this.paused ? t("继续") : t("暂停");
    this.$<HTMLButtonElement>('[data-action="pause"]').disabled = this.simulation.ended;
    this.$<HTMLButtonElement>('[data-action="step"]').disabled = !this.paused || this.simulation.ended;
  }

  private setTool(tool: Tool) {
    if (this.testing) return;
    this.tool = tool; this.selected = null; this.renderer.setGhost(null); this.cursor.visible = false;
    if (tool === 'hill' || tool === 'crater' || tool === 'soft') { this.radius = 6; this.height = tool === 'soft' ? 0 : 2; }
    else if (tool !== 'select' && tool !== 'erase' && tool !== 'unit') { this.radius = tool === 'wall' ? 3 : 1.6; this.height = tool === 'radar' ? 5 : tool === 'wall' ? 1.1 : 2; }
    this.updateCaption();
    this.renderer.canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair'; this.renderPalette(); this.renderPlacement(); this.renderEntities(); this.renderInspector(); this.drawGuides();
  }
  private updateCaption() {
    const tool = this.tool;
    this.$('#editor-map-caption').textContent = this.testing ? t('点击单位查看实时状态 · 空格暂停 · 支持单步调试') : tool === 'select' ? t('选择对象查看属性，拖动调整位置') : tool === 'erase' ? t('点击对象删除 · 可撤销') : t('点击地图放置{p0} · Esc 返回选择', { p0: tool === 'unit' ? this.team === 'enemy' ? t('敌方单位') : t('我方单位') : FEATURE_NAMES[tool as FeatureKind] ?? OBJECT_NAMES[tool as ObjectKind] });
  }
  private select(id: string | null) {
    this.selected = id; this.tool = 'select'; this.renderer.setGhost(null); this.cursor.visible = false;
    this.renderPalette(); this.renderPlacement(); this.renderEntities(); this.renderInspector(); this.drawGuides();
  }
  private snapped(point: Vec2) { return this.snap ? { x: Math.round(point.x * 2) / 2, z: Math.round(point.z * 2) / 2 } : point; }
  private canPlaceUnit(kind: UnitKind, point: Vec2, ignore?: string) {
    const radius = UNIT_SPECS[kind].radius;
    return this.terrain.isWalkable(point.x, point.z, radius) && !this.level.units.some(u => u.id !== ignore && Math.hypot(point.x - u.x, point.z - u.z) < radius + UNIT_SPECS[u.kind].radius + .08);
  }
  private place(point: Vec2) {
    point = this.snapped(point);
    if (!insideMap(point.x, point.z)) { this.toast(() => t("请在地图边界内放置")); return; }
    const id = newEntityId();
    if (this.tool === 'unit') {
      if (this.level.units.length >= MAX_LEVEL_UNITS) { this.toast(() => t("双方单位最多 {p0} 个", { p0: MAX_LEVEL_UNITS })); return; }
      if (!this.canPlaceUnit(this.unitKind, point)) { this.toast(() => t("站位与单位、障碍或地图边界重叠")); return; }
      this.commit(level => level.units.push({ id, ...point, kind: this.unitKind, team: this.team, doctrine: this.doctrine, priority: this.priority, heading: this.heading }));
    } else if (['hill', 'crater', 'soft'].includes(this.tool)) {
      if (this.level.terrain.features.length >= MAX_LEVEL_FEATURES) { this.toast(() => t("地形区域最多 {p0} 个", { p0: MAX_LEVEL_FEATURES })); return; }
      this.commit(level => level.terrain.features.push({ id, ...point, kind: this.tool as FeatureKind, radius: this.radius, height: this.height }));
    } else if (this.tool !== 'select' && this.tool !== 'erase') {
      if (this.level.terrain.objects.length >= MAX_LEVEL_OBJECTS) { this.toast(() => t("建筑与岩体最多 {p0} 个", { p0: MAX_LEVEL_OBJECTS })); return; }
      this.commit(level => level.terrain.objects.push({ id, ...point, kind: this.tool as ObjectKind, radius: this.radius, height: this.height, heading: this.heading }));
    }
  }
  private deleteSelected(id = this.selected) {
    if (!id) return;
    this.commit(level => { level.units = level.units.filter(item => item.id !== id); level.terrain.features = level.terrain.features.filter(item => item.id !== id); level.terrain.objects = level.terrain.objects.filter(item => item.id !== id); });
  }
  private duplicate() {
    const entity = this.entity(); if (!entity) return;
    const limits = { unit: [this.level.units.length, MAX_LEVEL_UNITS], feature: [this.level.terrain.features.length, MAX_LEVEL_FEATURES], object: [this.level.terrain.objects.length, MAX_LEVEL_OBJECTS] };
    if (limits[entity.type][0] >= limits[entity.type][1]) { this.toast(() => t("对象数量已达上限")); return; }
    const copy = { ...entity.value, id: newEntityId(), x: Math.min(WORLD.maxX, entity.value.x + 3), z: Math.min(WORLD.maxZ, entity.value.z + 3) };
    this.commit(level => {
      if (entity.type === 'unit') level.units.push(copy as LevelUnit);
      else if (entity.type === 'feature') level.terrain.features.push(copy as TerrainFeature);
      else level.terrain.objects.push(copy as MapObject);
    });
    this.select(copy.id);
  }
  private rotate() {
    const entity = this.entity();
    if (entity && entity.type !== 'feature') this.commit(level => { const item = [...level.units, ...level.terrain.objects].find(item => item.id === entity.value.id)!; item.heading = (item.heading + Math.PI / 4) % (Math.PI * 2); });
    else { this.heading = (this.heading + Math.PI / 4) % (Math.PI * 2); this.renderPlacement(); }
  }

  private undo(redo = false) {
    if (this.testing) return;
    this.cancelDrag();
    if (redo ? this.history.redo() : this.history.undo()) { this.syncWorld(); this.renderAll(); this.toast(() => redo ? t("已重做") : t("已撤销")); }
  }
  private export() {
    const blob = new Blob([JSON.stringify(this.level, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `${this.level.name.replace(/[^\p{L}\p{N}_-]/gu, '_')}.selene.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000); this.toast(() => t("已导出当前关卡 JSON"));
  }
  private async import(file: File) {
    try {
      if (file.size > 2_000_000) throw localizedError(() => t("关卡文件超过 2 MB"));
      const level = parseLevel(await file.text());
      if (this.testing) { this.toast(() => t("请先返回编辑再导入")); return; }
      this.replaceLevel(level); this.toast(() => t("已导入关卡，可撤销"));
    } catch (error) { this.toast(() => t("导入失败：{p0}", { p0: error instanceof Error ? error.message : t("无法读取文件") })); }
  }

  private startTest() {
    if (this.testing) return;
    this.cancelDrag();
    this.issues = validatePlaytest(this.level, this.terrain);
    if (this.issues.length) { this.showIssues = true; this.select(this.issues[0].id ?? null); this.toast(() => t("无法试战：{p0}", { p0: this.issues[0].message })); return; }
    this.testing = true; this.paused = false; this.speed = Number(this.$<HTMLSelectElement>('#editor-speed').value);
    this.logs = [() => t("试战开始 · 当前编队与战术已锁定")]; this.selected = null;
    this.syncWorld(true); this.simulation.start();
    this.simulation.onEnd = victory => {
      const timestamp = time(this.simulation.stats.time);
      this.logs.push(() => `${timestamp} · ${victory ? t("我方胜利") : t("我方失败 / 达到时间上限")}`);
      this.renderInspector(); this.renderHUD();
    };
    this.accumulator = 0; this.app.classList.add('editor-testing');
    this.$('#editor-play').classList.add('hidden'); this.$('#editor-return').classList.remove('hidden'); this.$('#editor-test-controls').classList.remove('hidden');
    this.$('#editor-mode').textContent = t("试战调试"); this.$('#editor-map-caption').textContent = t("点击单位查看实时状态 · 空格暂停 · 支持单步调试");
    this.renderer.setGhost(null); this.cursor.visible = false; this.guides.visible = false;
    this.renderInspector(); this.renderHUD(); this.audio.click(true);
  }
  private returnToEdit() {
    if (!this.testing) return;
    this.testing = false; this.paused = false; this.selected = null; this.accumulator = 0;
    this.syncWorld(true); this.app.classList.remove('editor-testing'); this.$('#editor-play').classList.remove('hidden'); this.$('#editor-return').classList.add('hidden'); this.$('#editor-test-controls').classList.add('hidden');
    this.$('#editor-mode').textContent = t("地图编辑"); this.guides.visible = true; this.setTool('select'); this.renderAll();
  }
  private restart() { this.returnToEdit(); this.startTest(); }
  private step() { if (this.testing && this.paused && !this.simulation.ended) { this.simulation.update(1 / 30); this.processEvents(); this.renderInspector(); this.renderHUD(); } }
  private togglePause() { if (!this.testing || this.simulation.ended) return; this.paused = !this.paused; this.accumulator = 0; this.renderHUD(); }

  private renderDebug() {
    const unit = this.simulation.units.find(item => item.id === this.unitIds.get(this.selected ?? ''));
    this.$('#editor-inspector-title').textContent = t("试战监视");
    const target = this.simulation.units.find(item => item.id === unit?.targetId);
    this.$('#editor-inspector-content').innerHTML = `<div class="editor-debug-metrics"><div><span>${label("交战时间")}</span><strong>${this.simulation.stats.time.toFixed(2)} s</strong></div><div><span>${label("累计伤害")}</span><strong>${Math.round(this.simulation.stats.damage)}</strong></div><div><span>${label("我方击毁")}</span><strong>${this.simulation.stats.playerKills}</strong></div><div><span>${label("敌方击毁")}</span><strong>${this.simulation.stats.enemyKills}</strong></div></div>${unit ? `<h3 class="editor-debug-unit">${unit.team === 'player' ? t("我方") : t("敌方")} · ${UNIT_SPECS[unit.kind].name}</h3><dl class="editor-debug-values"><dt>${label("结构")}</dt><dd>${Math.max(0, unit.hp).toFixed(1)} / ${UNIT_SPECS[unit.kind].hp}</dd><dt>${label("状态")}</dt><dd>${unit.alive ? escape(t(unit.state)) : t("已摧毁")}</dd><dt>${label("坐标")}</dt><dd>${unit.x.toFixed(2)}, ${unit.z.toFixed(2)}</dd><dt>${label("当前目标")}</dt><dd>${target ? UNIT_SPECS[target.kind].name : t("无")}</dd><dt>${label("行动方式")}</dt><dd>${DOCTRINES.find(d => d.id === unit.doctrine)!.label}</dd><dt>${label("优先级")}</dt><dd>${PRIORITIES.find(p => p.id === unit.priority)!.label}</dd><dt>${label("攻击冷却")}</dt><dd>${unit.cooldown.toFixed(2)} s</dd><dt>${label("造成伤害")}</dt><dd>${Math.round(unit.damageDealt)}</dd></dl>` : `<p class="editor-context">${label("点击战场上的单位，查看状态、目标、冷却与伤害。")}</p>`}<div class="editor-section-heading">${label("战斗记录")}</div><ol class="editor-log">${this.logs.slice(-12).reverse().map(log => `<li>${escape(log())}</li>`).join('')}</ol><p class="editor-context">${label("返回编辑后恢复完整编队，可继续调整并再次试战。")}</p>`;
  }
  private processEvents() {
    for (const event of this.simulation.drainEvents()) {
      const timestamp = time(this.simulation.stats.time);
      if (event.type === 'notice') this.logs.push(() => `${timestamp} · ${t(event.messageKey ?? event.text, event.values)}`);
      else {
        this.renderer.handleEvent(event); this.audio.playEvent(event);
        if (event.type === 'death') this.logs.push(() => t("{p0} · {p1}{p2}被摧毁", { p0: timestamp, p1: event.team === 'player' ? t("我方") : t("敌方"), p2: UNIT_SPECS[event.kind].name }));
      }
    }
    if (this.logs.length > 80) this.logs = this.logs.slice(-40);
  }

  private ring(point: Vec2, radius: number, color: number) {
    const positions: THREE.Vector3[] = [];
    for (let i = 0; i < 80; i++) { const angle = i / 80 * Math.PI * 2, x = point.x + Math.cos(angle) * radius, z = point.z + Math.sin(angle) * radius; positions.push(new THREE.Vector3(x, this.terrain.heightAt(x, z) + .16, z)); }
    return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(positions), new THREE.LineBasicMaterial({ color, transparent: true, opacity: .8, depthTest: false, depthWrite: false }));
  }
  private clearGroup(group: THREE.Group) { for (const child of [...group.children]) disposeObject(child); }
  private drawGuides() {
    this.clearGroup(this.guides);
    if (this.testing) return;
    const positions: THREE.Vector3[] = [];
    for (let x = WORLD.minX; x <= WORLD.maxX; x += 5) for (let z = WORLD.minZ; z < WORLD.maxZ; z++) positions.push(new THREE.Vector3(x, this.terrain.heightAt(x, z) + .1, z), new THREE.Vector3(x, this.terrain.heightAt(x, z + 1) + .1, z + 1));
    for (let z = WORLD.minZ; z <= WORLD.maxZ; z += 5) for (let x = WORLD.minX; x < WORLD.maxX; x++) positions.push(new THREE.Vector3(x, this.terrain.heightAt(x, z) + .1, z), new THREE.Vector3(x + 1, this.terrain.heightAt(x + 1, z) + .1, z));
    this.guides.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(positions), new THREE.LineBasicMaterial({ color: 0x8ba5aa, transparent: true, opacity: .16, depthWrite: false })));
    for (const feature of this.level.terrain.features) this.guides.add(this.ring(feature, feature.radius, this.selected === feature.id ? 0xe4ad52 : feature.kind === 'soft' ? 0x9b9479 : 0x6e8f97));
    const selected = this.entity();
    if (selected?.type === 'object') this.guides.add(this.ring(selected.value, selected.value.radius + .3, 0xe4ad52));
  }
  private showCursor(point: Vec2, radius: number, valid: boolean) {
    this.clearGroup(this.cursor); this.cursor.add(this.ring(point, Math.max(.4, radius), valid ? 0x70c8ce : 0xd46b58)); this.cursor.visible = true;
  }
  private pick(clientX: number, clientY: number, point: Vec2 | null) {
    const unit = this.renderer.pickUnit(clientX, clientY);
    if (unit !== null) { const entry = [...this.unitIds].find(([, id]) => id === unit); if (entry) return entry[0]; }
    if (this.testing) return null;
    const object = this.renderer.pickMapObject(clientX, clientY); if (object) return object;
    if (point) {
      const features = this.level.terrain.features.filter(feature => Math.hypot(point.x - feature.x, point.z - feature.z) <= feature.radius).sort((a, b) => Math.hypot(point.x - a.x, point.z - a.z) / a.radius - Math.hypot(point.x - b.x, point.z - b.z) / b.radius);
      if (features[0]) return features[0].id;
    }
    return null;
  }
  private cancelDrag() {
    if (!this.drag) return;
    const entity = this.entity(this.drag.id), runtime = this.simulation.units.find(unit => unit.id === this.unitIds.get(this.drag!.id));
    if (runtime && entity) { runtime.x = entity.value.x; runtime.z = entity.value.z; }
    if (this.renderer.canvas.hasPointerCapture(this.drag.pointerId)) this.renderer.canvas.releasePointerCapture(this.drag.pointerId);
    this.drag = null; this.cursor.visible = false;
  }

  private bindEvents() {
    this.app.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('button'); if (!button) return;
      const action = button.dataset.action;
      if (action === 'return') this.returnToEdit();
      if (action === 'pause') this.togglePause();
      if (action === 'step') this.step();
      if (action === 'restart') this.restart();
      if (button.dataset.select) this.select(button.dataset.select);
      if (button.dataset.view) {
        if (button.dataset.view === 'editor') this.renderer.setEditorView(); else this.renderer.setCameraMode(button.dataset.view as 'tactical' | 'frontline');
        this.app.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('active', (item as HTMLElement).dataset.view === button.dataset.view));
      }
      if (button.dataset.overlay) { this.overlay = button.dataset.overlay as TerrainOverlay; this.renderer.setOverlay(this.overlay); this.app.querySelectorAll('[data-overlay]').forEach(item => item.classList.toggle('active', (item as HTMLElement).dataset.overlay === this.overlay)); }
      if (this.testing) return;
      if (button.dataset.tab) { this.tab = button.dataset.tab as Tab; this.setTool('select'); }
      if (button.dataset.tool) this.setTool(button.dataset.tool as Tool);
      if (button.dataset.unit) { this.unitKind = button.dataset.unit as UnitKind; this.setTool('unit'); }
      if (button.dataset.team) { this.team = button.dataset.team as Team; this.heading = this.team === 'player' ? Math.PI : 0; this.doctrine = this.team === 'enemy' ? 'hold' : 'advance'; this.setTool('unit'); }
      if (action === 'test') this.startTest();
      if (action === 'undo') this.undo(); if (action === 'redo') this.undo(true);
      if (action === 'export') this.export();
      if (action === 'import') this.$<HTMLInputElement>('#editor-import-file').click();
      if (action === 'delete') this.deleteSelected(); if (action === 'duplicate') this.duplicate();
      if (action === 'settings') this.select(null);
      if (action === 'issues') { this.showIssues = !this.showIssues; this.renderInspector(); }
      if (action === 'template') { const template = this.$<HTMLSelectElement>('#editor-template').value as BuiltInMissionId | 'blank'; this.replaceLevel(createLevel(template)); this.renderer.setEditorView(); this.toast(() => t("模板已载入，可撤销")); }
    });
    this.app.addEventListener('change', event => {
      const input = event.target as HTMLInputElement;
      if (input.id === 'editor-speed') this.speed = Number(input.value);
      if (this.testing) return;
      if (input.id === 'editor-import-file') { if (input.files?.[0]) void this.import(input.files[0]); input.value = ''; return; }
      if (input.id === 'editor-snap') this.snap = input.checked;
      if (input.dataset.place) {
        const field = input.dataset.place;
        if (field === 'doctrine') this.doctrine = input.value as Doctrine;
        if (field === 'priority') this.priority = input.value as Priority;
        if (field === 'radius' || field === 'height' || field === 'heading') {
          const value = Number(input.value);
          if (!input.value || !Number.isFinite(value) || value < Number(input.min) || value > Number(input.max)) { this.toast(() => t("请输入范围内的数值")); this.renderPlacement(); return; }
          if (field === 'heading') this.heading = value * Math.PI / 180; else this[field] = value;
        }
      }
      const levelField = input.dataset.level;
      if (levelField === 'name') this.commit(level => { level.name = input.value; });
      if (levelField === 'budget' || levelField === 'timeLimit') this.commit(level => { level[levelField] = input.value ? Number(input.value) : NaN; });
      const field = input.dataset.field, entity = this.entity();
      if (field && entity) this.commit(level => {
        const target = [...level.units, ...level.terrain.features, ...level.terrain.objects].find(item => item.id === entity.value.id)!;
        if (['kind', 'team', 'doctrine', 'priority'].includes(field)) Object.assign(target, { [field]: input.value });
        else if (['x', 'z', 'radius', 'height', 'heading'].includes(field)) Object.assign(target, { [field]: input.value ? Number(input.value) * (field === 'heading' ? Math.PI / 180 : 1) : NaN });
      });
    });
    const canvas = this.renderer.canvas;
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('pointerdown', event => {
      void this.audio.ensureStarted();
      if (event.button === 1 || event.button === 2) { this.renderer.setCameraMode('free'); this.app.querySelectorAll('[data-view]').forEach(button => button.classList.remove('active')); return; }
      if (event.button !== 0) return;
      const point = this.renderer.screenToGround(event.clientX, event.clientY);
      if (this.testing) { this.select(this.pick(event.clientX, event.clientY, point)); return; }
      if (this.tool !== 'select' && this.tool !== 'erase') { if (point) this.place(point); return; }
      const id = this.pick(event.clientX, event.clientY, point);
      if (this.tool === 'erase') { this.deleteSelected(id); return; }
      this.select(id); const entity = this.entity();
      if (entity && point) { this.drag = { id: entity.value.id, pointerId: event.pointerId, offset: { x: entity.value.x - point.x, z: entity.value.z - point.z }, point: { x: entity.value.x, z: entity.value.z }, valid: true, moved: false }; canvas.setPointerCapture(event.pointerId); }
    }, { capture: true });
    canvas.addEventListener('wheel', () => { this.renderer.setCameraMode('free'); this.app.querySelectorAll('[data-view]').forEach(button => button.classList.remove('active')); }, { passive: true, capture: true });
    canvas.addEventListener('pointermove', event => {
      const point = this.renderer.screenToGround(event.clientX, event.clientY); if (!point) return;
      this.$('#editor-coordinate').textContent = `X ${point.x.toFixed(1)} · Z ${point.z.toFixed(1)} · H ${this.terrain.heightAt(point.x, point.z).toFixed(2)} m`;
      if (this.testing) return;
      if (this.drag) {
        const entity = this.entity(this.drag.id); if (!entity) return;
        const desired = this.snapped({ x: point.x + this.drag.offset.x, z: point.z + this.drag.offset.z });
        const valid = insideMap(desired.x, desired.z) && (entity.type !== 'unit' || this.canPlaceUnit(entity.value.kind, desired, entity.value.id));
        this.drag.point = desired; this.drag.valid = valid; this.drag.moved = Math.hypot(desired.x - entity.value.x, desired.z - entity.value.z) > .05;
        if (entity.type === 'unit' && valid) { const unit = this.simulation.units.find(unit => unit.id === this.unitIds.get(entity.value.id))!; unit.x = desired.x; unit.z = desired.z; }
        this.showCursor(desired, entity.type === 'unit' ? UNIT_SPECS[entity.value.kind].radius : entity.value.radius, valid);
      } else if (this.tool === 'unit') {
        const desired = this.snapped(point), valid = this.canPlaceUnit(this.unitKind, desired);
        this.renderer.setGhost(this.unitKind, desired, valid, this.team, this.heading); canvas.style.cursor = valid ? 'crosshair' : 'not-allowed';
      } else if (this.tool !== 'select' && this.tool !== 'erase') this.showCursor(this.snapped(point), this.radius, insideMap(point.x, point.z));
    });
    canvas.addEventListener('pointerup', event => {
      const drag = this.drag; if (!drag || event.pointerId !== drag.pointerId) return;
      this.cancelDrag();
      if (drag.moved && drag.valid) this.commit(level => { const target = [...level.units, ...level.terrain.features, ...level.terrain.objects].find(item => item.id === drag.id)!; target.x = drag.point.x; target.z = drag.point.z; });
    });
    canvas.addEventListener('pointercancel', () => this.cancelDrag());
    canvas.addEventListener('lostpointercapture', () => { if (this.drag) this.cancelDrag(); });
    canvas.addEventListener('pointerleave', () => { if (!this.drag) { this.renderer.setGhost(null); this.cursor.visible = false; canvas.style.cursor = this.tool === 'select' ? 'default' : 'crosshair'; } });
    document.addEventListener('keydown', event => {
      const editable = (event.target as HTMLElement).closest('input, select, textarea, [contenteditable="true"]');
      if (editable) return;
      if (event.key === 'Escape') { this.cancelDrag(); if (!this.testing) this.setTool('select'); return; }
      if (this.testing) { if (event.code === 'Space') { event.preventDefault(); this.togglePause(); } if (event.key === '.') this.step(); return; }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); this.startTest(); return; }
      if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); this.undo(event.shiftKey || event.key.toLowerCase() === 'y'); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); this.duplicate(); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); this.deleteSelected(); }
      if (event.key.toLowerCase() === 'r') this.rotate();
      if (event.key.toLowerCase() === 'v') this.setTool('select'); if (event.key.toLowerCase() === 'x') this.setTool('erase');
    });
  }

  private toast(render: () => string) { this.toastContent = render; const toast = this.$('#editor-toast'); toast.textContent = render(); toast.classList.add('visible'); window.clearTimeout(this.toastTimer); this.toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 4200); }
  private animate = (now: number) => {
    const dt = Math.min(.05, (now - this.lastFrame) / 1000); this.lastFrame = now;
    if (this.testing && !this.paused && !this.simulation.ended) {
      this.accumulator += dt * this.speed;
      while (this.accumulator >= 1 / 30 && !this.simulation.ended) { this.simulation.update(1 / 30); this.accumulator -= 1 / 30; }
      this.processEvents();
    } else this.accumulator = 0;
    const phase: Phase = this.testing ? this.simulation.ended ? this.simulation.victory ? 'victory' : 'defeat' : 'battle' : 'deployment';
    this.renderer.update(this.testing && this.paused ? 0 : dt, phase, this.unitIds.get(this.selected ?? '') ?? null, this.overlay);
    this.hudTime += dt;
    if (this.hudTime > .2) { if (this.testing) this.renderDebug(); this.renderHUD(); this.hudTime = 0; }
    requestAnimationFrame(this.animate);
  };
}

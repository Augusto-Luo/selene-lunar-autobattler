import { advanceCampaign, CAMPAIGN_STARTING_FUNDS, campaignComplete, campaignSpent, newCampaign, recordVictory, recruit, retryStage, withdraw } from './campaign';
import { t, label, languageSwitcher, bindLanguageSwitcher, onLocaleChange, translateElements, routeHref } from './i18n';
import { COMBAT_TUNING, DOCTRINES, PRIORITIES, UNIT_ORDER, UNIT_SPECS, scaledRange } from './data';
import { MISSION_LIST } from './missions';
import { LunarTerrain } from './terrain';
import { BattleSimulation } from './battle';
import { BattleRenderer } from './renderer';
import { installPixelArtPreview } from './pixel-art-preview';
import { AudioSystem } from './audio';
import { createUnitThumbnails } from './thumbnails';
import type { CameraMode, Doctrine, Phase, Priority, TerrainOverlay, UnitKind, Vec2 } from './types';
import type { LoadingReporter } from './loading';
import { DeploymentTutorial } from './tutorial';
import { deploymentPlan } from './deployment';
import type { TutorialRect, TutorialStep } from './tutorial';
import './onboarding.css';

export async function mountGame(report?: LoadingReporter) {
interface PlayerSetup {
  campaignId: string;
  kind: UnitKind;
  x: number;
  z: number;
  heading: number;
  doctrine: Doctrine;
  priority: Priority;
}

let campaign = newCampaign();
// Campaign progress decides the stage. A URL cannot skip or revisit a battle.
let currentMission = MISSION_LIST[campaign.stage];
try { window.history.replaceState(window.history.state, '', routeHref({ mission: currentMission.id })); } catch { /* file:// history can be restricted. */ }
document.title = `SELENE // ${currentMission.name}`;
const appElement = document.querySelector<HTMLDivElement>('#app')!;
appElement.className = 'app';
appElement.innerHTML = `
  <header class="topbar">
    <div class="brand"><span class="brand-mark"></span><div><span class="brand-name">SELENE</span><span class="brand-sub">${label("月面战术指挥系统")}</span></div></div>
    <div class="mission-heading"><span class="mission-number">${currentMission.code}</span><span class="mission-title">${currentMission.name}</span><div class="mission-switch">${MISSION_LIST.map((mission, index) => `<button class="mission-tab ${index === campaign.stage ? 'active' : ''} ${index < campaign.stage ? 'completed' : ''}" data-mission-stage="${index}" aria-current="${index === campaign.stage ? 'step' : 'false'}" disabled>${mission.index}</button>`).join('')}</div><span id="phase-chip" class="phase-chip">${label("战前部署")}</span></div>
    <div class="top-status">
      ${languageSwitcher()}
      <a class="editor-entry" href="${routeHref({ editor: 1, mission: currentMission.id })}">${label("关卡编辑器")}</a>
      <div class="status-block"><span class="status-label">${label("敌方存活")}</span><span id="enemy-count" class="status-value">09</span></div>
      <div id="wave-status" class="status-block"><span class="status-label">${label("围攻波次")}</span><span id="wave-count" class="status-value">1 / 1</span></div>
      <div class="status-block"><span id="resource-label" class="status-label">${label("部署单位")}</span><span id="unit-count" class="status-value">08</span></div>
      <button id="audio-button" class="icon-button" aria-label="${t("关闭声音")}" data-i18n-aria-label="关闭声音" title="${t("声音开关")}" data-i18n-title="声音开关">${label("音")}</button>
      <button id="help-button" class="icon-button" aria-label="${t("查看操作说明")}" data-i18n-aria-label="查看操作说明" title="${t("操作说明")}" data-i18n-title="操作说明">?</button>
    </div>
  </header>
  <main class="workspace">
    <aside class="side-panel roster-panel">
      <div class="panel-header">
        <span class="eyebrow">${label('TASK FORCE')}</span><h2 class="panel-title">${label("作战编队")}</h2>
        <p class="panel-subtitle">${label("选择兵种后，点击青色部署区放置。")}</p>
        <div class="budget-line"><span class="status-label">${label("战役资金")}</span><span class="budget-value"><span id="budget-remaining">${campaign.funds}</span><small> / ${CAMPAIGN_STARTING_FUNDS}</small></span></div>
        <div class="budget-track"><span id="budget-fill"></span></div><p id="campaign-economy" class="panel-subtitle"></p>
      </div>
      <div id="roster" class="roster"></div><div id="campaign-reserves" class="campaign-reserves"></div>
      <div class="roster-footer"><strong>${label("本关重点 ·")} ${currentMission.focus}</strong><br>${currentMission.objective}</div>
    </aside>
    <section id="viewport" class="viewport" tabindex="-1" aria-label="${t("战场视口")}" data-i18n-aria-label="战场视口">
      <div class="viewport-tools"><div class="tool-group" id="terrain-tools">
        <button class="tool-button active" data-overlay="none">${label("标准")}</button>
        <button class="tool-button" data-overlay="terrain">${label("地形")}</button>
        <button class="tool-button" data-overlay="sight">${label("射界")}</button>
        <button class="tool-button" data-overlay="defense">${label("掩体")}</button>
      </div></div>
      <div class="camera-tools"><div class="tool-group" id="camera-tools">
        <button class="tool-button active" data-camera="tactical">${label("01 战术")}</button>
        <button class="tool-button" data-camera="frontline">${label("02 前线")}</button>
        <button class="tool-button" data-camera="free">${label("03 自由")}</button>
      </div></div>
      <div class="deployment-banner">${t(deploymentPlan(currentMission.id).hint)}</div>
      <div id="terrain-readout" class="terrain-readout">${currentMission.name}<br>${label("选择单位查看射程与阵地效果")}</div>
      <div class="control-hint">${label("右键环绕 · 滚轮缩放 · 中键平移")}</div>
    </section>
  </main>
  <footer class="actionbar">
    <div class="deployment-controls action-status"><div id="action-title" class="action-status-title">${label("编队已就绪，可调整站位与命令")}</div><div id="action-subtitle" class="action-status-sub">${label("高地强化射程与视野；低岩体提供方向性掩护。")}</div></div>
    <div class="deployment-controls action-buttons"><button id="restart-campaign" class="secondary-button">${label("重新开始战役")}</button><button id="clear-button" class="secondary-button">${label("撤回全部")}</button></div>
    <button id="start-button" class="primary-button deployment-controls">${label("开始战斗 →")}</button>
    <section id="command-card" class="command-card" aria-label="${t("单位战术命令")}" data-i18n-aria-label="单位战术命令"><div id="inspector-content" class="inspector-content"></div></section>
    <div class="battle-controls">
      <div class="action-status"><div id="battle-status-title" class="action-status-title">${label("自动交战进行中")}</div><div id="battle-status-sub" class="action-status-sub">${label("命令已锁定 · 可暂停观察或切换相机")}</div></div>
      <button id="pause-button" class="secondary-button pause-button">${label("暂停")}</button>
      <div class="speed-group"><button class="speed-button active" data-speed="1">1×</button><button class="speed-button" data-speed="2">2×</button></div>
      <button id="abort-button" class="secondary-button">${label("调整部署")}</button>
    </div>
  </footer>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <div id="modal-root"></div>
`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const viewport = $('#viewport');
if (report) await report('terrain');
let terrain = new LunarTerrain(currentMission.id);
let simulation = new BattleSimulation(terrain, currentMission);
const campaignIds = new Map<number, string>();
function deployCampaignArmy() {
  simulation.clearPlayer(); campaignIds.clear();
  for (const soldier of [...campaign.army]) {
    if (!soldier.deployed) continue;
    let point = simulation.findSpawnPosition(soldier.kind, soldier);
    if (!point) { withdraw(campaign, soldier.id); continue; }
    soldier.x = point.x; soldier.z = point.z;
    const unit = simulation.addUnit('player', soldier.kind, point.x, point.z, soldier.doctrine, soldier.priority);
    unit.heading = soldier.heading; campaignIds.set(unit.id, soldier.id);
  }
}
deployCampaignArmy();
if (report) await report('renderer');
const renderer = new BattleRenderer(viewport, terrain, simulation);
installPixelArtPreview(renderer);
if (report) await report('portraits');
const thumbnails = createUnitThumbnails();
const audio = new AudioSystem();
let phase: Phase = 'deployment';
let selectedId: number | null = null;
let placingKind: UnitKind | null = null;
let draggingId: number | null = null;
let dragOffset: Vec2 = { x: 0, z: 0 };
let dragOrigin: Vec2 | null = null;
let tutorial: DeploymentTutorial | null = null;
let overlay: TerrainOverlay = 'none';
let paused = false;
let speed = 1;
let deploymentSnapshot: PlayerSetup[] = [];
let toastTimer = 0;
let resultTimer = 0;
let toastContent: (() => string) | null = null;
let readoutPoint: Vec2 | null = null;

bindLanguageSwitcher(appElement);
onLocaleChange(appElement, () => {
  translateElements(appElement);
  refreshMissionText();
  renderRoster(); updateInspector(); updateHUD(); updateAudioButton();
  if ($('#toast').classList.contains('visible') && toastContent) $('#toast').textContent = toastContent();
  if (document.querySelector('#help-title')) showHelp();
  else if (document.querySelector('#result-title')) showResult(phase === 'victory');
  else if (document.querySelector('#restart-title')) showRestart();
});

function refreshMissionText() {
  document.title = `SELENE // ${currentMission.name}`;
  $('.mission-number').textContent = currentMission.code;
  $('.mission-title').textContent = currentMission.name;
  $('.deployment-banner').textContent = t(deploymentPlan(currentMission.id).hint);
  $('.roster-footer').innerHTML = `<strong>${label('本关重点 ·')} ${currentMission.focus}</strong><br>${currentMission.objective}`;
  $<HTMLAnchorElement>('.editor-entry').href = routeHref({ editor: 1, mission: currentMission.id });
  $('#terrain-readout').innerHTML = readoutPoint ? terrainDescription(readoutPoint) : `${currentMission.name}<br>${label('选择单位查看射程与阵地效果')}`;
}

function syncDeployment() {
  if (phase !== 'deployment') return;
  for (const unit of playerUnits()) {
    const soldier = campaign.army.find(item => item.id === campaignIds.get(unit.id));
    if (soldier) Object.assign(soldier, { x: unit.x, z: unit.z, heading: unit.heading, doctrine: unit.doctrine, priority: unit.priority });
  }
}
function renderReserves() {
  const reserves = campaign.army.filter(item => !item.deployed);
  $('#campaign-reserves').innerHTML = reserves.length ? `<strong>${t('预备队 · 老兵免费归队')}</strong>${reserves.map(soldier => `<button class="secondary-button" data-reserve="${soldier.id}" ${phase !== 'deployment' ? 'disabled' : ''}>${UNIT_SPECS[soldier.kind].name} +</button>`).join('')}` : '';
}

/** Progress lives only in this page; stage changes never require persistent storage. */
function loadCampaignStage() {
  tutorial?.close();
  window.clearTimeout(resultTimer); window.clearTimeout(toastTimer);
  $('#modal-root').innerHTML = ''; $('#toast').classList.remove('visible'); toastContent = null;
  currentMission = MISSION_LIST[campaign.stage];
  terrain = new LunarTerrain(currentMission.id); simulation = new BattleSimulation(terrain, currentMission);
  deployCampaignArmy(); simulation.onEnd = settleBattle;
  phase = 'deployment'; selectedId = null; placingKind = null; draggingId = null; readoutPoint = null;
  paused = false; speed = 1; overlay = 'none'; accumulator = 0; hudTimer = 0; lastTime = performance.now();
  deploymentSnapshot = captureSnapshot();
  renderer.replaceWorld(terrain, simulation); renderer.setPhase(phase); renderer.setOverlay(overlay); renderer.setCameraMode('tactical', true);
  for (const button of appElement.querySelectorAll<HTMLButtonElement>('[data-mission-stage]')) {
    const stage = Number(button.dataset.missionStage);
    button.classList.toggle('active', stage === campaign.stage); button.classList.toggle('completed', stage < campaign.stage);
    button.setAttribute('aria-current', stage === campaign.stage ? 'step' : 'false');
  }
  for (const button of appElement.querySelectorAll<HTMLElement>('[data-overlay]')) button.classList.toggle('active', button.dataset.overlay === overlay);
  try { window.history.replaceState(window.history.state, '', routeHref({ mission: currentMission.id })); } catch { /* Progress is kept in memory. */ }
  refreshMissionText(); renderRoster(); updateCameraButtons(); updateSpeedButtons(); updateInspector(); updateHUD();
}

function playerUnits() {
  return simulation.units.filter(unit => unit.team === 'player');
}

function renderRoster() {
  $('#roster').innerHTML = UNIT_ORDER.map(kind => {
    const spec = UNIT_SPECS[kind];
    return `<button class="unit-card" data-kind="${kind}" aria-label="${t('购买 {name}，花费 ${cost}', { name: spec.name, cost: spec.cost })}">
      <img class="unit-card-thumb" src="${thumbnails[kind]}" alt="${t('{name}外观', { name: spec.name })}" draggable="false" />
      <span class="unit-card-code">${spec.code}</span><span class="unit-card-cost">$${spec.cost}</span>
      <span class="unit-card-name">${spec.name}</span><span class="unit-card-role">${spec.role}</span>
    </button>`;
  }).join('');
}

function updateHUD() {
  const currentSpent = campaignSpent(campaign);
  const players = playerUnits();
  const enemies = simulation.units.filter(unit => unit.team === 'enemy' && unit.alive);
  $('#budget-remaining').textContent = `$${campaign.funds}`;
  $('#campaign-economy').textContent = t('累计花费 ${spent} · 四关共享，无关卡补款', { spent: currentSpent });
  $('#campaign-economy').textContent += ` · ${t('仅本次游玩有效，刷新后重新开始')}`;
  renderReserves();
  $('#budget-fill').style.width = `${Math.min(100, campaign.funds / CAMPAIGN_STARTING_FUNDS * 100)}%`;
  $('#enemy-count').textContent = String(enemies.length).padStart(2, '0');
  $('#unit-count').textContent = phase === 'battle' || phase === 'victory' || phase === 'defeat' ? formatTime(simulation.stats.time) : String(players.length).padStart(2, '0');
  $('#resource-label').textContent = phase === 'battle' || phase === 'victory' || phase === 'defeat' ? t("交战时间") : t("部署单位");
  const phaseNames: Record<Phase, string> = { deployment: t("战前部署"), battle: paused ? t("战斗暂停") : t("自动交战"), victory: t("区域已控制"), defeat: t("任务失败") };
  $('#phase-chip').textContent = phaseNames[phase];
  $('#phase-chip').classList.toggle('battle', phase === 'battle');
  appElement.classList.toggle('battle-mode', phase !== 'deployment');
  appElement.classList.toggle('unit-selected', selectedId !== null && phase === 'deployment');
  $<HTMLButtonElement>('#start-button').disabled = players.length === 0 || phase !== 'deployment';
  $('#wave-status').style.display = currentMission.mode === 'defense' ? '' : 'none';
  $('#wave-count').textContent = `${simulation.waveIndex + 1} / ${currentMission.waves?.length ?? 1}`;
  $('#pause-button').textContent = paused ? t("继续") : t("暂停");
  $('#battle-status-title').textContent = paused ? t("战术观察暂停") : currentMission.mode === 'defense' ? t("高地防御进行中") : t("自动交战进行中");
  const waveText = currentMission.mode === 'defense' ? t(" · 波次 {p0}/{p1}", { p0: simulation.waveIndex + 1, p1: currentMission.waves?.length ?? 1 }) : '';
  $('#battle-status-sub').textContent = t("我方存活 {p0} · 击毁 {p1}{p2} · 命令已锁定", { p0: players.filter(unit => unit.alive).length, p1: simulation.stats.playerKills, p2: waveText });
  for (const card of document.querySelectorAll<HTMLButtonElement>('.unit-card')) {
    const kind = card.dataset.kind as UnitKind;
    card.classList.toggle('active', placingKind === kind);
    card.disabled = campaign.funds < UNIT_SPECS[kind].cost || campaign.army.length >= 80 || phase !== 'deployment';
  }
  if (placingKind) {
    $('#action-title').textContent = t("正在部署：{p0}", { p0: UNIT_SPECS[placingKind].name });
    $('#action-subtitle').textContent = t("绿色为合法站位；红色表示重叠、岩体阻挡或超出部署区。右键取消。");
  } else if (selectedId !== null) {
    const unit = simulation.units.find(item => item.id === selectedId);
    $('#action-title').textContent = unit ? t("已选择：{p0}", { p0: UNIT_SPECS[unit.kind].name }) : t("编队已就绪");
    $('#action-subtitle').textContent = unit?.team === 'enemy' ? t("敌方编成可查看，不能在战前修改其命令。") : t("拖动调整站位；底部设置行动方式与目标优先级。");
  } else {
    $('#action-title').textContent = players.length ? t("编队已就绪，可调整站位与命令") : t("从左侧选择兵种开始部署");
    $('#action-subtitle').textContent = currentMission.hint ?? currentMission.objective;
  }
}

function updateInspector() {
  const unit = simulation.units.find(item => item.id === selectedId);
  if (!unit) {
    $('#inspector-content').innerHTML = '';
    return;
  }
  const spec = UNIT_SPECS[unit.kind];
  const high = terrain.isHigh(unit.x, unit.z);
  const soft = terrain.isSoft(unit.x, unit.z);
  const nearCover = terrain.rocks.some(rock => rock.h < 1.45 && Math.hypot(unit.x - rock.x, unit.z - rock.z) < rock.r + 1.15);
  const effects = [high ? t("高地：视野与直射射程提升") : '', soft ? t("松软月壤：机动效率降低") : '', nearCover ? t("低岩体：可获得方向性掩护") : ''].filter(Boolean);
  $('#inspector-content').innerHTML = `
    <div class="command-identity">
      <button class="command-close" data-action="close-inspector" aria-label="${t("取消选择")}" data-i18n-aria-label="取消选择">×</button>
      <img class="command-portrait" src="${thumbnails[unit.kind]}" alt="${spec.name}" draggable="false" />
      <div class="command-title"><span class="eyebrow">${spec.code} / ${unit.team === 'player' ? t('FRIENDLY') : t('HOSTILE')}</span><h2 class="selected-name">${spec.name}</h2><span class="command-role">${spec.role} ${label("· 价格")} $${spec.cost}</span></div>
      <p class="unit-description">${spec.description}</p>
    </div>
    <div class="stat-grid"><div class="stat"><span class="stat-label">${label("结构")}</span><span class="stat-value">${Math.ceil(unit.hp)} / ${spec.hp}</span></div><div class="stat"><span class="stat-label">${label("射程")}</span><span class="stat-value">${(scaledRange(spec) * (high && spec.attack !== 'melee' && spec.attack !== 'cone' ? 1.15 : 1)).toFixed(1)}</span></div><div class="stat"><span class="stat-label">${label("占位")}</span><span class="stat-value">${spec.radius.toFixed(2)}</span></div><div class="stat"><span class="stat-label">${label("伤害")}</span><span class="stat-value">${spec.damage}</span></div><div class="stat"><span class="stat-label">${label("速度")}</span><span class="stat-value">${(spec.speed * COMBAT_TUNING.speed).toFixed(1)}</span></div><div class="stat"><span class="stat-label">${label("装甲")}</span><span class="stat-value">${Math.round(spec.armor * 100)}%</span></div></div>
    <div class="order-section"><div class="order-label"><span>${label("行动方式")}</span><span>${label('DOCTRINE')}</span></div><div class="order-grid">${DOCTRINES.map(item => `<button class="order-button ${unit.doctrine === item.id ? 'active' : ''}" data-doctrine="${item.id}" ${unit.team === 'enemy' ? 'disabled' : ''}>${item.label}</button>`).join('')}</div><p class="order-hint">${DOCTRINES.find(item => item.id === unit.doctrine)?.hint}</p></div>
    <div class="order-section"><div class="order-label"><span>${label("目标优先级")}</span><span>${label('TARGET')}</span></div><div class="order-grid">${PRIORITIES.map(item => `<button class="order-button ${unit.priority === item.id ? 'active' : ''}" data-priority="${item.id}" ${unit.team === 'enemy' ? 'disabled' : ''}>${item.label}</button>`).join('')}</div><div class="terrain-effect">${effects.length ? effects.join('<br>') : t("无额外地形增益 · 圆环为平面站位空间")}</div></div>
    <div class="command-actions">${unit.team === 'player' ? `<button class="secondary-button" data-action="rotate">${label("旋转 45° [R]")}</button><button class="secondary-button danger" data-action="remove">${campaign.army.find(item => item.id === campaignIds.get(unit.id))?.veteran ? label('收入预备队 [Del]') : label('取消购买 [Del]')}</button>` : `<span class="command-readonly">${label("敌方命令仅可查看")}</span>`}<button class="primary-button command-start" data-action="start-battle">${label("开始战斗 →")}</button></div>`;
}

function selectUnit(id: number | null) {
  selectedId = id;
  placingKind = null;
  renderer.setGhost(null);
  updateInspector();
  updateHUD();
  tutorial?.notify('changed');
}

function startPlacing(kind: UnitKind) {
  if (phase !== 'deployment') return;
  if (campaign.funds < UNIT_SPECS[kind].cost) {
    showToast(() => t("资金不足，可取消本关新兵购买或使用预备队"));
    return;
  }
  selectedId = null;
  placingKind = placingKind === kind ? null : kind;
  updateInspector();
  updateHUD();
  tutorial?.notify('chosen');
}

function attemptPlacement(point: Vec2) {
  if (!placingKind) return;
  const kind = placingKind;
  const spec = UNIT_SPECS[kind];
  if (campaign.funds < spec.cost) {
    showToast(() => t("战役资金不足"));
    audio.deploy(false);
    return;
  }
  if (!simulation.canPlace(kind, point.x, point.z)) {
    showToast(() => t("无法部署：站位重叠、岩体阻挡或超出部署区"));
    audio.deploy(false);
    return;
  }
  const soldier = recruit(campaign, kind, point);
  if (!soldier) return;
  const unit = simulation.addUnit('player', kind, point.x, point.z);
  campaignIds.set(unit.id, soldier.id);
  syncDeployment();
  renderer.refreshUnits();
  audio.deploy(true);
  selectUnit(unit.id);
  tutorial?.notify('placed');
}

function removeSelected() {
  const unit = simulation.units.find(item => item.id === selectedId && item.team === 'player');
  if (!unit || phase !== 'deployment') return;
  withdraw(campaign, campaignIds.get(unit.id)!);
  campaignIds.delete(unit.id);
  simulation.removeUnit(unit.id);
  syncDeployment();
  selectedId = null;
  renderer.refreshUnits();
  audio.click();
  updateInspector();
  updateHUD();
  tutorial?.notify('changed');
}

function captureSnapshot(): PlayerSetup[] {
  return playerUnits().map(unit => ({ campaignId: campaignIds.get(unit.id)!, kind: unit.kind, x: unit.x, z: unit.z, heading: unit.heading, doctrine: unit.doctrine, priority: unit.priority }));
}

function restoreSnapshot(snapshot?: PlayerSetup[]) {
  window.clearTimeout(resultTimer);
  $('#modal-root').innerHTML = '';
  const setups = snapshot ?? captureSnapshot();
  retryStage(campaign);
  campaignIds.clear();
  simulation.resetDeployment();
  simulation.clearPlayer();
  for (const setup of setups) {
    const unit = simulation.addUnit('player', setup.kind, setup.x, setup.z, setup.doctrine, setup.priority);
    unit.heading = setup.heading;
    campaignIds.set(unit.id, setup.campaignId);
  }
  selectedId = null;
  placingKind = null;
  phase = 'deployment';
  syncDeployment();
  paused = false;
  speed = 1;
  renderer.refreshUnits();
  renderer.setPhase(phase);
  renderer.setCameraMode('tactical');
  updateCameraButtons();
  updateSpeedButtons();
  updateInspector();
  updateHUD();
}

function startBattle() {
  if (phase !== 'deployment' || playerUnits().length === 0) return;
  tutorial?.close();
  window.clearTimeout(resultTimer);
  $('#modal-root').innerHTML = '';
  syncDeployment();
  deploymentSnapshot = captureSnapshot();
  phase = 'battle';
  paused = false;
  speed = 1;
  selectedId = null;
  placingKind = null;
  renderer.setGhost(null);
  renderer.setPhase(phase);
  simulation.start();
  audio.click(true);
  updateSpeedButtons();
  updateHUD();
}

function setCamera(mode: CameraMode) {
  renderer.setCameraMode(mode);
  updateCameraButtons();
}

function updateCameraButtons() {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-camera]')) button.classList.toggle('active', button.dataset.camera === renderer.cameraMode);
}

function updateSpeedButtons() {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) button.classList.toggle('active', Number(button.dataset.speed) === speed);
}

function togglePause() {
  if (phase !== 'battle') return;
  paused = !paused;
  audio.click();
  updateHUD();
}

function showToast(render: () => string) {
  toastContent = render;
  window.clearTimeout(toastTimer);
  $('#toast').textContent = render();
  $('#toast').classList.add('visible');
  toastTimer = window.setTimeout(() => $('#toast').classList.remove('visible'), 2300);
}

function formatTime(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function terrainDescription(point: Vec2) {
  const labels = [];
  if (terrain.isHigh(point.x, point.z)) labels.push(t("高地 / 射程与视野增益"));
  if (terrain.isSoft(point.x, point.z)) labels.push(t("松软月壤 / 移动减速"));
  if (terrain.rocks.some(rock => Math.hypot(point.x - rock.x, point.z - rock.z) < rock.r + 1.15)) labels.push(t("岩体 / 方向性掩护"));
  return `X ${point.x.toFixed(1)} · Z ${point.z.toFixed(1)}${labels.length ? `<br>${labels.join('<br>')}` : ''}`;
}

function showHelp() {
  tutorial?.suspend(true);
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><span class="modal-code">${label('FIELD MANUAL / 01')}</span><h2 id="help-title">${label("作战操作")}</h2><dl class="help-grid"><dt>${label("共享资金")}</dt><dd>${t("四关共用 ${funds}。购买扣款，关卡间不补款；新兵撤回可退款，老兵进入预备队。", { funds: CAMPAIGN_STARTING_FUNDS })}</dd><dt>${label("幸存继承")}</dt><dd>${label("按顺序完成四关；胜利后幸存者满状态归队，阵亡单位永久失去。失败可免费重试本关。")}</dd><dt>${label("部署部队")}</dt><dd>${label("点击兵种，再点击青色部署区。绿色模型表示合法，红色表示与单位或岩体冲突。")}</dd><dt>${label("调整阵型")}</dt><dd>${label("左键拖动单位；R 旋转，Delete 撤回。所有存活单位在战斗中也会保持平面间隔。")}</dd><dt>${label("预设命令")}</dt><dd>${label("选中己方单位，在底部设置行动方式与目标优先级。开战后命令锁定。")}</dd><dt>${label("观察战场")}</dt><dd>${label("1 / 2 / 3 切换相机；右键环绕、滚轮缩放、中键平移。空格暂停。")}</dd><dt>${label("地形判断")}</dt><dd>${label("高地扩大射程与视野；低岩体提供方向掩护；火箭炮需要友军视野并有最小射程。")}</dd></dl><div class="modal-actions">${phase === 'deployment' ? `<button class="secondary-button" data-action="tutorial">${label("重新打开教学")}</button>` : ''}<button class="primary-button" data-action="close-modal">${label("返回战场")}</button></div></section></div>`;
}

function showRestart() {
  tutorial?.suspend(true);
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="restart-title"><h2 id="restart-title">${label('重新开始战役')}</h2><p>${t('当前战役将从第一关重新开始，资金恢复为 ${funds}，现有部队和进度清空。', { funds: CAMPAIGN_STARTING_FUNDS })}</p><div class="modal-actions"><button class="secondary-button" data-action="close-modal">${label('返回战场')}</button><button class="primary-button" data-action="confirm-restart">${label('确认重新开始')}</button></div></section></div>`;
}

function showResult(victory: boolean) {
  const survivors = campaign.result?.survivors.length ?? playerUnits().filter(unit => unit.alive).length;
  const spent = campaignSpent(campaign);
  const complete = victory && campaignComplete(campaign);
  const best = complete ? t('本次通关花费 ${cost}，刷新后不会保留。', { cost: spent }) : '';
  const nextMission = victory ? MISSION_LIST[campaign.stage + 1] : undefined;
  const continueButton = nextMission ? `<button class="primary-button" data-mission="${nextMission.id}">${label('下一关 ·')} ${nextMission.name} →</button>` : complete ? `<button class="primary-button" data-action="restart">${label('挑战更低花费')}</button>` : '';
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="result-title"><span class="modal-code">${label('AFTER ACTION /')} ${victory ? t('SECURED') : t('ABORTED')}</span><h2 id="result-title">${complete ? t('四关战役完成') : victory ? currentMission.victoryTitle ?? t('{p0}已突破', { p0: currentMission.name }) : t('作战编队失去战斗力')}</h2><p>${victory ? `${currentMission.success} ${nextMission ? t('幸存单位将满状态进入下一关，剩余资金继续共用。') : best}` : t('本次失败不会重复扣款。可恢复开战前编队，调整购买与战术后重试。')}</p><div class="result-grid"><div class="result-stat"><strong>$${spent}</strong><span>${label('累计花费')}</span></div><div class="result-stat"><strong>$${campaign.funds}</strong><span>${label('剩余战役资金')}</span></div><div class="result-stat"><strong>${survivors}</strong><span>${label('己方存活')}</span></div></div><p>${t('交战时间 {time} · 击毁 {kills}', { time: formatTime(simulation.stats.time), kills: simulation.stats.playerKills })}</p><div class="modal-actions"><button class="secondary-button" data-action="adjust">${label('调整部署')}</button><button class="secondary-button" data-action="retry">${label('重试本关')}</button>${continueButton}</div></section></div>`;
}

function settleBattle(victory: boolean) {
  phase = victory ? 'victory' : 'defeat';
  if (victory) recordVictory(campaign, { survivors: playerUnits().filter(unit => unit.alive).map(unit => campaignIds.get(unit.id)!), time: simulation.stats.time, kills: simulation.stats.playerKills });
  audio.result(victory);
  updateHUD();
  window.clearTimeout(resultTimer);
  resultTimer = window.setTimeout(() => showResult(victory), 650);
}
simulation.onEnd = settleBattle;

$('#roster').addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-kind]');
  if (button && !button.disabled) startPlacing(button.dataset.kind as UnitKind);
});

$('#inspector-content').addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!button) return;
  const unit = simulation.units.find(item => item.id === selectedId && item.team === 'player');
  if (button.dataset.doctrine && unit && phase === 'deployment') unit.doctrine = button.dataset.doctrine as Doctrine;
  if (button.dataset.priority && unit && phase === 'deployment') unit.priority = button.dataset.priority as Priority;
  if (button.dataset.action === 'rotate' && unit && phase === 'deployment') unit.heading += Math.PI / 4;
  if (button.dataset.action === 'remove') removeSelected();
  audio.click();
  syncDeployment();
  updateInspector();
  updateHUD();
  if (unit && phase === 'deployment') tutorial?.notify(button.dataset.doctrine || button.dataset.priority ? 'ordered' : button.dataset.action === 'rotate' ? 'moved' : 'changed');
});

document.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (button) audio.click();
  if (button?.dataset.mission && button.dataset.mission !== currentMission.id) {
    if (phase === 'victory' && button.dataset.mission === MISSION_LIST[campaign.stage + 1]?.id && advanceCampaign(campaign)) {
      loadCampaignStage();
    }
  }
  if (button?.dataset.reserve && phase === 'deployment') {
    const soldier = campaign.army.find(item => item.id === button.dataset.reserve && !item.deployed);
    if (soldier) {
      const point = simulation.findSpawnPosition(soldier.kind, soldier);
      if (point) {
        Object.assign(soldier, point, { deployed: true });
        const unit = simulation.addUnit('player', soldier.kind, point.x, point.z, soldier.doctrine, soldier.priority);
        unit.heading = soldier.heading; campaignIds.set(unit.id, soldier.id);
        syncDeployment(); renderer.refreshUnits(); selectUnit(unit.id);
      } else showToast(() => t('部署区没有合适空位，请先调整站位'));
    }
  }
  const action = button?.dataset.action;
  if (action === 'restart') showRestart();
  if (action === 'confirm-restart') { campaign = newCampaign(); loadCampaignStage(); }

  if (action === 'close-inspector') selectUnit(null);
  if (action === 'start-battle') startBattle();
  if (action === 'close-modal') { $('#modal-root').innerHTML = ''; tutorial?.suspend(false); }
  if (action === 'tutorial') { $('#modal-root').innerHTML = ''; tutorial?.start(); }
  if (action === 'adjust') {
    $('#modal-root').innerHTML = '';
    restoreSnapshot(deploymentSnapshot.length ? deploymentSnapshot : undefined);
  }
  if (action === 'retry') {
    $('#modal-root').innerHTML = '';
    restoreSnapshot(deploymentSnapshot.length ? deploymentSnapshot : undefined);
    startBattle();
  }
});

$('#terrain-tools').addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-overlay]');
  if (!button) return;
  overlay = button.dataset.overlay as TerrainOverlay;
  renderer.setOverlay(overlay);
  for (const item of document.querySelectorAll('[data-overlay]')) item.classList.toggle('active', item === button);
});

$('#camera-tools').addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-camera]');
  if (button) setCamera(button.dataset.camera as CameraMode);
});

$('#restart-campaign').addEventListener('click', showRestart);
$('#clear-button').addEventListener('click', () => {
  if (phase !== 'deployment') return;
  for (const soldier of [...campaign.army]) if (soldier.deployed) withdraw(campaign, soldier.id);
  simulation.clearPlayer(); campaignIds.clear(); syncDeployment();
  selectedId = null; placingKind = null;
  renderer.refreshUnits(); updateInspector(); updateHUD();
  tutorial?.notify('changed');
});
$('#start-button').addEventListener('click', startBattle);
$('#pause-button').addEventListener('click', togglePause);
$('#abort-button').addEventListener('click', () => restoreSnapshot(deploymentSnapshot));
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-speed]')) button.addEventListener('click', () => {
  speed = Number(button.dataset.speed);
  updateSpeedButtons();
});
$('#help-button').addEventListener('click', showHelp);
$('#audio-button').addEventListener('click', () => {
  audio.setMuted(!audio.isMuted);
  updateAudioButton();
});
function updateAudioButton() {
  $('#audio-button').textContent = audio.isMuted ? t("静") : t("音");
  $('#audio-button').setAttribute('aria-label', audio.isMuted ? t("开启声音") : t("关闭声音"));
}
document.addEventListener('pointerdown', () => { void audio.ensureStarted(); }, { capture: true });

renderer.canvas.addEventListener('contextmenu', event => event.preventDefault());
renderer.canvas.addEventListener('pointerdown', event => {
  if (event.button === 2) {
    if (placingKind) {
      placingKind = null;
      renderer.setGhost(null);
      updateHUD();
      tutorial?.notify('changed');
    } else if (renderer.cameraMode !== 'free') {
      setCamera('free');
    }
    return;
  }
  if (event.button !== 0 || phase !== 'deployment') return;
  const point = renderer.screenToGround(event.clientX, event.clientY);
  if (placingKind) {
    if (point) attemptPlacement(point);
    return;
  }
  const picked = renderer.pickUnit(event.clientX, event.clientY);
  selectUnit(picked);
  const unit = simulation.units.find(item => item.id === picked && item.team === 'player');
  if (unit && point) {
    draggingId = unit.id;
    dragOffset = { x: unit.x - point.x, z: unit.z - point.z };
    dragOrigin = { x: unit.x, z: unit.z };
    renderer.canvas.setPointerCapture(event.pointerId);
  }
}, { capture: true });

renderer.canvas.addEventListener('wheel', () => {
  if (renderer.cameraMode !== 'free') setCamera('free');
}, { passive: true, capture: true });

renderer.canvas.addEventListener('pointermove', event => {
  const point = renderer.screenToGround(event.clientX, event.clientY);
  if (!point) return;
  readoutPoint = { ...point };
  $('#terrain-readout').innerHTML = terrainDescription(point);
  if (placingKind) {
    const valid = simulation.canPlace(placingKind, point.x, point.z) && campaign.funds >= UNIT_SPECS[placingKind].cost;
    renderer.setGhost(placingKind, point, valid);
    renderer.canvas.style.cursor = valid ? 'crosshair' : 'not-allowed';
  } else if (draggingId !== null && phase === 'deployment') {
    const unit = simulation.units.find(item => item.id === draggingId);
    if (unit) {
      const desired = { x: point.x + dragOffset.x, z: point.z + dragOffset.z };
      if (simulation.canPlace(unit.kind, desired.x, desired.z, unit.id)) {
        unit.x = desired.x;
        unit.z = desired.z;
        unit.anchor = { ...desired };
      }
    }
  }
});
renderer.canvas.addEventListener('pointerup', event => {
  if (draggingId !== null) {
    const unit = simulation.units.find(item => item.id === draggingId);
    const moved = unit && dragOrigin && Math.hypot(unit.x - dragOrigin.x, unit.z - dragOrigin.z) >= .25;
    draggingId = null;
    dragOrigin = null;
    if (renderer.canvas.hasPointerCapture(event.pointerId)) renderer.canvas.releasePointerCapture(event.pointerId);
    audio.deploy(true); syncDeployment();
    tutorial?.notify(moved ? 'moved' : 'changed');
  }
});
renderer.canvas.addEventListener('pointercancel', event => {
  draggingId = null; dragOrigin = null;
  if (renderer.canvas.hasPointerCapture(event.pointerId)) renderer.canvas.releasePointerCapture(event.pointerId);
  syncDeployment(); tutorial?.notify('changed');
});
renderer.canvas.addEventListener('pointerleave', () => {
  if (placingKind) renderer.setGhost(null);
});

document.addEventListener('keydown', event => {
  if ((event.target as HTMLElement).closest('input, select, textarea, [contenteditable="true"]')) return;
  if (event.key === 'Enter' && (event.target as HTMLElement).closest('button, a')) return;
  if (event.key === 'Escape') {
    $('#modal-root').innerHTML = '';
    placingKind = null;
    renderer.setGhost(null);
    selectUnit(null);
    tutorial?.suspend(false);
  }
  if (event.key === '1') setCamera('tactical');
  if (event.key === '2') setCamera('frontline');
  if (event.key === '3') setCamera('free');
  if (event.key === ' ' && phase === 'battle') {
    event.preventDefault();
    togglePause();
  }
  if (event.key === 'Enter' && phase === 'deployment') startBattle();
  if ((event.key === 'Delete' || event.key === 'Backspace') && phase === 'deployment') removeSelected();
  if ((event.key === 'r' || event.key === 'R') && phase === 'deployment') {
    const unit = simulation.units.find(item => item.id === selectedId && item.team === 'player');
    if (unit) { unit.heading += Math.PI / 4; syncDeployment(); tutorial?.notify('moved'); }
  }
});

deploymentSnapshot = captureSnapshot();
renderRoster();
updateInspector();
updateHUD();
renderer.setPhase(phase);

function tutorialTarget(step: TutorialStep): TutorialRect | null {
  const elementRect = (element: HTMLElement | null): TutorialRect | null => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };
  if (step === 'choose') return elementRect(appElement.querySelector('[data-kind="rifle"]'));
  if (step === 'orders') return elementRect($('#command-card'));
  if (step === 'ready') return elementRect($('#start-button'));
  const unit = simulation.units.find(item => item.id === selectedId && item.team === 'player') ?? playerUnits()[0];
  const point = step === 'place' && placingKind ? simulation.findSpawnPosition(placingKind, { x: 0, z: 15 }) : unit;
  if (!point) return elementRect(viewport);
  const screen = renderer.projectToScreen(point, step === 'arrange' ? unit?.kind === 'mech' ? 1.9 : .85 : .1);
  return screen ? { x: screen.x - 24, y: screen.y - 24, width: 48, height: 48 } : elementRect(viewport);
}
tutorial = new DeploymentTutorial({
  root: appElement,
  state: () => ({ deploying: phase === 'deployment', placing: placingKind !== null, hasUnits: playerUnits().length > 0, friendlySelected: simulation.units.some(unit => unit.id === selectedId && unit.team === 'player') }),
  target: tutorialTarget,
  revealStart: () => selectUnit(null),
});
if (report) await report('ready');

let lastTime = performance.now();
let accumulator = 0;
let hudTimer = 0;
function animate(now: number) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (phase === 'battle' && !paused) {
    accumulator += dt * speed;
    let steps = 0;
    while (accumulator >= 1 / 30 && steps++ < 6 && phase === 'battle') {
      simulation.update(1 / 30);
      accumulator -= 1 / 30;
    }
  } else {
    accumulator = 0;
  }
  for (const event of simulation.drainEvents()) {
    if (event.type === 'notice') showToast(() => t(event.messageKey ?? event.text, event.values));
    else {
      renderer.handleEvent(event);
      audio.playEvent(event);
    }
  }
  renderer.update(dt, phase, selectedId, overlay);
  tutorial?.updatePosition();
  hudTimer += dt;
  if (hudTimer > 0.15) {
    updateHUD();
    hudTimer = 0;
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
return { startTutorial: () => tutorial?.start() };
}

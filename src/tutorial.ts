import { onLocaleChange, t } from './i18n';

export type TutorialStep = 'choose' | 'place' | 'arrange' | 'orders' | 'ready';
export type TutorialAction = 'chosen' | 'placed' | 'moved' | 'ordered' | 'changed';
export interface TutorialRect { x: number; y: number; width: number; height: number }
interface TutorialState { deploying: boolean; placing: boolean; hasUnits: boolean; friendlySelected: boolean }
interface TutorialOptions {
  root: HTMLElement;
  state: () => TutorialState;
  target: (step: TutorialStep) => TutorialRect | null;
  revealStart: () => void;
}
const steps: TutorialStep[] = ['choose', 'place', 'arrange', 'orders', 'ready'];
const copy: Record<TutorialStep, { title: string; body: string; action?: string }> = {
  choose: { title: '先选一个兵种', body: '点击高亮的枪兵卡片，或选择其他兵种。这里只选择兵种，放置成功才扣款。' },
  place: { title: '把部队放到战场上', body: '点击青色部署区放置单位。标记给出一个可用位置；红色预览表示有障碍或站位重叠。' },
  arrange: { title: '试着调整站位', body: '按住刚放下的友军，拖到青色区域的另一处。也可以按 R 旋转朝向，单位之间留出空间。', action: '保留这个站位' },
  orders: { title: '给单位一个命令', body: '点击下方的行动方式或目标优先级。命令在开战后锁定，也可以沿用当前设置。', action: '保留当前命令' },
  ready: { title: '继续组建你的编队', body: '刚才只是第一名士兵。继续购买和排布部队，准备好后点击开始战斗。140 资金四关共用，幸存友军会满状态进入下一关。', action: '完成教学' },
};

/** Pick a nearby, visible position without covering the highlighted control. */
export function placeTutorialCard(target: TutorialRect, card: { width: number; height: number }, viewport: { width: number; height: number }) {
  const gap = 16, edge = 12;
  const maxX = Math.max(edge, viewport.width - card.width - edge), maxY = Math.max(edge, viewport.height - card.height - edge);
  const clamp = (value: number, max: number) => Math.min(max, Math.max(edge, value));
  const candidates = [
    { x: target.x + target.width + gap, y: target.y + target.height / 2 - card.height / 2 },
    { x: target.x - card.width - gap, y: target.y + target.height / 2 - card.height / 2 },
    { x: target.x + target.width / 2 - card.width / 2, y: target.y - card.height - gap },
    { x: target.x + target.width / 2 - card.width / 2, y: target.y + target.height + gap },
  ];
  return candidates.map(candidate => {
    const x = clamp(candidate.x, maxX), y = clamp(candidate.y, maxY);
    const overlap = Math.max(0, Math.min(x + card.width, target.x + target.width) - Math.max(x, target.x)) * Math.max(0, Math.min(y + card.height, target.y + target.height) - Math.max(y, target.y));
    return { x, y, score: overlap * 1000 + Math.abs(x - candidate.x) + Math.abs(y - candidate.y) };
  }).sort((a, b) => a.score - b.score)[0];
}

export class DeploymentTutorial {
  private layer = document.createElement('div');
  private card: HTMLElement;
  private spotlight: HTMLElement;
  private title: HTMLElement;
  private body: HTMLElement;
  private counter: HTMLElement;
  private next: HTMLButtonElement;
  private closeButton: HTMLButtonElement;
  private step: TutorialStep = 'choose';
  private active = false;
  private suspended = false;
  private lastPositionTime = -Infinity;
  private unsubscribe: () => void;
  private readonly onLayout = () => this.updatePosition(true);
  private readonly onKey = (event: KeyboardEvent) => {
    if (this.active && !this.suspended && event.key === 'Escape') this.close();
  };

  constructor(private options: TutorialOptions) {
    this.layer.className = 'tutorial-layer'; this.layer.hidden = true;
    this.layer.innerHTML = `<div class="tutorial-spotlight" aria-hidden="true"><span class="tutorial-pin"></span></div><div class="tutorial-anchor"><section class="tutorial-card" role="region" aria-labelledby="tutorial-title"><header><span class="tutorial-counter"></span><button class="tutorial-close" type="button" data-tutorial-close>×</button></header><div aria-live="polite" aria-atomic="true"><h2 id="tutorial-title"></h2><p id="tutorial-body"></p></div><button class="tutorial-next secondary-button" type="button" data-tutorial-next></button></section></div>`;
    this.options.root.appendChild(this.layer);
    this.card = this.layer.querySelector<HTMLElement>('.tutorial-anchor')!;
    this.spotlight = this.layer.querySelector<HTMLElement>('.tutorial-spotlight')!;
    this.title = this.layer.querySelector<HTMLElement>('#tutorial-title')!;
    this.body = this.layer.querySelector<HTMLElement>('#tutorial-body')!;
    this.counter = this.layer.querySelector<HTMLElement>('.tutorial-counter')!;
    this.next = this.layer.querySelector<HTMLButtonElement>('[data-tutorial-next]')!;
    this.closeButton = this.layer.querySelector<HTMLButtonElement>('[data-tutorial-close]')!;
    this.closeButton.addEventListener('click', () => this.close());
    this.next.addEventListener('click', () => {
      if (this.step === 'arrange' && this.options.state().hasUnits) this.setStep(this.options.state().friendlySelected ? 'orders' : 'arrange');
      else if (this.step === 'orders' && this.options.state().friendlySelected) this.setStep('ready');
      else if (this.step === 'ready') this.close();
    });
    this.unsubscribe = onLocaleChange(options.root, () => { if (this.active) this.render(); });
  }

  start() {
    if (!this.options.state().deploying) return;
    this.active = true; this.suspended = false; this.layer.hidden = false;
    window.addEventListener('resize', this.onLayout);
    document.addEventListener('scroll', this.onLayout, true);
    document.addEventListener('keydown', this.onKey);
    this.setStep(this.options.state().hasUnits ? 'arrange' : this.options.state().placing ? 'place' : 'choose');
    const target = this.options.root.querySelector<HTMLElement>('[data-kind="rifle"]');
    if (this.step === 'choose') {
      target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      target?.focus({ preventScroll: true });
    }
  }

  close() {
    this.active = false; this.suspended = false; this.layer.hidden = true;
    window.removeEventListener('resize', this.onLayout);
    document.removeEventListener('scroll', this.onLayout, true);
    document.removeEventListener('keydown', this.onKey);
    if (this.layer.contains(document.activeElement)) this.options.root.querySelector<HTMLElement>('#viewport')?.focus({ preventScroll: true });
  }

  suspend(value: boolean) {
    this.suspended = value; this.layer.hidden = !this.active || value;
    if (!value && this.active) { this.reconcile(); this.updatePosition(true); }
  }

  notify(action: TutorialAction) {
    if (!this.active) return;
    const state = this.options.state();
    if (!state.deploying) { this.close(); return; }
    if (action === 'chosen' && state.placing && (this.step === 'choose' || this.step === 'place')) this.setStep('place');
    else if (action === 'placed' && (this.step === 'choose' || this.step === 'place')) this.setStep('arrange');
    else if (action === 'moved' && this.step === 'arrange' && state.friendlySelected) this.setStep('orders');
    else if (action === 'ordered' && this.step === 'orders' && state.friendlySelected) this.setStep('ready');
    else this.reconcile();
    this.render();
  }

  private reconcile() {
    const state = this.options.state();
    if (!state.hasUnits && this.step !== 'choose') this.setStep(state.placing ? 'place' : 'choose');
    else if (this.step === 'orders' && !state.friendlySelected) this.setStep('arrange');
  }

  private setStep(step: TutorialStep) {
    this.step = step;
    if (step === 'orders') this.options.root.querySelector<HTMLElement>('[data-doctrine]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (step === 'ready') this.options.revealStart();
    this.render();
  }

  private render() {
    const item = copy[this.step];
    this.layer.dataset.tutorialStep = this.step;
    this.title.textContent = t(item.title); this.body.textContent = t(item.body);
    this.counter.textContent = t('部署教学 · {step} / {total}', { step: steps.indexOf(this.step) + 1, total: steps.length });
    this.closeButton.setAttribute('aria-label', t('关闭并跳过教学'));
    this.closeButton.title = t('关闭并跳过教学');
    this.next.hidden = !item.action;
    this.next.textContent = item.action ? t(item.action) : '';
    this.next.disabled = this.step === 'arrange' && !this.options.state().friendlySelected;
    this.layer.classList.toggle('tutorial-point-target', this.step === 'place' || this.step === 'arrange');
    this.updatePosition(true);
  }

  /** Called from the existing game loop; work stops as soon as the guide closes. */
  updatePosition(force = false) {
    if (!this.active || this.suspended || !this.options.root.isConnected) return;
    const now = performance.now();
    if (!force && now - this.lastPositionTime < 80) return;
    this.lastPositionTime = now;
    const rect = this.options.target(this.step);
    this.spotlight.hidden = !rect;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    if (rect) {
      const padding = 5;
      this.spotlight.style.transform = `translate3d(${rect.x - padding}px, ${rect.y - padding}px, 0)`;
      this.spotlight.style.width = `${rect.width + padding * 2}px`;
      this.spotlight.style.height = `${rect.height + padding * 2}px`;
    }
    const cardRect = this.card.getBoundingClientRect();
    const card = { width: cardRect.width || 292, height: cardRect.height || 250 };
    const position = placeTutorialCard(rect ?? { x: viewport.width / 2, y: viewport.height / 2, width: 0, height: 0 }, card, viewport);
    this.card.style.transform = `translate3d(${Math.round(position.x)}px, ${Math.round(position.y)}px, 0)`;
  }

  dispose() { this.close(); this.unsubscribe(); this.layer.remove(); }
}

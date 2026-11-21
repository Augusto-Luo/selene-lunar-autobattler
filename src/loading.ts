import { t } from './i18n';

export type LoadingStage = 'terrain' | 'renderer' | 'portraits' | 'ready';
export type LoadingReporter = (stage: LoadingStage) => Promise<void>;
const stages: Record<LoadingStage, { completed: number; message: string }> = {
  terrain: { completed: 0, message: '正在构建月面地形…' },
  renderer: { completed: 1, message: '正在准备战场与部队…' },
  portraits: { completed: 2, message: '正在生成兵种图鉴…' },
  ready: { completed: 3, message: '正在展开指挥界面…' },
};

/** Let the browser paint the previous stage before synchronous Three.js preparation. */
export const afterPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

export function createLoadingScreen() {
  const screen = document.querySelector<HTMLElement>('#boot-screen');
  const app = document.querySelector<HTMLElement>('#app')!;
  if (!screen) throw new Error('Loading screen is missing');
  app.inert = true;
  app.setAttribute('aria-busy', 'true');
  const progress = screen.querySelector<HTMLElement>('#boot-progress')!;
  const status = screen.querySelector<HTMLElement>('#boot-status')!;
  const count = screen.querySelector<HTMLElement>('#boot-count')!;
  const fill = screen.querySelector<HTMLElement>('#boot-fill')!;
  const retry = screen.querySelector<HTMLButtonElement>('#boot-retry')!;
  retry.textContent = t('重新加载');
  retry.addEventListener('click', () => window.location.reload());
  progress.setAttribute('aria-label', t('加载进度'));
  function update(completed: number, message: string) {
    status.textContent = t(message);
    progress.setAttribute('aria-valuenow', String(completed));
    count.textContent = `${completed} / 4`;
    fill.style.width = `${completed / 4 * 100}%`;
  }
  return {
    report: (async stage => {
      const item = stages[stage]; update(item.completed, item.message);
      await afterPaint();
    }) as LoadingReporter,
    async finish() {
      update(4, '战场已就绪');
      // A real battlefield frame is drawn before revealing the game.
      await afterPaint();
      screen.classList.add('is-leaving');
      await new Promise<void>(resolve => {
        let timer = 0;
        const complete = (event?: Event) => {
          if (event && event.target !== screen) return;
          window.clearTimeout(timer); screen.removeEventListener('transitionend', complete); resolve();
        };
        screen.addEventListener('transitionend', complete);
        timer = window.setTimeout(complete, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
      });
      screen.remove(); app.inert = false; app.removeAttribute('aria-busy');
    },
    fail() {
      screen.classList.remove('is-leaving');
      screen.setAttribute('role', 'alert');
      status.textContent = t('无法准备战场。请使用支持 WebGL 2 的浏览器，并尝试重新加载。');
      progress.hidden = true; count.hidden = true; retry.hidden = false;
      retry.focus();
    },
  };
}

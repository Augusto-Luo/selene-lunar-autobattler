import './style.css';
import { mountGame } from './game';
import { mountEditor } from './editor';
import './pixel-ui.css';
import { initializeLanguage } from './i18n';
import { createLoadingScreen } from './loading';

document.documentElement.classList.add('pixel-art');
initializeLanguage();

async function start() {
  const loading = createLoadingScreen();
  try {
    if (new URLSearchParams(location.search).get('editor') === '1') {
      await loading.report('terrain');
      mountEditor();
      await loading.finish();
    } else {
      const game = await mountGame(loading.report);
      await loading.finish();
      game.startTutorial();
    }
  } catch (error) {
    console.error('SELENE could not prepare the battlefield', error);
    loading.fail();
  }
}
void start();

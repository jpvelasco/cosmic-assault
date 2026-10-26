import type { E2eHooks } from './app/e2eHooks';
import { createApp, type App } from './app/game';
import { registerServiceWorker } from './platform/serviceWorker';

const root = document.querySelector('#app');
const canvas = document.querySelector('#game');
if (!(root instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
  throw new Error('index.html must contain <main id="app"> holding <canvas id="game">; restore that markup');
}
let app: App;
if (import.meta.env.MODE === 'e2e') {
  const hooks: E2eHooks = {};
  app = createApp(root, canvas, hooks);
  void import('./testBridge').then((bridge) => {
    bridge.exposeTestBridge(app, hooks);
  });
} else {
  app = createApp(root, canvas);
}
// After load, so fetching the precache never competes with the first paint.
window.addEventListener('load', () => {
  registerServiceWorker(navigator, app.log);
}, { once: true });

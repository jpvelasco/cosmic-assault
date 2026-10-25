import { createApp, type E2eHooks } from './app/game';

const root = document.querySelector('#app');
const canvas = document.querySelector('#game');
if (!(root instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
  throw new Error('index.html must contain <main id="app"> holding <canvas id="game">; restore that markup');
}
const e2eHooks: E2eHooks = {};
const app = createApp(root, canvas, import.meta.env.MODE === 'e2e' ? e2eHooks : undefined);

if (import.meta.env.MODE === 'e2e') {
  void import('./testBridge').then((bridge) => {
    bridge.exposeTestBridge(app, e2eHooks);
  });
}

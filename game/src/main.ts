import { createApp } from './app/game';

const root = document.querySelector('#app');
const canvas = document.querySelector('#game');
if (!(root instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
  throw new Error('index.html must contain <main id="app"> holding <canvas id="game">; restore that markup');
}
const app = createApp(root, canvas);

if (import.meta.env.MODE === 'e2e') {
  void import('./testBridge').then((bridge) => {
    bridge.exposeTestBridge(app);
  });
}

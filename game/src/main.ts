import { formatBuildLabel } from './buildLabel';

const app = document.querySelector('#app');
if (app) {
  app.innerHTML = `
    <h1>Cosmic Assault</h1>
    <p>Preview build</p>
    <p data-testid="build-label">${formatBuildLabel(__BUILD_SHA__ || undefined, __BUILD_DATE__)}</p>
  `;
}

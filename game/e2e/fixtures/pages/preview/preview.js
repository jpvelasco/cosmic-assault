// Registers the preview's worker as the game does (src/platform/serviceWorker.ts): ./sw.js with the default scope, and
// a failure only means no offline play.
navigator.serviceWorker.register('./sw.js').catch(() => undefined);

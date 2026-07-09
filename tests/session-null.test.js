// When the session node goes null AFTER data was seen (owner deleted the
// session), the tab must go back to the dashboard instead of stranding the
// user on a blank start-session screen wired to a dead session id. A null on
// FIRST load keeps the start card (direct-open path / create-navigate race).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

test('session deleted after load -> redirect to dashboard', () => {
  const app = loadApp();
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap())});`);
  app.run(`window._fbHandleNull();`);
  assert.equal(app.windowMock.location.href, '/dashboard.html');
});

test('null on first load keeps the start-session screen', () => {
  const app = loadApp();
  app.run(`window._fbHandleNull();`);
  assert.equal(app.windowMock.location.href, '', 'must not redirect');
  assert.equal(app.els['sessionStartCard'].style.display, '');
});

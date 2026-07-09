import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

function applyAs(app, uid, over) {
  app.run(`window._uid = ${JSON.stringify(uid)};`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap(over))});`);
}

test('owner: _access owner, End Session visible, banner hidden', () => {
  const app = loadApp();
  applyAs(app, 'owner1', {});
  assert.equal(app.run('_access'), 'owner');
  assert.notEqual(app.els['sessionActionBtn'].style.display, 'none');
  assert.equal(app.els['accessBanner'].style.display, 'none');
});

test('cohost: _access cohost, End Session hidden, cohost banner shown', () => {
  const app = loadApp();
  applyAs(app, 'buddy', { cohosts: { buddy: { name: 'Buddy', addedAt: 1 } } });
  assert.equal(app.run('_access'), 'cohost');
  assert.equal(app.els['sessionActionBtn'].style.display, 'none');
  assert.equal(app.els['sessionNewBtn'].style.display, 'none');
  assert.match(app.els['accessBanner'].textContent, /Co-hosting/);
});

test('revoke: cohost removed -> revoked banner, saveState no-ops', () => {
  const app = loadApp();
  applyAs(app, 'buddy', { cohosts: { buddy: { name: 'Buddy', addedAt: 1 } } });
  applyAs(app, 'buddy', { cohosts: null }); // owner revoked
  assert.equal(app.run('_access'), 'revoked');
  assert.match(app.els['accessBanner'].textContent, /no longer a co-host/);
  app.run('window._fbWrite = () => { window.__wrote = (window.__wrote||0)+1; };');
  app.run('saveState();');
  assert.equal(app.run('window.__wrote || 0'), 0);
});

test('viewer: stranger gets view-only banner and no saves', () => {
  const app = loadApp();
  applyAs(app, 'stranger', {});
  assert.equal(app.run('_access'), 'viewer');
  assert.match(app.els['accessBanner'].textContent, /View only/);
  app.run('window._fbWrite = () => { window.__wrote = (window.__wrote||0)+1; };');
  app.run('saveState();');
  assert.equal(app.run('window.__wrote || 0'), 0);
});

test('owner: saveState still writes', () => {
  const app = loadApp();
  applyAs(app, 'owner1', {});
  app.run('window._fbWrite = () => { window.__wrote = (window.__wrote||0)+1; };');
  app.run('saveState();');
  assert.equal(app.run('window.__wrote'), 1);
});

test('cohost panel: hidden for cohost, visible for owner with escaped names', () => {
  const app = loadApp();
  applyAs(app, 'buddy', { cohosts: { buddy: { name: 'Buddy', addedAt: 1 } } });
  assert.equal(app.els['cohostPanel'].style.display, 'none');

  const app2 = loadApp();
  applyAs(app2, 'owner1', {
    cohostOpen: true,
    cohosts: { evil: { name: 'X<img src=x onerror=alert(1)>', addedAt: 1 } },
  });
  assert.notEqual(app2.els['cohostPanel'].style.display, 'none');
  assert.ok(app2.captured['cohostList'].includes('X&lt;img'), 'cohost name must be escaped');
  assert.ok(!app2.captured['cohostList'].includes('<img src=x'), 'raw injection must not survive');
  assert.ok(app2.captured['cohostList'].includes("removeCohost('evil')"));
});

test('cohost panel: open state reflects cohostOpen', () => {
  const app = loadApp();
  applyAs(app, 'owner1', { cohostOpen: false });
  assert.equal(app.els['cohostOpenBtn'].textContent, 'Closed');
  assert.equal(app.els['cohostInviteBody'].style.display, 'none');
  applyAs(app, 'owner1', { cohostOpen: true });
  assert.equal(app.els['cohostOpenBtn'].textContent, 'Accepting');
  assert.notEqual(app.els['cohostInviteBody'].style.display, 'none');
});

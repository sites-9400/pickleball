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

// The fake-DOM overlay element starts with NO classes, but the real page ships
// it with class="hidden". Prime that state before each join-offer test so
// contains('hidden') assertions mean what they mean in the browser.
function primeOverlay(app) {
  app.run(`document.getElementById('cohostJoinOverlay').classList.add('hidden');`);
}

test('join offer: eligible visitor with token gets the confirm card once', () => {
  const app = loadApp();
  primeOverlay(app);
  app.run(`window._cohostUrlToken = () => 'tok123';`);
  applyAs(app, 'visitor', {});
  assert.ok(!app.els['cohostJoinOverlay'].classList.contains('hidden'), 'overlay should open');
  assert.match(app.els['cohostJoinText'].textContent, /Test Session/);
  // second snapshot must not re-offer after dismissal
  app.run(`closeCohostJoin();`);
  applyAs(app, 'visitor', {});
  assert.ok(app.els['cohostJoinOverlay'].classList.contains('hidden'), 'must not re-open');
});

test('join offer: owner and existing cohost are never prompted', () => {
  const app = loadApp();
  primeOverlay(app);
  app.run(`window._cohostUrlToken = () => 'tok123';`);
  applyAs(app, 'owner1', {});
  assert.ok(app.els['cohostJoinOverlay'].classList.contains('hidden'));

  const app2 = loadApp();
  primeOverlay(app2);
  app2.run(`window._cohostUrlToken = () => 'tok123';`);
  applyAs(app2, 'buddy', { cohosts: { buddy: { name: 'B', addedAt: 1 } } });
  assert.ok(app2.els['cohostJoinOverlay'].classList.contains('hidden'));
});

test('join offer: no token param means no prompt', () => {
  const app = loadApp();
  primeOverlay(app);
  applyAs(app, 'visitor', {});
  assert.ok(app.els['cohostJoinOverlay'].classList.contains('hidden'));
});

test('join rejection: failed write shows dead-link banner', async () => {
  const app = loadApp();
  app.run(`window._cohostUrlToken = () => 'tok123';`);
  app.run(`window._joinAsCohost = () => Promise.reject(new Error('PERMISSION_DENIED'));`);
  applyAs(app, 'visitor', {});
  app.run(`confirmCohostJoin();`);
  await new Promise(r => setImmediate(r)); // let the rejection handler run
  assert.match(app.els['accessBanner'].textContent, /no longer active/);
});

test('join offer: auth resolving after first snapshot still gets the offer', () => {
  const app = loadApp();
  primeOverlay(app);
  app.run(`window._cohostUrlToken = () => 'tok123';`);
  // snapshot arrives BEFORE auth: no uid yet -> no offer, but must NOT latch
  app.run(`window._uid = undefined;`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap())});`);
  assert.ok(app.els['cohostJoinOverlay'].classList.contains('hidden'), 'no offer before auth');
  // auth resolves later; the module-side re-check calls maybeOfferCohostJoin()
  app.run(`window._uid = 'visitor'; maybeOfferCohostJoin();`);
  assert.ok(!app.els['cohostJoinOverlay'].classList.contains('hidden'), 'offer appears after auth resolves');
});

test('join offer: pre-data auth re-check does not act on empty state', () => {
  const app = loadApp();
  primeOverlay(app);
  app.run(`window._cohostUrlToken = () => 'tok123';`);
  // auth resolved but NO snapshot yet (sessionOwnerId still '') -> no offer, no latch
  app.run(`window._uid = 'visitor'; maybeOfferCohostJoin();`);
  assert.ok(app.els['cohostJoinOverlay'].classList.contains('hidden'), 'no offer before first snapshot');
  // snapshot then arrives -> offer appears
  applyAs(app, 'visitor', {});
  assert.ok(!app.els['cohostJoinOverlay'].classList.contains('hidden'), 'offer appears once data lands');
});

test('identity: auth resolving after first snapshot recomputes access', () => {
  const app = loadApp();
  // snapshot with a cohost arrives BEFORE auth: default 'owner' access persists
  app.run(`window._uid = undefined;`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({ cohosts: { buddy: { name: 'Buddy', addedAt: 1 } } }))});`);
  assert.equal(app.run('_access'), 'owner'); // default — the race window
  // auth resolves as the cohost; module-side re-check calls refreshIdentity()
  app.run(`window._uid = 'buddy'; refreshIdentity();`);
  assert.equal(app.run('_access'), 'cohost');
  assert.equal(app.els['sessionActionBtn'].style.display, 'none');
  assert.equal(app.els['sessionNewBtn'].style.display, 'none');
  assert.match(app.els['accessBanner'].textContent, /Co-hosting/);
});

test('identity: refreshIdentity no-ops before any snapshot', () => {
  const app = loadApp();
  app.run(`window._uid = 'stranger'; refreshIdentity();`);
  assert.equal(app.run('_access'), 'owner'); // untouched — no data yet
});

// Organizer request: a photo from the night behind the recap header, visible on the
// view link too. Stored as a compressed JPEG data URL at sessions/$sid/recapPhoto,
// written on its own (never inside saveState, which runs on every score).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRules } from '../scripts/gen-firebase-rules.mjs';
import { loadApp, snap } from './apphtml-harness.mjs';
import '../recap.js';

const { render } = globalThis.PDRecap;
const PHOTO = 'data:image/jpeg;base64,' + 'A'.repeat(200);

test('rules: recapPhoto is owner/co-host writable and must be a capped JPEG data URL', () => {
  const r = buildRules().rules.sessions.$sid.recapPhoto;
  assert.ok(r && r['.write'] && r['.validate']);
  assert.match(r['.validate'], /beginsWith\('data:image\/jpeg;base64,'\)/);
  assert.match(r['.validate'], /length <= \d+/);
  assert.match(r['.validate'], /!newData\.exists\(\)/, 'removing the photo is allowed');
});

function renderRecap(extra) {
  globalThis.document ??= { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}) };
  const c = { innerHTML: '', querySelector: () => null };
  render(c, {
    sessionStartTime: 1700000000000, sessionEndTime: 1700007200000, courtDefs: [{ id: 1 }],
    players: [{ id: 1, name: 'Ana', gamesPlayed: 1, wins: 1, losses: 0, points: 11, pointsAgainst: 3 }],
    gameHistory: [{}], ...extra,
  }, {});
  return c.innerHTML;
}

test('recap header shows the photo behind a dark overlay', () => {
  const html = renderRecap({ recapPhoto: PHOTO });
  assert.match(html, /class="pdr-hero pdr-hero-photo" style="background-image:linear-gradient\(.*?\),url\('data:image\/jpeg;base64,A+'\)/);
});

test('no photo, or anything that is not a JPEG data URL: plain header', () => {
  assert.match(renderRecap({}), /class="pdr-hero">/);
  assert.match(renderRecap({ recapPhoto: "javascript:alert(1)')" }), /class="pdr-hero">/);
});

function app() {
  const a = loadApp();
  const writes = [], photoWrites = [];
  a.windowMock._fbWrite = d => writes.push(d);
  a.windowMock._setRecapPhoto = v => { photoWrites.push(v); return Promise.resolve(); };
  a.run(`window._uid = 'owner1';`);
  a.run(`window._fbApplyRemote(${JSON.stringify(snap({ recapPhoto: PHOTO }))});`);
  return { a, writes, photoWrites };
}

test('photo loads from the session and is never part of saveState', () => {
  const { a, writes } = app();
  assert.equal(a.run('recapPhoto'), PHOTO);
  a.run('saveState()');
  assert.equal('recapPhoto' in writes.at(-1), false);
});

test('owner can remove the photo; it is written on its own', () => {
  const { a, photoWrites } = app();
  a.run('removeRecapPhoto()');
  assert.deepEqual(photoWrites, [null]);
  assert.equal(a.run('recapPhoto'), null);
});

test('viewers cannot change the photo', () => {
  const { a, photoWrites } = app();
  a.run(`_access = 'viewer'; removeRecapPhoto();`);
  assert.deepEqual(photoWrites, []);
});

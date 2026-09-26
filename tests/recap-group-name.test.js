// Organizer request: recap header reads [group / event name], OPEN PLAY RECAP, then
// time and date. The name is editable per session (defaults to the session name).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRules, SESSION_KEYS } from '../scripts/gen-firebase-rules.mjs';
import { loadApp, snap } from './apphtml-harness.mjs';
import '../recap.js';

const { render } = globalThis.PDRecap;
function html(extra) {
  globalThis.document ??= { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}) };
  const c = { innerHTML: '', querySelector: () => null };
  render(c, { sessionName: 'Saturday Open Play', sessionStartTime: 1700000000000, sessionEndTime: 1700007200000,
    courtDefs: [{ id: 1 }], gameHistory: [{}],
    players: [{ id: 1, name: 'Ana', gamesPlayed: 1, wins: 1, losses: 0, points: 11, pointsAgainst: 3 }], ...extra }, {});
  return c.innerHTML;
}

test('header order: group name, OPEN PLAY RECAP, then time/date', () => {
  const h = html({ recapGroup: 'Dink Society <3' });
  const g = h.indexOf('class="pdr-group"'), t = h.indexOf('class="pdr-title"'), m = h.indexOf('class="pdr-meta"');
  assert.ok(g > -1 && g < t && t < m, 'group < title < meta');
  assert.match(h, /class="pdr-group">Dink Society &lt;3</, 'escaped');
});

test('no custom name: falls back to the session name', () => {
  assert.match(html({}), /class="pdr-group">Saturday Open Play</);
});

test('rules: recapGroup is a short string', () => {
  assert.ok(SESSION_KEYS.includes('recapGroup'));
  const r = buildRules().rules.sessions.$sid.recapGroup;
  assert.match(r['.validate'], /isString\(\)/);
  assert.match(r['.validate'], /length <= 60/);
});

function app() {
  const a = loadApp();
  const writes = [];
  a.windowMock._fbWrite = d => writes.push(JSON.parse(JSON.stringify(d)));
  a.run(`window._uid = 'owner1';`);
  a.run(`window._fbApplyRemote(${JSON.stringify(snap({ sessionName: 'Saturday Open Play' }))});`);
  return { a, writes };
}

test('owner sets the name; it is saved and trimmed to 60', () => {
  const { a, writes } = app();
  a.run(`setRecapGroup('  Dink Society  ')`);
  assert.equal(a.run('recapGroup'), 'Dink Society');
  assert.equal(writes.at(-1).recapGroup, 'Dink Society');
  a.run(`setRecapGroup('x'.repeat(80))`);
  assert.equal(a.run('recapGroup').length, 60);
});

test('never-edited sessions do not write the key; viewers cannot edit', () => {
  const { a, writes } = app();
  a.run('saveState()');
  assert.equal('recapGroup' in writes.at(-1), false);
  a.run(`_access = 'viewer'; setRecapGroup('Nope')`);
  assert.equal(a.run('recapGroup'), null);
});

// Real use: "there was no button to save the event name". The box saved only on blur.
test('name box has an explicit Save button and saves on Enter', () => {
  const { a } = app();
  a.run(`_access = 'owner'; sessionEnded = true; renderRecapTab();`);
  const ctl = a.captured['recapPhotoCtl'];
  assert.match(ctl, /id="recapGroupInput"[^>]*oninput="previewRecapGroup\(this\.value\)"/);
  assert.match(ctl, /onkeydown="if\(event\.key==='Enter'\)\{setRecapGroup\(this\.value\);this\.blur\(\)\}"/);
  assert.match(ctl, /<button[^>]*onclick="setRecapGroup\(document\.getElementById\('recapGroupInput'\)\.value\)"[^>]*>Save<\/button>/);
});

test('saving redraws only the recap card, not the name box (keeps typing focus)', () => {
  const { a } = app();
  a.run(`_access = 'owner'; sessionEnded = true; renderRecapTab();`);
  const ctlBefore = a.captured['recapPhotoCtl'];
  a.run(`setRecapGroup('Dink Society')`);
  assert.equal(a.captured['recapPhotoCtl'], ctlBefore, 'control not rebuilt');
});

// Ending a session and tapping Continue later used to count the whole break as play
// time: duration was sessionEndTime - sessionStartTime, and Continue only cleared
// sessionEndTime. A night played 7-9 PM, reopened next morning and ended again showed
// ~15 hours in the recap. Continue now banks the ended stretch in sessionPausedMs and
// every duration (recap, header clock, view link) subtracts it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadApp, snap } from './apphtml-harness.mjs';
import '../recap.js';

const { buildRecapData } = globalThis.PDRecap;
const HOUR = 3600000;
const START = 1700000000000;

test('recap hours exclude time the session sat ended', () => {
  const r = buildRecapData({
    sessionStartTime: START, sessionEndTime: START + 15 * HOUR, sessionPausedMs: 13 * HOUR,
    players: [], gameHistory: [], courtDefs: [],
  }, {});
  assert.equal(r.stats.hours, 2);
});

test('recap hours unchanged for a session that was never continued', () => {
  const r = buildRecapData({
    sessionStartTime: START, sessionEndTime: START + 5 * HOUR,
    players: [], gameHistory: [], courtDefs: [],
  }, {});
  assert.equal(r.stats.hours, 5);
});

function withNow(t, fn) {
  const real = Date.now;
  Date.now = () => t;
  try { return fn(); } finally { Date.now = real; }
}

function endedApp(over = {}) {
  const app = loadApp();
  const writes = [];
  app.windowMock._fbWrite = d => writes.push(JSON.parse(JSON.stringify(d)));
  app.run(`window._uid = 'owner1';`);
  app.run(`window._fbApplyRemote(${JSON.stringify(snap({
    sessionStartTime: START, sessionEnded: true, sessionEndTime: START + 2 * HOUR, ...over,
  }))});`);
  return { app, writes };
}

test('Continue banks the ended stretch; ending again keeps the real play time', () => {
  const { app, writes } = endedApp();
  withNow(START + 15 * HOUR, () => app.run('continueSession()'));   // reopened 13h later
  assert.equal(app.run('sessionPausedMs'), 13 * HOUR);
  assert.equal(writes.at(-1).sessionPausedMs, 13 * HOUR, 'saved to Firebase');

  withNow(START + 16 * HOUR, () => app.run('confirmEndSession()')); // played 1 more hour
  withNow(START + 16 * HOUR, () => app.run('updateSessionClock()'));
  assert.equal(app.els['sessionClock'].textContent, app.run(`formatDuration(${3 * HOUR})`));
});

test('pause accumulates across several end/continue cycles and survives a reload', () => {
  const { app } = endedApp({ sessionPausedMs: 1 * HOUR });
  assert.equal(app.run('sessionPausedMs'), 1 * HOUR, 'loaded from snapshot');
  withNow(START + 3 * HOUR, () => app.run('continueSession()'));     // 1h more ended
  assert.equal(app.run('sessionPausedMs'), 2 * HOUR);
});

test('sessions never continued do not write sessionPausedMs at all', () => {
  const { app, writes } = endedApp({ sessionEnded: false, sessionEndTime: null });
  app.run('saveState()');
  assert.ok(writes.length > 0);
  assert.equal('sessionPausedMs' in writes.at(-1), false,
    'key omitted so saves never depend on the new Firebase rule');
});

test('view link: ended clock subtracts the pause too', () => {
  const html = readFileSync(new URL('../view.html', import.meta.url), 'utf8');
  assert.match(html, /s\.sessionEndTime - s\.sessionStartTime - \(s\.sessionPausedMs \|\| 0\)/);
  assert.match(html, /Date\.now\(\) - s\.sessionStartTime - \(s\.sessionPausedMs \|\| 0\)/);
});

test('sessionPausedMs is an allowed Firebase session key', async () => {
  const { SESSION_KEYS } = await import('../scripts/gen-firebase-rules.mjs');
  assert.ok(SESSION_KEYS.includes('sessionPausedMs'));
});

// Real recap (2026-09-26): a session started Aug 8, played one game, and was only
// ended seven weeks later showed "10:34–5:25 PM" and "1171 HOURS". Time and hours now
// come from actual play (first game start to last game end, idle gaps over an hour
// skipped), falling back to session start/end when games carry no timestamps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../recap.js';

const { buildRecapData, render } = globalThis.PDRecap;
const MIN = 60000, H = 60 * MIN;
const T0 = new Date(2026, 7, 8, 10, 34).getTime();           // Sat Aug 8, 10:34 AM
const P = [{ id: 1, name: 'RR', gamesPlayed: 1, wins: 1, losses: 0, points: 11, pointsAgainst: 2 }];
const g = (s, e) => ({ startedAt: s, endedAt: e });

test('session left open for weeks: time and hours follow the games', () => {
  const r = buildRecapData({ sessionStartTime: T0, sessionEndTime: T0 + 1171 * H, players: P, courtDefs: [],
    gameHistory: [g(T0 + 2 * MIN, T0 + 20 * MIN)] }, {});
  assert.equal(r.timeLabel, '10:36–10:54 AM');
  assert.deepEqual([r.stats.duration, r.stats.durationUnit], [18, 'MIN']);
});

test('a normal 3-hour night reads in hours', () => {
  const games = Array.from({ length: 12 }, (_, i) => g(T0 + i * 15 * MIN, T0 + i * 15 * MIN + 14 * MIN));
  const r = buildRecapData({ sessionStartTime: T0, sessionEndTime: T0 + 3 * H, players: P, courtDefs: [], gameHistory: games }, {});
  assert.deepEqual([r.stats.duration, r.stats.durationUnit], [3, 'HOURS']);
});

test('idle gaps over an hour (a break, or reopening the next day) are not counted', () => {
  const games = [g(T0, T0 + H), g(T0 + 20 * H, T0 + 21 * H)];   // 1h, 19h idle, 1h
  const r = buildRecapData({ sessionStartTime: T0, sessionEndTime: T0 + 21 * H, players: P, courtDefs: [], gameHistory: games }, {});
  assert.deepEqual([r.stats.duration, r.stats.durationUnit], [2, 'HOURS']);
});

test('no game timestamps: falls back to session start/end minus pauses', () => {
  const r = buildRecapData({ sessionStartTime: T0, sessionEndTime: T0 + 15 * H, sessionPausedMs: 13 * H,
    players: P, courtDefs: [], gameHistory: [{}] }, {});
  assert.deepEqual([r.stats.duration, r.stats.durationUnit], [2, 'HOURS']);
});

function html(state) {
  globalThis.document ??= { getElementById: () => null, head: { appendChild() {} }, createElement: () => ({}) };
  const c = { innerHTML: '', querySelector: () => null };
  render(c, state, {});
  return c.innerHTML;
}

test('singular labels: 1 GAME, 1 HOUR', () => {
  const out = html({ sessionStartTime: T0, sessionEndTime: T0 + H, players: P, courtDefs: [{ id: 1 }],
    gameHistory: [g(T0, T0 + H)] });
  assert.match(out, /<b>1<\/b><i>GAME<\/i>/);
  assert.match(out, /<b>1<\/b><i>HOUR<\/i>/);
});

test('meta line only wraps between parts, never inside "COURTS 1–2"', () => {
  const out = html({ sessionStartTime: T0, sessionEndTime: T0 + H, players: P,
    courtDefs: [{ id: 1, name: 'Court 1' }, { id: 2, name: 'Court 2' }], gameHistory: [g(T0, T0 + H)] });
  const meta = out.match(/<div class="pdr-meta">(.*?)<\/div>/)[1];
  const parts = [...meta.matchAll(/<span class="pdr-mp">([^<]*)<\/span>/g)].map(m => m[1]);
  assert.equal(parts.length, 3);
  assert.match(parts[2], /COURTS? 1.2|Courts? 1.2/i);
});

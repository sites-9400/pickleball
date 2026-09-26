// Organizer request: when manually pairing or swapping, flag players who have already
// partnered this session ("dli mamalayan nga nag sabay na sila"). Warning only: nothing
// is blocked and the matchmaking algorithms are untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, snap } from './apphtml-harness.mjs';

const P = (id, name) => ({
  id, name, present: true, gamesPlayed: 1, wins: 0, losses: 0, points: 0, pointsAgainst: 0,
  lastPlayedRound: 1, skill: 'intermediate', events: [],
});
const NAMES = ['Ana', 'Ben', 'Carl', 'Dina', 'Eve', 'Finn', 'Gia', 'Hugo'];

// Ana(1) & Ben(2) partnered in a finished game. Court 1 now: Ana+Carl vs Dina+Eve.
function app({ history } = {}) {
  const a = loadApp();
  a.run(`window._uid = 'owner1';`);
  a.run(`document.getElementById('swapOptions');`);
  a.els.swapOptions.children = [];   // filterSwapOptions walks these; the fake DOM has none
  a.run(`window._fbApplyRemote(${JSON.stringify(snap({
    mode: { matchmaking: 'manual', format: 'doubles' },
    players: NAMES.map((n, i) => P(i + 1, n)),
    queueOrder: [2, 6, 7, 8],
    globalRound: 2,
    courtDefs: [{ id: 1, name: 'Court 1' }, { id: 2, name: 'Court 2' }],
    courts: [{ id: 1, name: 'Court 1', round: 2, submitted: false, startedAt: 1700000000000,
               score1: '', score2: '', team1: [1, 3], team2: [4, 5] }],
    gameHistory: history || [{ round: 1, court: 1, team1: ['Ana', 'Ben'], team2: ['Gia', 'Hugo'],
      team1Ids: [1, 2], team2Ids: [7, 8], score1: 11, score2: 5 }],
  }))});`);
  return a;
}
const option = (html, name) => html.match(new RegExp(`<div class="swap-option[^"]*"[^>]*>(?:(?!</div>).)*${name}(?:(?!</div>).)*</div>`, 's'))?.[0] || '';

test('partnerCount counts games two players shared a team', () => {
  const a = app();
  assert.equal(a.run('partnerCount(1,2)'), 1);
  assert.equal(a.run('partnerCount(1,7)'), 0, 'opponents are not partners');
});

test('swap list flags a candidate who would rejoin a past partner', () => {
  const a = app();
  a.run(`openSwapModal(1,'team1',1)`);          // swap out Carl; Ana stays
  const html = a.captured['swapOptions'];
  assert.match(option(html, 'Ben'), /swap-repeat[^>]*>[^<]*partnered with Ana/);
  assert.doesNotMatch(option(html, 'Finn'), /swap-repeat/, 'no flag without history');
});

test('partner names in history without ids still count (older sessions)', () => {
  const a = app({ history: [{ round: 1, court: 1, team1: ['Ana', 'Ben'], team2: ['Gia', 'Hugo'], score1: 11, score2: 5 }] });
  assert.equal(a.run('partnerCount(1,2)'), 1);
});

test('manual pick warns when a picked team repeats a partnership', () => {
  const a = app();
  a.run('openManualPick(2)');
  ['toggleManualPlayer(2)', 'toggleManualPlayer(1)'].forEach(c => a.run(c)); // Team A: Ben & Ana
  assert.match(a.captured['manualPreview'], /manual-repeat[^>]*>[^<]*Ben &amp; Ana already partnered/);
});

test('manual pick shows no warning for fresh pairs', () => {
  const a = app();
  a.run('openManualPick(2)');
  ['toggleManualPlayer(2)', 'toggleManualPlayer(6)'].forEach(c => a.run(c)); // Ben & Finn
  assert.doesNotMatch(a.captured['manualPreview'], /manual-repeat/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// checkin.html is a Firebase module page, so pull the real readPlayers()
// source out of it and evaluate that function on its own.
const html = readFileSync(new URL('../checkin.html', import.meta.url), 'utf8');
const src = html.match(/function readPlayers\(val\)\{[\s\S]*?\n\}/)[0];
const readPlayers = new Function(`${src}; return readPlayers;`)();

test('QR check-in roster lists players alphabetically, ignoring case', () => {
  const names = readPlayers([
    { name: 'maria', present: false },
    { name: 'Zoe', present: true },
    { name: 'andre', present: false },
    { name: 'Ben', present: false },
  ]).map(p => p.name);
  assert.deepEqual(names, ['andre', 'Ben', 'maria', 'Zoe']);
});

test('alphabetical order also applies to Firebase object-shaped players', () => {
  const names = readPlayers({ a: { name: 'Carl' }, b: { name: 'alice' }, c: null, d: { name: '' } })
    .map(p => p.name);
  assert.deepEqual(names, ['alice', 'Carl']);
});

// docs/firebase-rules.json is generated — this fails if someone hand-edits
// the JSON without updating scripts/gen-firebase-rules.mjs (or forgets to
// regenerate after editing the generator).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRules, SESSION_KEYS } from '../scripts/gen-firebase-rules.mjs';

const RULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'firebase-rules.json');

test('committed firebase-rules.json matches the generator', () => {
  const committed = JSON.parse(readFileSync(RULES, 'utf8'));
  assert.deepEqual(committed, buildRules(),
    'run: node scripts/gen-firebase-rules.mjs (then paste into Firebase Console)');
});

test('every key saveState() writes has a session rule', () => {
  // keep SESSION_KEYS honest against app.html's saveState payload
  const html = readFileSync(join(dirname(RULES), '..', 'app.html'), 'utf8');
  const body = html.slice(html.indexOf('function saveState()'), html.indexOf('function normArr'));
  const m = body.match(/const data = \{([\s\S]*?)\n  \};/);
  assert.ok(m, 'saveState data literal not found');
  const written = [...m[1].matchAll(/^\s*([A-Za-z]\w*)\s*[:,]/gm)].map(x => x[1]);
  for (const key of written) {
    assert.ok(SESSION_KEYS.includes(key), `saveState writes '${key}' but rules have no entry for it`);
  }
});

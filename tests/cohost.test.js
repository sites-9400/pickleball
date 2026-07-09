import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeIdentity, accessState, joinEligibility,
  classifyDashboardEntry, genCohostToken, buildCohostLink,
} from '../cohost.js';

// ---- computeIdentity ----
test('computeIdentity: owner', () => {
  assert.deepEqual(computeIdentity('u1', 'u1', {}), { isOwner: true, isCohost: false });
});
test('computeIdentity: cohost', () => {
  assert.deepEqual(computeIdentity('u2', 'u1', { u2: { name: 'B', addedAt: 1 } }),
    { isOwner: false, isCohost: true });
});
test('computeIdentity: stranger', () => {
  assert.deepEqual(computeIdentity('u3', 'u1', { u2: {} }), { isOwner: false, isCohost: false });
});
test('computeIdentity: null cohosts and missing uid are safe', () => {
  assert.deepEqual(computeIdentity('u2', 'u1', null), { isOwner: false, isCohost: false });
  assert.deepEqual(computeIdentity(null, 'u1', { u2: {} }), { isOwner: false, isCohost: false });
});
test('computeIdentity: owner listed in cohosts is still owner, not cohost', () => {
  assert.deepEqual(computeIdentity('u1', 'u1', { u1: {} }), { isOwner: true, isCohost: false });
});

// ---- accessState ----
test('accessState transitions', () => {
  assert.equal(accessState({ isOwner: true,  isCohost: false, wasCohost: false }), 'owner');
  assert.equal(accessState({ isOwner: false, isCohost: true,  wasCohost: true  }), 'cohost');
  assert.equal(accessState({ isOwner: false, isCohost: false, wasCohost: true  }), 'revoked');
  assert.equal(accessState({ isOwner: false, isCohost: false, wasCohost: false }), 'viewer');
});

// ---- joinEligibility ----
test('joinEligibility: anonymous or missing uid blocked', () => {
  assert.deepEqual(joinEligibility({ uid: 'u2', isAnonymous: true, ownerId: 'u1', cohosts: {} }),
    { eligible: false, reason: 'anonymous' });
  assert.deepEqual(joinEligibility({ uid: null, isAnonymous: false, ownerId: 'u1', cohosts: {} }),
    { eligible: false, reason: 'anonymous' });
});
test('joinEligibility: owner blocked', () => {
  assert.deepEqual(joinEligibility({ uid: 'u1', isAnonymous: false, ownerId: 'u1', cohosts: {} }),
    { eligible: false, reason: 'owner' });
});
test('joinEligibility: already a cohost blocked', () => {
  assert.deepEqual(joinEligibility({ uid: 'u2', isAnonymous: false, ownerId: 'u1', cohosts: { u2: {} } }),
    { eligible: false, reason: 'already' });
});
test('joinEligibility: fresh logged-in user is eligible', () => {
  assert.deepEqual(joinEligibility({ uid: 'u2', isAnonymous: false, ownerId: 'u1', cohosts: null }),
    { eligible: true, reason: 'ok' });
});

// ---- classifyDashboardEntry ----
test('classify: deleted session prunes', () => {
  assert.equal(classifyDashboardEntry({ uid: 'u1', entry: {}, session: null }), 'prune');
});
test('classify: owned session renders as owner', () => {
  assert.equal(classifyDashboardEntry({ uid: 'u1', entry: {}, session: { ownerId: 'u1' } }), 'owner');
});
test('classify: flagged cohost entry with live membership renders as cohost', () => {
  assert.equal(classifyDashboardEntry({
    uid: 'u2', entry: { cohost: true },
    session: { ownerId: 'u1', cohosts: { u2: { name: 'B' } } },
  }), 'cohost');
});
test('classify: revoked cohost prunes (flag set but membership gone)', () => {
  assert.equal(classifyDashboardEntry({
    uid: 'u2', entry: { cohost: true }, session: { ownerId: 'u1', cohosts: {} },
  }), 'prune');
});
test('classify: unowned entry without cohost flag prunes', () => {
  assert.equal(classifyDashboardEntry({
    uid: 'u2', entry: {}, session: { ownerId: 'u1', cohosts: { u2: {} } },
  }), 'prune');
});

// ---- genCohostToken ----
test('genCohostToken: 20 lowercase hex chars, unique per call', () => {
  const a = genCohostToken(), b = genCohostToken();
  assert.match(a, /^[0-9a-f]{20}$/);
  assert.notEqual(a, b);
});

// ---- buildCohostLink ----
test('buildCohostLink: encodes sid and token', () => {
  assert.equal(
    buildCohostLink('https://x.test', '/pd/', 'sid 1', 'tok&2'),
    'https://x.test/pd/app.html?session=sid%201&cohost=tok%262'
  );
});

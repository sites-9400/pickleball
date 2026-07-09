import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadIndexAuth } from './indexhtml-harness.mjs';

// Regression: onAuthStateChanged used to redirect to dashboard the instant
// createUserWithEmailAndPassword resolved — racing (and in a real browser,
// aborting) the follow-up updateProfile + ensureUserProfile writes. New email
// users ended up with no displayName and no users/{uid} profile node.
test('email signup: no redirect until profile writes complete', async () => {
  const { el, location, stub, win } = await loadIndexAuth();
  el('signupName').value = 'Maria S';
  el('signupEmail').value = 'maria@example.com';
  el('signupPassword').value = 'secret123';

  // Hold updateProfile open so we can observe the race window.
  let releaseProfile;
  stub.state.updateProfileDeferred = new Promise(r => { releaseProfile = r; });

  const flow = win.emailSignup();
  await new Promise(r => setImmediate(r)); // createUser resolved; auth state fired; updateProfile pending

  assert.equal(location.href, '', 'must NOT redirect while profile writes are still in flight');

  releaseProfile();
  await flow;

  assert.match(location.href, /dashboard\.html$/, 'flow itself redirects on completion');
  // ensureUserProfile ran to completion: users/{uid} was written with the name
  const profileWrite = stub.calls.sets.find(([path]) => path === 'users/newuser');
  assert.ok(profileWrite, 'users/{uid} profile node must be written before redirect');
  assert.equal(profileWrite[1].displayName, 'Maria S');
});

test('already-signed-in visit (no active flow) still auto-redirects', async () => {
  const { location, stub } = await loadIndexAuth();
  // Simulate Firebase restoring a persisted session on page load.
  stub.state.authCallbacks.forEach(cb => cb({ uid: 'u9', isAnonymous: false }));
  assert.match(location.href, /dashboard\.html$/);
});

test('anonymous user never auto-redirects', async () => {
  const { location, stub } = await loadIndexAuth();
  stub.state.authCallbacks.forEach(cb => cb({ uid: 'anon', isAnonymous: true }));
  assert.equal(location.href, '');
});

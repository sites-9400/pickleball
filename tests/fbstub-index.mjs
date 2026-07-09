// Controllable Firebase stub for index.html's auth module (see indexhtml-harness.mjs).
// Tests drive the deferred promises to reproduce auth-flow races.

export const calls = { sets: [], updates: [] };
export const state = {
  authCallbacks: [],          // onAuthStateChanged listeners
  updateProfileDeferred: null, // set per-test to hold updateProfile open
  getExists: false,           // ensureUserProfile's get().exists()
};

export function initializeApp() { return {}; }
export function getAuth() { return { currentUser: null }; }
export class GoogleAuthProvider {}
export function onAuthStateChanged(auth, cb) { state.authCallbacks.push(cb); }

export function signInWithPopup() { return Promise.reject(Object.assign(new Error('unused'), { code: 'auth/internal-error' })); }
export function signInWithEmailAndPassword() { return Promise.resolve({ user: { uid: 'u1', isAnonymous: false } }); }

export function createUserWithEmailAndPassword(auth, email) {
  const user = { uid: 'newuser', email, displayName: null, isAnonymous: false };
  auth.currentUser = user;
  // Real SDK: auth state observers fire as soon as the account exists —
  // BEFORE the caller's follow-up updateProfile/ensureUserProfile run.
  return Promise.resolve({ user }).then(res => {
    state.authCallbacks.forEach(cb => cb(user));
    return res;
  });
}

export function updateProfile(user, { displayName }) {
  user.displayName = displayName;
  if (state.updateProfileDeferred) return state.updateProfileDeferred;
  return Promise.resolve();
}

export function getDatabase() { return {}; }
export function ref(db, path) { return { path }; }
export function get(r) { return Promise.resolve({ exists: () => state.getExists }); }
export function set(r, val) { calls.sets.push([r.path, val]); return Promise.resolve(); }

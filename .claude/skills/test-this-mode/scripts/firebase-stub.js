// Playwright route-stub that lets the REAL app.html boot offline as a signed-in owner.
// Pass this whole function body to mcp__playwright__browser_run_code_unsafe as the `code`.
// It intercepts the 3 Firebase ESM imports and fulfills them with no-op stubs, then feeds
// one owner-owned session snapshot for the given MODE so app.html renders in owner mode.
//
// Edit MODE below (or the SNAP fields) before running. MODE is the matchmaking key:
//   'random' (=Numbering) | 'waittime' | 'balanced' | 'manual' | 'ladder' |
//   'roundrobin' | 'bracket' | 'challenge'
// FORMAT: 'doubles' | 'singles'.
//
// Prereq: serve the repo locally first, e.g.  python3 -m http.server 8099  (from repo root).
async (page) => {
  const MODE = 'random';       // <-- change to the mode under test
  const FORMAT = 'doubles';
  const BASE = 'http://localhost:8099';

  const APP  = 'https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js';
  const DB   = 'https://www.gstatic.com/firebasejs/11.0.0/firebase-database.js';
  const AUTH = 'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js';

  const appStub = `export function initializeApp(){ return { name:'stub' }; }`;
  const authStub = `
    export function getAuth(){ return { _stub:true }; }
    export function onAuthStateChanged(auth, cb){
      setTimeout(()=>cb({ uid:'testowner', isAnonymous:false, displayName:'Test Owner', email:'owner@test.dev' }),0);
      return ()=>{};
    }`;
  const dbStub = `
    const SNAP = {
      ownerId:'testowner', name:'Demo Open Play', sessionName:'Demo Open Play',
      sessionStartTime: 1738000000000, sessionEnded:false, checkinOpen:false,
      mode:{ matchmaking:'${MODE}', format:'${FORMAT}' },
      players:{ _empty:true }, courts:{ _empty:true }, courtDefs:{ _empty:true },
      matchQueue:{ _empty:true }, gameHistory:{ _empty:true }, queueOrder:{ _empty:true },
      globalRound:0, playerIdCounter:0, courtIdCounter:0, mqIdCounter:0, cohosts:{ _empty:true }
    };
    export function getDatabase(){ return { _stub:true }; }
    export function ref(db, path){ return { path: path||'' }; }
    export function set(){ return Promise.resolve(); }
    export function update(){ return Promise.resolve(); }
    export function remove(){ return Promise.resolve(); }
    export function get(){ return Promise.resolve({ val:()=>null, exists:()=>false }); }
    export function onChildAdded(){ return ()=>{}; }
    export function onValue(reference, cb){
      const p = reference && reference.path || '';
      if (p.indexOf('.info/connected')>=0){ setTimeout(()=>cb({ val:()=>true }),0); return ()=>{}; }
      if (/^sessions\\/[^/]+$/.test(p)){ setTimeout(()=>cb({ val:()=>SNAP }),0); return ()=>{}; }
      setTimeout(()=>cb({ val:()=>null }),0); return ()=>{};
    }`;

  const fulfillJs = (r, body) => r.fulfill({ status:200, contentType:'text/javascript', body });
  await page.route(APP,  r => fulfillJs(r, appStub));
  await page.route(AUTH, r => fulfillJs(r, authStub));
  await page.route(DB,   r => fulfillJs(r, dbStub));

  await page.goto(BASE + '/app.html?session=demo123', { waitUntil:'networkidle' });
  await page.waitForTimeout(1200);
  return await page.evaluate(() => ({
    booted: typeof chooseMatchPlayers === 'function',
    mode: (typeof mm==='function') ? mm() : 'n/a',
    owner: (typeof sessionOwnerId!=='undefined') ? sessionOwnerId : 'n/a',
    fairWired: typeof window.fairWeightedMatch === 'function'
  }));
}

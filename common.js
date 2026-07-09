// Shared page helpers — loaded as a CLASSIC script (<script src="common.js">)
// before each page's own code, so the functions are plain globals. app.html's
// inline onclick handlers and top-level render calls need them before the
// deferred module scripts run, which rules out an ES module here.
// (tournament.js / cohost.js stay ES modules — they're only used from modules.)
//
// These were previously duplicated per page; view.html's copy of the match
// mapping drifting from app.html's is what caused the skipped-match standings
// bug, hence one copy. app.html's implementations are canonical.

// HTML-escape (incl. quotes) — `esc` is app.html's historical name for it.
// var (not const) so a page may shadow it with its own function declaration
// (checkin.html does).
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
var esc = escapeHtml;
function initials(name) { return esc(name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)); }
function avatarColor(name) {
  const colors=['#4A5C2F','#2E5E6E','#5C2F5E','#8B4020','#2F5E4A','#5E4A2F'];
  let hash=0; for(let c of name) hash=(hash*31+c.charCodeAt(0))%colors.length;
  return colors[Math.abs(hash)];
}
function formatDuration(ms) {
  const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
function formatCourtTimer(startedAt) {
  if (!startedAt) return '00:00';
  const ms=Date.now()-startedAt, s=Math.floor(ms/1000), m=Math.floor(s/60), sec=s%60;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
function isCourtWarn(startedAt) { return startedAt && (Date.now()-startedAt) > 20*60*1000; }

// normalize Firebase data — arrays may come back as objects with numeric keys
function normArr(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  // Filter out {_empty:true} sentinel used to preserve empty arrays in Firebase
  if (val._empty === true) return [];
  const keys = Object.keys(val).filter(k => k !== '_empty');
  if (!keys.length) return [];
  if (keys.every(k => !isNaN(parseInt(k)))) return keys.sort((a,b)=>parseInt(a)-parseInt(b)).map(k=>val[k]);
  return Object.values(val); // return as-is for non-numeric-keyed objects
}

// Deep-normalize courts — team1/team2 are arrays that Firebase may objectify
function normCourts(val) {
  return normArr(val).map(c => ({
    ...c,
    team1: normArr(c.team1),
    team2: normArr(c.team2),
  }));
}

// Deep-normalize matchQueue
function normMatchQueue(val) {
  return normArr(val).map(m => ({
    ...m,
    team1: normArr(m.team1),
    team2: normArr(m.team2),
  }));
}

// Deep-normalize gameHistory — team1/team2 are arrays of names
function normGameHistory(val) {
  return normArr(val).map(g => ({
    ...g,
    team1: normArr(g.team1),
    team2: normArr(g.team2),
    team1Ids: normArr(g.team1Ids),
    team2Ids: normArr(g.team2Ids),
  }));
}

// PWA: register the service worker (guarded no-op in tests / old browsers)
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// Pure co-host logic. No DOM, no Firebase, no I/O.
// (crypto.randomUUID is available in both browsers and Node >= 19.)

export function computeIdentity(uid, ownerId, cohosts) {
  const isOwner = !!uid && uid === ownerId;
  const isCohost = !isOwner && !!uid && !!(cohosts && cohosts[uid]);
  return { isOwner, isCohost };
}

export function accessState({ isOwner, isCohost, wasCohost }) {
  if (isOwner) return 'owner';
  if (isCohost) return 'cohost';
  if (wasCohost) return 'revoked';
  return 'viewer';
}

export function joinEligibility({ uid, isAnonymous, ownerId, cohosts }) {
  if (!uid || isAnonymous) return { eligible: false, reason: 'anonymous' };
  if (uid === ownerId) return { eligible: false, reason: 'owner' };
  if (cohosts && cohosts[uid]) return { eligible: false, reason: 'already' };
  return { eligible: true, reason: 'ok' };
}

// Dashboard index entries (users/{uid}/sessions/{sid}) are kept only when the
// session still grants access: owned, or flagged cohost AND still in cohosts.
export function classifyDashboardEntry({ uid, entry, session }) {
  if (!session) return 'prune';
  if (session.ownerId === uid) return 'owner';
  if (entry && entry.cohost === true && session.cohosts && session.cohosts[uid]) return 'cohost';
  return 'prune';
}

export function genCohostToken() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

export function buildCohostLink(origin, basePath, sid, token) {
  return `${origin}${basePath}app.html?session=${encodeURIComponent(sid)}&cohost=${encodeURIComponent(token)}`;
}

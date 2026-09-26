// Generates docs/firebase-rules.json. The per-key session write rules are
// identical for every syncable key, so they are stamped out from SESSION_KEYS
// instead of hand-maintaining 19 copies. To change the rules:
//   1. edit this file,  2. `node scripts/gen-firebase-rules.mjs`,
//   3. paste docs/firebase-rules.json into Firebase Console -> Rules.
// tests/firebase-rules.test.js fails if the committed JSON drifts from this.

const IS_OWNER = "root.child('sessions').child($sid).child('ownerId').val() === auth.uid";
const IS_COHOST = "root.child('sessions').child($sid).child('cohosts').child(auth.uid).exists()";
const NOT_ANON = "auth.token.firebase.sign_in_provider != 'anonymous'";

// Keys saveState() writes — every one is writable by the owner or a co-host
// with a non-anonymous account. ownerId is deliberately NOT here: nothing may
// rewrite it after creation (see the $sid .write create rule).
// Max length of the recap photo data URL (~290 KB of JPEG). app.html compresses below it.
export const RECAP_PHOTO_MAX = 400000;

export const SESSION_KEYS = [
  'players', 'courts', 'courtDefs', 'matchQueue', 'gameHistory', 'queueOrder',
  'globalRound', 'playerIdCounter', 'courtIdCounter', 'mqIdCounter',
  'sessionStartTime', 'sessionName', 'name', 'ladder', 'tournament',
  'sessionEnded', 'sessionEndTime', 'sessionPausedMs', 'upNextAlways', 'recapGroup', 'checkinOpen', 'status',
];

export function buildRules() {
  const perKey = {};
  for (const key of SESSION_KEYS) {
    perKey[key] = { '.write': `${NOT_ANON} && (${IS_OWNER} || ${IS_COHOST})` };
  }
  // Recap event photo: written on its own (not by saveState). Only a JPEG data URL
  // under the cap is accepted, so the slot can't be used as general storage.
  // Group / event name on the recap: a short string.
  perKey.recapGroup['.validate'] = "!newData.exists() || (newData.isString() && newData.val().length <= 60)";
  perKey.recapPhoto = {
    '.write': `${NOT_ANON} && (${IS_OWNER} || ${IS_COHOST})`,
    '.validate': `!newData.exists() || (newData.isString() && newData.val().beginsWith('data:image/jpeg;base64,') && newData.val().length <= ${RECAP_PHOTO_MAX})`,
  };
  return {
    rules: {
      sessions: {
        '.read': 'auth != null',
        '.indexOn': ['ownerId'],
        $sid: {
          // whole-node writes: create requires claiming ownerId as yourself;
          // updates through this rule are owner-only (co-hosts use per-key rules)
          '.write': `auth != null && ${NOT_ANON} && (!data.exists() ? newData.child('ownerId').val() === auth.uid : data.child('ownerId').val() === auth.uid)`,

          cohostOpen: { '.write': IS_OWNER },

          cohosts: {
            '.write': IS_OWNER,
            $uid: {
              // owner manages freely; a user may self-add ONLY while invites are
              // open with the current token, and may self-remove any time
              '.write': `${IS_OWNER} || ($uid === auth.uid && ${NOT_ANON} && (!newData.exists() || (!data.exists() && root.child('sessions').child($sid).child('cohostOpen').val() === true && root.child('cohostTokens').child($sid).exists() && newData.child('token').val() === root.child('cohostTokens').child($sid).val())))`,
              '.validate': "!newData.exists() || newData.hasChildren(['name','addedAt'])",
            },
          },

          ...perKey,

          checkins: {
            $cid: {
              '.write': `auth != null && (${IS_OWNER} || ${IS_COHOST} || (!data.exists() && newData.exists() && root.child('sessions').child($sid).child('checkinOpen').val() === true))`,
              '.validate': "newData.hasChildren(['name','skill','ts'])",
              name: { '.validate': 'newData.isString() && newData.val().length > 0 && newData.val().length <= 40' },
              skill: { '.validate': "newData.isString() && newData.val().matches(/^(beginner|intermediate|advanced)$/)" },
              ts: { '.validate': 'newData.isNumber()' },
              $other: { '.validate': false },
            },
          },
        },
      },
      cohostTokens: {
        $sid: { '.read': IS_OWNER, '.write': IS_OWNER },
      },
      users: {
        $uid: {
          '.read': 'auth != null && auth.uid === $uid',
          '.write': 'auth != null && auth.uid === $uid',
        },
      },
    },
  };
}

// CLI: regenerate docs/firebase-rules.json
// pathToFileURL, not `file://${argv[1]}`: a path with spaces is %20-encoded in import.meta.url
const { pathToFileURL } = await import('node:url');
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { writeFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'firebase-rules.json');
  writeFileSync(out, JSON.stringify(buildRules(), null, 2) + '\n');
  console.log('wrote', out);
}

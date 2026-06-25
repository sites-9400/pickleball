// Pure tournament logic. No DOM, no Firebase, no I/O.

export function buildTeams(playerIds, teamSize) {
  const teams = [];
  let i = 0;
  for (; i + teamSize <= playerIds.length; i += teamSize) {
    teams.push(playerIds.slice(i, i + teamSize));
  }
  return { teams, leftover: playerIds.slice(i) };
}

import { CommandError, type EventState, type Player, type Team } from "./types.js";

export function teamSize(state: EventState): number { return state.settings.playerStructure ?? 1; }
export function competitors(state: EventState): Player[] { return teamSize(state) > 1 ? state.teams ?? [] : state.players; }
export function teamForPlayer(state: EventState, playerId: string): Team | undefined {
  return state.teams?.find(t => t.id === playerId || t.memberIds.includes(playerId));
}
export function competitorId(state: EventState, playerId: string): string {
  if (teamSize(state) === 1) return playerId;
  const team = teamForPlayer(state, playerId);
  if (!team) throw new CommandError("TEAM_NOT_FOUND", "The player is not enrolled on a team.");
  return team.id;
}
export function syncTeamMembers(state: EventState): void {
  for (const team of state.teams ?? []) for (const id of team.memberIds) {
    const p = state.players.find(p => p.id === id);
    if (p) { p.status = team.status; p.droppedAfterRound = team.droppedAfterRound; }
  }
}
export function validateTeamMembers(state: EventState, memberIds: string[], teamId?: string): void {
  if (teamSize(state) === 1) throw new CommandError("INDIVIDUAL_EVENT", "Teams require a team player structure.");
  if (memberIds.length !== teamSize(state) || new Set(memberIds).size !== memberIds.length)
    throw new CommandError("INVALID_TEAM_SIZE", "List each team member once in playing order, matching the player structure.");
  const members = memberIds.map(id => {
    const p = state.players.find(p => p.id === id);
    if (!p) throw new CommandError("PLAYER_NOT_FOUND", "Enroll each team member before creating the team.");
    return p;
  });
  const samePerson = (a: Player, b: Player) => a.id === b.id || (a.userId !== null && a.userId === b.userId) || (a.memberId !== null && a.memberId === b.memberId);
  if (members.some((p, i) => members.slice(i + 1).some(q => samePerson(p, q))))
    throw new CommandError("DUPLICATE_MEMBER", "A person can occupy only one position on a team.");
  const occupied = new Set((state.teams ?? []).filter(t => t.id !== teamId).flatMap(t => t.memberIds));
  if (members.some(p => state.players.some(q => occupied.has(q.id) && samePerson(p, q))))
    throw new CommandError("MEMBER_ALREADY_ON_TEAM", "A player cannot be enrolled on two teams.");
}
export function nextTeamId(state: EventState): string {
  const used = new Set((state.teams ?? []).map(t => t.id));
  let next = 9988000000;
  while (used.has(String(next))) next++;
  if (next > 9998999999) throw new CommandError("TEAM_ID_EXHAUSTED", "There are no unused team IDs.");
  return String(next);
}

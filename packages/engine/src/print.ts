import { competitors, teamForPlayer, teamSize } from "./competitors.js";
import { standings } from "./standings.js";
import type { EventState, PrintableCompetitor, PrintData, PrintMatch } from "./types.js";

/** Staff print data uses full names, even when public pages use initials. */
export function printData(state: EventState): PrintData {
  const people = new Map(state.players.map(p => [p.id, p]));
  const roster = new Map([...state.players, ...competitors(state)].map(p => [p.id, p]));
  function entrant(id: string): PrintableCompetitor {
    const p = roster.get(id);
    return { id, name: p?.name ?? "Unknown participant", memberId: p?.memberId ?? null,
      members: (teamForPlayer(state, id)?.memberIds ?? []).map((id, i) => ({ id, name: people.get(id)?.name ?? "Unknown player", memberId: people.get(id)?.memberId ?? null, position: i + 1 })) };
  }
  const matches: PrintMatch[] = state.rounds.flatMap(r => r.matches.map(m => ({ id: m.id, round: r.number, stage: r.stage,
    table: m.table, tables: m.table === null ? [] : Array.from({ length: teamSize(state) }, (_, i) => m.table! + i),
    p1: entrant(m.p1), p2: m.p2 === null ? null : entrant(m.p2), result: m.result, extensionMinutes: m.extensionMinutes })));
  const pairedDownPlayers: PrintData["pairedDownPlayers"] = [];
  for (const round of state.rounds) {
    if (round.stage !== "swiss") continue;
    const points = new Map(standings({ ...state, cut: [], rounds: state.rounds.filter(r => r.number < round.number) }).map(s => [s.playerId, s.matchPoints]));
    for (const m of round.matches) {
      const a = points.get(m.p1) ?? 0, b = m.p2 === null ? null : points.get(m.p2) ?? 0;
      if (b !== null && a === b) continue;
      const id = b !== null && b > a ? m.p2! : m.p1;
      const opponent = id === m.p1 ? m.p2 : m.p1;
      pairedDownPlayers.push({ round: round.number, matchId: m.id, table: m.table, playerId: id, name: entrant(id).name,
        points: points.get(id) ?? 0, opponentId: opponent, opponentName: opponent === null ? null : entrant(opponent).name,
        opponentPoints: opponent === null ? null : points.get(opponent) ?? 0, isBye: opponent === null });
    }
  }
  const pairingsByTeam: PrintData["pairingsByTeam"] = teamSize(state) === 1 ? [] : matches.flatMap(m => [
    { round: m.round, matchId: m.id, table: m.table, tables: m.tables, team: m.p1, opponent: m.p2, result: m.result },
    ...(m.p2 ? [{ round: m.round, matchId: m.id, table: m.table, tables: m.tables, team: m.p2, opponent: m.p1, result: m.result }] : []),
  ]).sort((a, b) => a.round - b.round || a.team.name.localeCompare(b.team.name));
  return { matches, pairingsByTeam, unreportedMatches: matches.filter(m => m.result === null), pairedDownPlayers,
    penalties: state.penalties.map(p => ({ ...p, player: entrant(p.playerId), infraction: state.settings.infractions.find(i => i.id === p.infractionId)?.label ?? p.infractionId,
      judge: state.staff.find(s => s.id === p.judge)?.name ?? p.judge })) };
}

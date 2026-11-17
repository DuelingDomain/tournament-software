import { CommandError, type EventState, type Match, type PlayerView, type PublicMatchView, type PublicView } from "./types.js";
import { standings } from "./standings.js";

function displayName(state: EventState, name: string): string {
  if (state.settings.publicNames === "full") return name;
  const parts = name.trim().split(/\s+/);
  return parts.length < 2 ? name : `${parts[0]} ${Array.from(parts.at(-1) ?? "")[0]}.`;
}

function matchView(state: EventState, match: Match, points: Map<string, number>): PublicMatchView {
  const names = new Map(state.players.map(p => [p.id, displayName(state, p.name)]));
  return { id: match.id, table: match.table, p1Id: match.p1, p2Id: match.p2,
    p1: names.get(match.p1) ?? "Unknown player", p2: match.p2 === null ? null : names.get(match.p2) ?? "Unknown player",
    result: match.result, p1Points: points.get(match.p1) ?? 0, p2Points: match.p2 === null ? null : points.get(match.p2) ?? 0 };
}

export function publicView(state: EventState, version: number): PublicView {
  const rows = standings(state);
  const points = new Map(rows.map(s => [s.playerId, s.matchPoints]));
  const round = state.rounds.at(-1);
  return {
    name: state.settings.name, format: state.settings.format, phase: state.phase,
    location: state.settings.location, startsAt: state.settings.startsAt,
    plannedRounds: state.settings.plannedRounds, topCut: state.settings.topCut, tiebreak: state.settings.tiebreak,
    playerCount: state.players.length, version,
    currentRound: round ? { number: round.number, stage: round.stage, startedAt: round.startedAt, endsAt: round.endsAt,
      matches: round.matches.map(m => matchView(state, m, points)) } : null,
    standings: rows.map(s => ({ ...s, name: displayName(state, s.name) })),
    bracket: state.rounds.filter(r => r.stage === "playoff").map(r => ({ round: r.number, matches: r.matches.map(m => matchView(state, m, points)) })),
  };
}

export function playerView(state: EventState, playerId: string, version: number): PlayerView {
  const me = state.players.find(p => p.id === playerId);
  if (!me) throw new CommandError("PLAYER_NOT_FOUND", "That player is not registered for this event.");
  const event = publicView(state, version);
  const current = state.rounds.at(-1)?.matches.find(m => m.p1 === playerId || m.p2 === playerId);
  const visible = event.currentRound?.matches.find(m => m.id === current?.id);
  const standing = standings(state).find(s => s.playerId === playerId) ?? null;
  const history: PlayerView["history"] = [];
  for (const round of state.rounds) for (const m of round.matches) {
    if (m.p1 !== playerId && m.p2 !== playerId) continue;
    const opponentId = m.p1 === playerId ? m.p2 : m.p1;
    const opponent = state.players.find(p => p.id === opponentId);
    const result = m.result === "p1" ? (m.p1 === playerId ? "win" : "loss")
      : m.result === "p2" ? (m.p2 === playerId ? "win" : "loss") : m.result;
    history.push({ round: round.number, opponent: opponent ? displayName(state, opponent.name) : null, result });
  }
  return { event, me: { id: me.id, name: me.name, status: me.status, standing }, history,
    currentMatch: current && visible ? { ...visible,
      myReport: current.reports.find(r => r.by === playerId)?.result ?? null,
      opponentReport: current.reports.find(r => r.by !== playerId)?.result ?? null } : null };
}

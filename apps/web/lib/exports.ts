import { standings, type EventState } from "@dd-tournament/engine";
import { serializeLegacyPlayerList, serializeLegacyTournament } from "@dd-tournament/engine/legacy";
import { HttpError } from "./http";
import type { EventRecord } from "./db";

function csv(rows: (string | number | null)[][]) {
  return rows.map(row => row.map(value => {
    const cell = String(value ?? "");
    return `"${(/^[=+@\-\t\r]/.test(cell) ? "'" + cell : cell).replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n") + "\r\n";
}
function playerList(state: EventState) {
  return state.players.map(player => {
    const [firstName = "", ...last] = player.name.split(/\s+/);
    return { firstName, lastName: last.join(" "), memberId: player.memberId };
  });
}
export function exportEvent(event: EventRecord, kind: string) {
  const state = event.state;
  let body: string;
  let filename: string;
  let contentType = "text/csv; charset=utf-8";
  switch (kind) {
    case "tournament": body = serializeLegacyTournament(state); filename = `${event.code}.Tournament`; contentType = "application/xml; charset=utf-8"; break;
    case "players-xml": body = serializeLegacyPlayerList(playerList(state)); filename = `${event.code}-AllPlayers.xml`; contentType = "application/xml; charset=utf-8"; break;
    case "players.csv": body = csv([["playerId", "name", "memberId", "status", "checkedIn"], ...state.players.map(p => [p.id, p.name, p.memberId, p.status, String(p.checkedIn)])]); filename = `${event.code}-players.csv`; break;
    case "standings.csv": body = csv([["rank", "playerId", "name", "matchPoints", "wins", "losses", "draws", "omw", "oomw"], ...standings(state).map(s => [s.rank, s.playerId, s.name, s.matchPoints, s.record.wins, s.record.losses, s.record.draws, s.omw, s.oomw])]); filename = `${event.code}-standings.csv`; break;
    case "matches.csv": body = csv([["round", "table", "matchId", "p1", "p2", "result"], ...state.rounds.flatMap(r => r.matches.map(m => [r.number, m.table, m.id, m.p1, m.p2, m.result]))]); filename = `${event.code}-matches.csv`; break;
    default: throw new HttpError(404, "not_found");
  }
  return new Response(body, { headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
}

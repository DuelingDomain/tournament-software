import { standings, teamForPlayer, teamSize, type EventState } from "@dd-tournament/engine";
import { serializeLegacyPlayerList, serializeLegacyTournament } from "@dd-tournament/engine/legacy";
import { createHash } from "node:crypto";
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
/** The original wrote `<Name> (ID <id>).Tournament`, with characters a file name cannot hold changed to "_". */
export function cleanFilename(name: string) { return name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") || "Tournament"; }
/** A stable file-format event ID for an event code. */
export function legacyEventId(code: string) {
  return `X99-${String(createHash("sha256").update(code).digest().readUInt32BE(0) % 1_000_000).padStart(6, "0")}`;
}
export function attachment(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
export function csvDownload(body: string, filename: string) {
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": attachment(filename), "Cache-Control": "no-store" } });
}
export function exportEvent(event: EventRecord, kind: string) {
  const state = event.state;
  let body: string;
  let filename: string;
  let contentType = "text/csv; charset=utf-8";
  switch (kind) {
    case "tournament": case "finalized": {
      if (kind === "finalized" && state.phase !== "complete") throw new HttpError(422, "NOT_FINALIZED");
      const eventId = legacyEventId(event.code);
      body = serializeLegacyTournament(state, { eventId }); filename = `${cleanFilename(state.settings.name)} (ID ${eventId}).Tournament`; contentType = "application/xml; charset=utf-8"; break;
    }
    case "players-xml": body = serializeLegacyPlayerList(playerList(state)); filename = `${event.code}-AllPlayers.xml`; contentType = "application/xml; charset=utf-8"; break;
    case "players.csv": body = csv([["playerId", "name", "memberId", "status", "checkedIn", ...(teamSize(state) > 1 ? ["teamId", "teamName", "position", "userId"] : [])], ...state.players.map(p => {
      const team = teamForPlayer(state, p.id);
      return [p.id, p.name, p.memberId, p.status, String(p.checkedIn), ...(teamSize(state) > 1 ? [team?.id ?? null, team?.name ?? null, team ? team.memberIds.indexOf(p.id) + 1 : null, p.userId] : [])];
    })]); filename = `${event.code}-players.csv`; break;
    case "standings.csv": body = csv([["rank", "playerId", "name", "matchPoints", "wins", "losses", "draws", "omw", "oomw", "openDuelingPoints", ...(teamSize(state) > 1 ? ["teamId", "teamName", "userId"] : [])], ...standings(state).flatMap(s => {
      const team = teamForPlayer(state, s.playerId);
      const members = team ? team.memberIds.map(id => state.players.find(p => p.id === id)!) : [state.players.find(p => p.id === s.playerId)!];
      return members.filter(Boolean).map(p => [s.rank, p.id, p.name, s.matchPoints, s.record.wins, s.record.losses, s.record.draws, s.omw, s.oomw, s.openDuelingPoints ?? 0,
        ...(teamSize(state) > 1 ? [team?.id ?? null, team?.name ?? null, p.userId] : [])]);
    })]); filename = `${event.code}-standings.csv`; break;
    case "matches.csv": body = csv([["round", "table", "matchId", "p1", "p2", "result", ...(teamSize(state) > 1 ? ["team1", "team2", "p1UserId", "p2UserId"] : [])], ...state.rounds.flatMap(r => r.matches.flatMap(m => {
      if (teamSize(state) === 1) return [[r.number, m.table, m.id, m.p1, m.p2, m.result]];
      const left = teamForPlayer(state, m.p1), right = m.p2 === null ? undefined : teamForPlayer(state, m.p2);
      return (left?.memberIds ?? []).map((id, index) => {
        const other = right?.memberIds[teamSize(state) === 2 ? 1 - index : index] ?? null;
        return [r.number, m.table === null ? null : m.table + index, m.id, id, other, m.result, m.p1, m.p2,
          state.players.find(p => p.id === id)?.userId ?? null, state.players.find(p => p.id === other)?.userId ?? null];
      });
    }))]); filename = `${event.code}-matches.csv`; break;
    default: throw new HttpError(404, "not_found");
  }
  return new Response(body, { headers: { "Content-Type": contentType, "Content-Disposition": attachment(filename), "Cache-Control": "no-store" } });
}

import { CommandError, type EventState, type Penalty, type Player } from "../types.js";
import { normalizeMemberId, padMemberId } from "../member-id.js";
import { standings } from "../standings.js";
import type { LegacyPlayer } from "./parse.js";
import { buildXml } from "./xml.js";

export interface LegacyExportOptions {
  eventId?: string;
  /** Optional original name parts from an import, keyed by event player ID. */
  playerNames?: Readonly<Record<string, Pick<LegacyPlayer, "firstName" | "lastName">>>;
}

function names(name: string) {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0], lastName: parts.length > 1 ? parts.at(-1) ?? "" : "" };
}

function playerXml(id: string, name: Pick<LegacyPlayer, "firstName" | "lastName">) {
  return { ID: id, FirstName: name.firstName, LastName: name.lastName, TeamPosition: 0 };
}

function penaltyCode(penalty: Penalty): string {
  switch (penalty) {
    case "caution": return "00";
    case "warning": return "01";
    case "game_loss": return "02";
    case "match_loss": return "03";
    case "disqualification": return "05";
  }
}

const infractionNames = ["None", "ProceduralErrorMinor", "ProceduralErrorMajor", "ProceduralErrorStrict", "TardinessMajor", "TardinessStrict", "DeckErrorMinor", "DeckErrorMajor", "DrawingCardsMinor", "DrawingCardsMajor", "MarkedCardsMinor", "MarkedCardsMajor", "SlowPlayMinor", "UnsportingConductMinor", "UnsportingConductMajor", "UnsportingConductSevere", "Cheating"];
const defaultInfractionNames: Readonly<Record<string, string>> = {
  slow_play: "SlowPlayMinor", conduct_minor: "UnsportingConductMinor", deck_problem: "DeckErrorMajor", extra_look: "ProceduralErrorMinor",
  extra_draw: "DrawingCardsMajor", rule_violation: "ProceduralErrorMinor", maintain_state: "ProceduralErrorMinor", communication: "ProceduralErrorMinor",
  tardiness: "TardinessMajor", outside_help: "UnsportingConductMajor", marked_cards: "MarkedCardsMajor", cheating: "Cheating",
};

export function serializeLegacyTournament(state: EventState, opts: LegacyExportOptions = {}): string {
  const used = new Set(state.players.flatMap(p => p.memberId === null ? [] : [normalizeMemberId(p.memberId)]));
  let next = 9999000000;
  function temporaryId(): string {
    while (used.has(String(next))) next++;
    if (next > 9999999999) throw new CommandError("legacy_id_exhausted", "There are no unused temporary legacy player IDs.");
    const id = String(next++); used.add(id); return padMemberId(id);
  }
  const ids = new Map<string, string>();
  const assigned = new Set<string>();
  for (const p of state.players) {
    const normalized = p.memberId === null ? null : normalizeMemberId(p.memberId);
    const id = normalized && normalized !== "0" && !assigned.has(normalized) ? padMemberId(normalized) : temporaryId();
    assigned.add(normalizeMemberId(id) ?? id);
    ids.set(p.id, id);
  }
  function idFor(playerId: string): string {
    const id = ids.get(playerId);
    if (!id) throw new CommandError("PLAYER_NOT_FOUND", "A legacy match or penalty references an unknown event player.");
    return id;
  }
  const rows = new Map(standings({ ...state, settings: { ...state.settings, tiebreak: "legacy" } }).map(s => [s.playerId, s]));
  const current = state.rounds.at(-1)?.number ?? 0;
  const firstPlayoff = state.rounds.find(r => r.stage === "playoff");
  function dropRound(p: Player): number {
    if (p.status === "active") return 0;
    if (p.droppedAfterRound !== null && p.droppedAfterRound > 0) return p.droppedAfterRound;
    const cut = state.swissCuts.find(c => c.cutPlayers.includes(p.id));
    if (cut) return cut.afterRound;
    if (firstPlayoff && !state.cut.includes(p.id)) return Math.max(1, firstPlayoff.number - 1);
    const lost = state.rounds.find(r => r.stage === "playoff" && r.matches.some(m => (m.p1 === p.id && m.result === "p2") || (m.p2 === p.id && m.result === "p1")));
    return lost?.number ?? Math.max(1, current);
  }
  const staffIds = new Map(state.staff.map(s => [s.id, temporaryId()]));
  const roleCodes = { organizer: "01", head_judge: "02", judge: "05", scorekeeper: "06", staff: "08" };
  const date = state.settings.startsAt && Number.isFinite(Date.parse(state.settings.startsAt)) ? new Date(state.settings.startsAt).toISOString() : state.createdAt;
  return buildXml("Tournament", {
    Name: state.settings.name, ID: opts.eventId ?? "X99-000000", TournamentStyleCode: "01",
    StructureCode: state.settings.format === "single_elim" ? "02" : "01", EventTypeCode: "01", PlayerStructure: "01",
    ReferenceDateTime: "2003-01-02", Date: date.slice(0, 10), Time: date.slice(11, 16), CurrentRound: current,
    TableOffset: state.settings.startingTable, PlayoffRound: firstPlayoff?.number ?? 0, SoftwareVersion: "3.0.0.0", Finalized: state.phase === "complete" ? "True" : "False",
    Staff: { XmlStaffArray: { XmlStaff: state.staff.map(s => ({ Player: playerXml(staffIds.get(s.id) ?? "0000000000", names(s.name)), XmlStaffPositionCode: roleCodes[s.role] })) } },
    PenaltyList: { PlayerPenalty: state.penalties.map(p => {
      const infraction = state.settings.infractions.find(i => i.id === p.infractionId);
      const label = infraction?.label ?? p.infractionId;
      const legacyName = infractionNames.includes(label) ? label : Object.hasOwn(defaultInfractionNames, p.infractionId) ? defaultInfractionNames[p.infractionId] : "None";
      const judge = state.staff.find(s => s.id === p.judge || s.name === p.judge);
      return { Infraction: legacyName, InfractionCode: "08", PenaltyCode: penaltyCode(p.penalty), Player: idFor(p.playerId),
        Judge: judge ? staffIds.get(judge.id) : "0000000000", Round: p.round ?? 0,
        Notes: legacyName === "None" && label !== "None" ? `[Infraction: ${label}]${p.notes ? ` ${p.notes}` : ""}` : p.notes ?? "" };
    }) },
    Location: { Id: "00000000-0000-0000-0000-000000000000", Name: state.settings.location ?? "", Address1: "", Address2: "", City: "", State: "", Country: "", Zip: "", Phone: "", WebSite: "" },
    TournamentPlayers: { TournPlayer: [...state.players].sort((a, b) => idFor(a.id).localeCompare(idFor(b.id))).map(p => {
      const row = rows.get(p.id);
      return { Player: playerXml(idFor(p.id), opts.playerNames?.[p.id] ?? names(p.name)), DropRound: dropRound(p), Rank: row?.rank ?? 0,
        PlayoffPoints: state.rounds.filter(r => r.stage === "playoff").flatMap(r => r.matches).filter(m => (m.p1 === p.id && (m.result === "p1" || m.result === "bye_win")) || (m.p2 === p.id && m.result === "p2")).length,
        Wins: row?.matchPoints ?? 0, Points: row ? row.matchPoints * 1000000 + Math.round(row.omw * 10) * 1000 + Math.round(row.oomw * 10) : 0, OpenDueling: 0,
        DropReason: p.status === "active" ? "Active" : p.status === "dropped" ? "Drop" : state.cut.includes(p.id) ? "PlayoffCut" : "Cut",
        AssignedSeat: p.fixedTable ?? 0, Notes: p.notes ?? "" };
    }) },
    Matches: { TournMatch: state.rounds.flatMap(r => r.matches.map(m => ({ Player: [idFor(m.p1), m.p2 === null ? "0000000000" : idFor(m.p2)], Round: r.number,
      Status: m.result === null ? "Incomplete" : m.result === "draw" ? "Draw" : m.result === "double_loss" ? "DoubleLoss" : "Winner",
      Table: m.table ?? 0, Winner: m.result === "p1" || m.result === "bye_win" ? idFor(m.p1) : m.result === "p2" && m.p2 !== null ? idFor(m.p2) : "0000000000",
      PlayoffMatch: r.stage === "playoff" ? "True" : "False" }))) },
  });
}

export function serializeLegacyPlayerList(list: readonly LegacyPlayer[]): string {
  return buildXml("PlayerList", { Player: [...list].sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)).map(p => ({
    FirstName: p.firstName, LastName: p.lastName, ID: p.memberId === null ? "" : normalizeMemberId(p.memberId) ?? "",
  })) });
}

import { CommandError, type EventState, type Penalty, type Player } from "../types.js";
import { FIRST_TEMPORARY_MEMBER_ID, MEMBER_ID_LIMIT, normalizeMemberId, padMemberId } from "../member-id.js";
import { teamSize } from "../competitors.js";
import { ROLE_POSITIONS, staffPositionCode } from "../staff.js";
import { encodedPoints, playoffWins, standings } from "../standings.js";
import { LEGACY_SOFTWARE_VERSION, type LegacyPlayer } from "./parse.js";
import { buildXml } from "./xml.js";
import { defaultInfractionNames, infractionNames } from "./infractions.js";

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

export function serializeLegacyTournament(state: EventState, opts: LegacyExportOptions = {}): string {
  const used = new Set(state.players.flatMap(p => p.memberId === null ? [] : [normalizeMemberId(p.memberId)]));
  let next = FIRST_TEMPORARY_MEMBER_ID;
  function temporaryId(): string {
    while (used.has(String(next))) next++;
    if (next >= MEMBER_ID_LIMIT) throw new CommandError("legacy_id_exhausted", "There are no unused temporary legacy player IDs.");
    const id = String(next++); used.add(id); return padMemberId(id);
  }
  const ids = new Map<string, string>();
  const assigned = new Set<string>((state.teams ?? []).map(t => t.id));
  for (const p of state.players) {
    const normalized = p.memberId === null ? null : normalizeMemberId(p.memberId);
    const id = normalized && normalized !== "0" && !assigned.has(normalized) ? padMemberId(normalized) : temporaryId();
    assigned.add(normalizeMemberId(id) ?? id);
    ids.set(p.id, id);
  }
  for (const t of state.teams ?? []) ids.set(t.id, t.id);
  function idFor(playerId: string): string {
    const id = ids.get(playerId);
    if (!id) throw new CommandError("PLAYER_NOT_FOUND", "A legacy match or penalty references an unknown event player.");
    return id;
  }
  const rows = new Map(standings({ ...state, settings: { ...state.settings, tiebreak: "legacy" } }).map(s => [s.playerId, s]));
  const current = state.rounds.at(-1)?.number ?? 0;
  const wins = playoffWins(state, current);
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
  const legacyStaff = state.legacyStaff ?? [];
  const legacyStaffIds = legacyStaff.map(s => {
    const normalized = s.memberId === null ? null : normalizeMemberId(s.memberId);
    if (normalized && normalized !== "0" && !used.has(normalized) && !assigned.has(normalized)) {
      used.add(normalized); return padMemberId(normalized);
    }
    return temporaryId();
  });
  const staffEntries = [
    ...state.staff.map(s => ({ Player: playerXml(staffIds.get(s.id)!, names(s.name)), XmlStaffPositionCode: staffPositionCode(s.position ?? ROLE_POSITIONS[s.role]) })),
    ...legacyStaff.map((s, i) => ({ Player: playerXml(legacyStaffIds[i], names(s.name)), XmlStaffPositionCode: staffPositionCode(s.position) })),
  ];
  function dropReason(p: Player): string {
    if (p.status === "active") return "Active";
    if (p.status === "dropped") return "Drop";
    const swissCut = state.swissCuts.find(c => c.cutPlayers.includes(p.id));
    if (swissCut) return swissCut.mode === "top" ? "TopX" : "Cut";
    return firstPlayoff && state.settings.format !== "single_elim" ? "PlayoffCut" : "Cut";
  }
  function rosterFields(p: Player) {
    const row = rows.get(p.id);
    return { DropRound: dropRound(p), Rank: row?.rank ?? 0,
      PlayoffPoints: wins.get(p.id) ?? 0,
      Wins: row?.matchPoints ?? 0, Points: row ? encodedPoints(row) : 0, OpenDueling: p.openDuelingPoints ?? 0,
      DropReason: dropReason(p),
      AssignedSeat: p.fixedTable ?? -1, Notes: p.notes ?? "" };
  }
  const roster = teamSize(state) === 1 ? { TournPlayer: [...state.players].sort((a, b) => idFor(a.id).localeCompare(idFor(b.id))).map(p => ({
    Player: playerXml(idFor(p.id), opts.playerNames?.[p.id] ?? names(p.name)), ...rosterFields(p),
  })) } : { TournamentTeam: (state.teams ?? []).map(t => ({ Team: { ID: t.id, FirstName: t.name, LastName: "", PlayerList: { Player: t.memberIds.map((id, index) => {
    const member = state.players.find(p => p.id === id);
    if (!member) throw new CommandError("PLAYER_NOT_FOUND", "The team references an unknown member.");
    return { ...playerXml(idFor(id), opts.playerNames?.[id] ?? names(member.name)), TeamPosition: index };
  }) } }, ...rosterFields(t) })) };
  if (teamSize(state) > 1) {
    const enrolled = new Set((state.teams ?? []).flatMap(t => t.memberIds));
    Object.assign(roster, { TournPlayer: state.players.filter(p => !enrolled.has(p.id)).map(p => ({ Player: playerXml(idFor(p.id), opts.playerNames?.[p.id] ?? names(p.name)), ...rosterFields(p) })) });
  }
  const location = state.settings.locationDetails;
  const date = state.settings.startsAt && Number.isFinite(Date.parse(state.settings.startsAt)) ? new Date(state.settings.startsAt).toISOString() : state.createdAt;
  const tableOffset = state.settings.startingTable - 1;
  return buildXml("Tournament", {
    Name: state.settings.name, ID: opts.eventId ?? state.legacyEventId ?? "X99-000000", TournamentStyleCode: ({ advanced: "01", traditional: "02", sealed: "03", open_dueling: "04" } as const)[state.settings.style ?? "advanced"],
    StructureCode: state.settings.format === "single_elim" ? "02" : state.settings.format === "open_dueling" ? "03" : "01", EventTypeCode: "01", PlayerStructure: String(teamSize(state)).padStart(2, "0"),
    ReferenceDateTime: "2003-01-02", Date: date.slice(0, 10), Time: date.slice(11, 16), CurrentRound: current,
    TableOffset: tableOffset, PlayoffRound: state.settings.format === "single_elim" ? 0 : firstPlayoff?.number ?? 0, SoftwareVersion: LEGACY_SOFTWARE_VERSION, Finalized: state.phase === "complete" ? "True" : "False",
    Staff: { XmlStaffArray: { XmlStaff: staffEntries } },
    PenaltyList: { PlayerPenalty: state.penalties.map(p => {
      const infraction = state.settings.infractions.find(i => i.id === p.infractionId);
      const label = infraction?.label ?? p.infractionId;
      const legacyName = infractionNames.includes(label) ? label : Object.hasOwn(defaultInfractionNames, p.infractionId) ? defaultInfractionNames[p.infractionId] : "None";
      const judge = state.staff.find(s => s.id === p.judge || s.name === p.judge);
      const legacyJudge = legacyStaff.findIndex(s => s.name === p.judge || s.memberId === p.judge);
      return { Infraction: legacyName, InfractionCode: "08", PenaltyCode: penaltyCode(p.penalty), Player: idFor(p.playerId),
        Judge: judge ? staffIds.get(judge.id) : legacyJudge >= 0 ? legacyStaffIds[legacyJudge] : "0000000000", Round: p.round ?? 0,
        Notes: legacyName !== label ? `[Infraction: ${label}]${p.notes ? ` ${p.notes}` : ""}` : p.notes ?? "" };
    }) },
    Location: { Id: location?.id ?? "00000000-0000-0000-0000-000000000000", Name: location?.name ?? state.settings.location ?? "", Address1: location?.address1 ?? "", Address2: location?.address2 ?? "", City: location?.city ?? "", State: location?.state ?? "", Country: location?.country ?? "", Zip: location?.postal ?? "", Phone: location?.phone ?? "", WebSite: location?.website ?? "" },
    TournamentPlayers: roster,
    Matches: { TournMatch: state.rounds.flatMap(r => r.matches.map(m => ({ Player: [idFor(m.p1), m.p2 === null ? "0000000000" : idFor(m.p2)], Round: r.number,
      Status: m.result === null ? "Incomplete" : m.result === "draw" ? "Draw" : m.result === "double_loss" ? "DoubleLoss" : "Winner",
      Table: (m.table ?? m.byeTable ?? tableOffset) - tableOffset, Winner: m.result === "p1" || m.result === "bye_win" ? idFor(m.p1) : m.result === "p2" && m.p2 !== null ? idFor(m.p2) : "0000000000",
      PlayoffMatch: r.stage === "playoff" ? "True" : "False" }))) },
  });
}

export function serializeLegacyPlayerList(list: readonly LegacyPlayer[]): string {
  return buildXml("PlayerList", { Player: [...list].sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)).map(p => ({
    FirstName: p.firstName, LastName: p.lastName, ID: p.memberId === null ? "" : normalizeMemberId(p.memberId) ?? "",
  })) });
}

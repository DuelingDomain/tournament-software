import { CommandError, type CommandContext, type EventState, type MatchResult, type Penalty, type Player, type PlayerStructure, type Round, type StaffPosition, type Team } from "../types.js";
import { createEvent } from "../reducer.js";
import { isTeamId, normalizeMemberId } from "../member-id.js";
import { syncTeamMembers, teamSize, validateTeamMembers } from "../competitors.js";
import { STAFF_POSITIONS } from "../staff.js";
import { integrity } from "../integrity.js";
import { Element, parseXml } from "./xml.js";
import { builtInInfractionId } from "./infractions.js";

export interface LegacyPlayer { memberId: string | null; firstName: string; lastName: string }
export interface LegacyTournamentImport {
  state: EventState;
  players: (LegacyPlayer & { playerId: string })[];
  warnings: string[];
}

function readPlayer(node: Element): LegacyPlayer {
  return { memberId: normalizeMemberId(node.get("ID")), firstName: node.get("FirstName"), lastName: node.get("LastName") };
}

export function parseLegacyPlayerList(xml: string): LegacyPlayer[] {
  return parseXml(xml, "PlayerList").all("Player").map(readPlayer);
}

function timestamp(root: Element, warnings: string[]): string | null {
  const date = root.get("Date");
  if (!date) return null;
  const parts = date.match(/\d+/g);
  const reference = root.get("ReferenceDateTime").match(/\d+/g) ?? ["2003", "01", "02"];
  const fields = reference.slice(0, 3).map(Number);
  if (parts && parts.length >= 3 && fields.includes(2003) && fields.includes(1) && fields.includes(2)) {
    const year = Number(parts[fields.indexOf(2003)]);
    const month = Number(parts[fields.indexOf(1)]);
    const day = Number(parts[fields.indexOf(2)]);
    const time = root.get("Time").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    const hour = time ? Number(time[1]) : 0, minute = time ? Number(time[2]) : 0, second = time ? Number(time[3] ?? 0) : 0;
    const result = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (result.getUTCFullYear() === year && result.getUTCMonth() === month - 1 && result.getUTCDate() === day && hour < 24 && minute < 60 && second < 60) return result.toISOString();
  }
  warnings.push(`The legacy event date could not be read: ${date}.`);
  return null;
}

function readPenalty(node: Element): Penalty {
  const old = node.get("Penalty");
  if (old) {
    switch (old.replace(/\s/g, "").replace(/^0+(?=\d)/, "").toLowerCase()) {
      case "none": case "caution": case "0": case "1": return "caution";
      case "warning": case "2": return "warning";
      case "gameloss": case "3": return "game_loss";
      case "matchloss": case "4": return "match_loss";
      default: return "disqualification";
    }
  }
  switch (node.get("PenaltyCode")) {
    case "0": case "00": return "caution";
    case "2": case "02": return "game_loss";
    case "3": case "03": return "match_loss";
    case "4": case "04": case "5": case "05": return "disqualification";
    default: return "warning";
  }
}

function matchResult(node: Element, p1: string, p2: string | null, winner: string): MatchResult | null {
  switch (node.get("Status").toLowerCase()) {
    case "winner": case "1": return p2 === null ? (winner === p1 ? "bye_win" : "bye_loss") : winner === p1 ? "p1" : winner === p2 ? "p2" : "double_loss";
    case "draw": case "2": return p2 === null ? "bye_loss" : "draw";
    case "doubleloss": case "3": return p2 === null ? "bye_loss" : "double_loss";
    default: return null;
  }
}

function key(id: string): string { return normalizeMemberId(id) ?? id; }
function isBye(id: string): boolean { return id === "" || normalizeMemberId(id) === "0"; }

/** Same as the original: a file written by a newer program version is refused. */
/** Longest event name read from a file. */
const MAX_EVENT_NAME = 200;
export const LEGACY_SOFTWARE_VERSION = "3.0.0.0";
function newerThanSupported(version: string): boolean {
  if (!/^\d+(\.\d+){0,3}$/.test(version)) return false;
  const have = version.split(".").map(Number), supported = LEGACY_SOFTWARE_VERSION.split(".").map(Number);
  for (let i = 0; i < 4; i++) {
    const a = have[i] ?? 0, b = supported[i] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

export function parseLegacyTournament(xml: string, ctx: CommandContext): LegacyTournamentImport {
  const root = parseXml(xml, "Tournament");
  if (newerThanSupported(root.get("SoftwareVersion"))) throw new CommandError("legacy_version_too_new", "This file was saved by a newer version of the program.");
  const structure = root.get("Structure") || root.get("StructureCode");
  const roster = root.child("TournamentPlayers");
  const namedSizes: Record<string, number> = { individual: 1, twoplayers: 2, threeplayers: 3, fourplayers: 4, fiveplayers: 5 };
  const rawSize = root.get("PlayerStructure").toLowerCase();
  const inferredSize = roster.has("TournamentTeam") ? Math.max(2, roster.child("TournamentTeam").child("Team").child("PlayerList").all("Player").length) : 1;
  const size = rawSize ? namedSizes[rawSize] ?? Number(rawSize) : inferredSize;
  if (![1, 2, 3, 4, 5].includes(size)) throw new CommandError("unsupported_legacy_event", "The legacy player structure must have one through five members.");
  const styleCode = root.int("TournamentStyleCode");
  const oldFormat = root.get("Format").toLowerCase();
  const style = styleCode === 4 || /^(open|opendueling)$/.test(oldFormat) ? "open_dueling"
    : styleCode === 3 || oldFormat === "limited" ? "sealed" : styleCode === 2 ? "traditional" : "advanced";
  const warnings: string[] = [];
  const location = root.child("Location");
  const locationDetails = location.has("Name") ? { id: location.get("Id") || "imported-location", name: location.get("Name"),
    address1: location.get("Address1"), address2: location.get("Address2"), city: location.get("City"), state: location.get("State"),
    postal: location.get("Zip"), country: location.get("Country"), phone: location.get("Phone"), website: location.get("WebSite") } : null;
  const tableOffset = root.int("TableOffset");
  const state = createEvent({ name: root.get("Name").slice(0, MAX_EVENT_NAME) || "Imported event", format: /^(singleelimination|0?2)$/i.test(structure) ? "single_elim" : /^(opendueling|0?3)$/i.test(structure) ? "open_dueling" : "swiss",
    style, playerStructure: size as PlayerStructure, locationDetails,
    startsAt: timestamp(root, warnings), location: location.get("Name") || null,
    startingTable: Math.max(1, tableOffset + 1) }, ctx);
  const eventId = /^[A-Za-z]\d{2}-\d{6}$/.test(root.get("ID")) ? root.get("ID").toUpperCase() : null;
  if (eventId) state.legacyEventId = eventId;
  const imported: LegacyTournamentImport["players"] = [];
  const byLegacyId = new Map<string, Player>();
  const staffNames = new Map<string, string>();
  const staffNodes: { node: Element; position: StaffPosition }[] = root.child("Staff").child("XmlStaffArray").all("XmlStaff").map(s => {
    const code = s.int("XmlStaffPositionCode");
    const named = s.get("XmlStaffPosition").toLowerCase();
    const oldPositions: Record<string, StaffPosition> = { organizer: "organizer", headjudge: "head_judge", assistantheadjudge: "assistant_head_judge", judgeteamlead: "floor_judge_team_lead", judge: "floor_judge", scorekeeper: "scorekeeper", eventmanager: "event_manager", eventstaff: "event_staff" };
    return { node: s.child("Player"), position: STAFF_POSITIONS[code - 1] ?? oldPositions[named] ?? "event_staff" };
  });
  for (const [field, position] of [["HeadJudge", "head_judge"], ["Organizer", "organizer"], ["ScoreKeeper", "scorekeeper"]] as const)
    staffNodes.push(...root.child(field).all("Player").map(node => ({ node, position })));
  staffNodes.push(...root.child("Judges").child("PlayerList").all("Player").map(node => ({ node, position: "floor_judge" as const })));
  state.legacyStaff = [];
  for (const { node, position } of staffNodes) {
    const p = readPlayer(node);
    const name = [p.firstName, p.lastName].filter(Boolean).join(" ") || "Unknown staff member";
    staffNames.set(key(node.get("ID")), name);
    state.legacyStaff.push({ memberId: p.memberId, name, position });
    warnings.push(`Legacy staff member ${name} was not imported; select a staff account to add them.`);
  }
  function addPlayer(node: Element, sourceId: string, missing: boolean): Player {
    const existing = byLegacyId.get(key(sourceId));
    if (existing) { warnings.push(`Duplicate legacy player ${sourceId} was merged.`); return existing; }
    const names = readPlayer(node);
    const id = `legacy-player-${state.players.length + 1}`;
    const p: Player = { id, userId: null, name: [names.firstName, names.lastName].filter(Boolean).join(" ") || "(n/a)", memberId: normalizeMemberId(sourceId),
      status: missing ? "dropped" : "active", droppedAfterRound: missing ? 0 : null, enteredRound: 1, fixedTable: null,
      checkedIn: false, notes: null };
    state.players.push(p); byLegacyId.set(key(sourceId), p);
    imported.push({ playerId: id, memberId: p.memberId, firstName: names.firstName, lastName: names.lastName });
    if (missing) warnings.push(`Legacy player ${sourceId} was missing from the roster; imported as a dropped placeholder.`);
    return p;
  }
  function scoringFields(p: Player, node: Element): void {
    const reason = node.get("DropReason").toLowerCase();
    const dropRound = node.int("DropRound");
    if ((dropRound > 0 || reason === "drop") && reason !== "active" && reason !== "0") {
      p.status = /^(cut|playoffcut|topx|2|3|4)$/.test(reason) ? "cut" : "dropped";
      p.droppedAfterRound = dropRound;
    }
    p.fixedTable = node.int("AssignedSeat") > 0 ? node.int("AssignedSeat") : null;
    p.openDuelingPoints = node.int("OpenDueling");
    p.notes = node.get("Notes") || null;
  }
  for (const node of roster.all("TournPlayer")) {
    const nested = node.child("Player");
    const rawId = nested.get("ID");
    if (isBye(rawId)) { warnings.push("A legacy roster entry with no player ID was ignored."); continue; }
    scoringFields(addPlayer(nested, rawId, false), node);
  }
  function addTeam(node: Element, sourceId: string, missing: boolean): Team {
    const id = key(sourceId);
    if (byLegacyId.has(id)) throw new CommandError("invalid_legacy_xml", "Team IDs must be unique and separate from member IDs.");
    if (!isTeamId(id))
      throw new CommandError("invalid_legacy_xml", "A team ID is outside the reserved team range.");
    const nested = node.child("Team");
    const members = nested.child("PlayerList").all("Player").sort((a, b) => a.int("TeamPosition") - b.int("TeamPosition"));
    const memberIds = members.map(m => addPlayer(m, m.get("ID"), false).id);
    if (!missing) validateTeamMembers(state, memberIds, id);
    const team: Team = { id, userId: null, memberId: id, name: [nested.get("FirstName"), nested.get("LastName")].filter(Boolean).join(" ") || "Unknown team", memberIds,
      status: missing ? "dropped" : "active", droppedAfterRound: missing ? 0 : null, enteredRound: 1, fixedTable: null, checkedIn: false, notes: null };
    scoringFields(team, node);
    state.teams.push(team); byLegacyId.set(id, team);
    if (missing) warnings.push(`Legacy team ${sourceId} was missing from the roster; imported as a dropped placeholder.`);
    return team;
  }
  for (const node of roster.all("TournamentTeam")) {
    const rawId = node.child("Team").get("ID");
    if (isBye(rawId)) { warnings.push("A legacy team entry with no ID was ignored."); continue; }
    addTeam(node, rawId, false);
  }
  function resolve(rawId: string, round: number, member = false): Player {
    const p = byLegacyId.get(key(rawId)) ?? (teamSize(state) > 1 && !member ? addTeam(new Element(undefined), rawId, true) : addPlayer(new Element(undefined), rawId, true));
    if ((p.name === "(n/a)" || p.name === "Unknown team") && p.status === "dropped") p.droppedAfterRound = Math.max(p.droppedAfterRound ?? 0, round);
    return p;
  }
  const rounds = new Map<number, Round>();
  const playoffStart = root.int("PlayoffRound");
  for (const node of root.child("Matches").all("TournMatch")) {
    const number = node.int("Round");
    if (number <= 0) continue;
    const rawPlayers = node.all("Player").map(p => p.text()).filter(id => !isBye(id));
    if (!rawPlayers.length) { warnings.push(`An empty legacy match in round ${number} was ignored.`); continue; }
    const p1 = resolve(rawPlayers[0], number), p2 = rawPlayers[1] ? resolve(rawPlayers[1], number) : null;
    const playoff = state.settings.format === "single_elim" || node.bool("PlayoffMatch") || (playoffStart > 0 && number >= playoffStart);
    const round = rounds.get(number) ?? { number, stage: playoff ? "playoff" : "swiss", seed: ctx.seed, startedAt: null, endsAt: null, matches: [], warnings: [] };
    if (playoff) round.stage = "playoff";
    const winner = byLegacyId.get(key(node.get("Winner")))?.id ?? "";
    const relativeTable = node.int("Table");
    const table = relativeTable !== 0 || (node.has("Table") && (p2 !== null || p1.fixedTable === tableOffset))
      ? relativeTable + tableOffset : 0;
    round.matches.push({ id: `legacy-match-${number}-${round.matches.length + 1}`, round: number, table: p2 === null || table <= 0 ? null : table,
      ...(p2 === null && table > 0 ? { byeTable: table } : {}),
      p1: p1.id, p2: p2?.id ?? null, result: matchResult(node, p1.id, p2?.id ?? null, winner), reports: [], extensionMinutes: 0 });
    rounds.set(number, round);
  }
  // CurrentRound preserves empty rounds (for example a round being manually seated).
  const currentRound = root.int("CurrentRound");
  if (currentRound > 10000) throw new CommandError("invalid_legacy_xml", "The legacy current round is outside the supported range.");
  for (let number = 1; number <= currentRound; number++) if (!rounds.has(number)) {
    rounds.set(number, { number, stage: state.settings.format === "single_elim" || (playoffStart > 0 && number >= playoffStart) ? "playoff" : "swiss", seed: ctx.seed, startedAt: null, endsAt: null, matches: [], warnings: [] });
  }
  state.rounds = [...rounds.values()].sort((a, b) => a.number - b.number);
  const firstPlayoff = state.rounds.find(r => r.stage === "playoff");
  if (firstPlayoff) {
    // The file supplies match order but does not carry a separate seed list.
    state.cut = [...new Set(firstPlayoff.matches.flatMap(m => m.p2 === null ? [m.p1] : [m.p1, m.p2]))];
    state.settings.topCut = [2, 4, 8, 16, 32, 64].includes(state.cut.length) ? state.cut.length : 0;
  }
  for (const node of root.child("PenaltyList").all("PlayerPenalty")) {
    const rawId = node.get("Player");
    const p = resolve(rawId, node.int("Round"), true);
    const penalty = readPenalty(node);
    let label = node.get("Infraction") || "Unknown legacy infraction";
    let notes = node.get("Notes") || null;
    // The engine label is written at the start of the notes when it differs from the legacy name; take it back out.
    const tagged = notes ? /^\[Infraction: (.+?)\](?: ([\s\S]*))?$/.exec(notes) : null;
    if (tagged) { label = tagged[1]!; notes = tagged[2] || null; }
    const builtIn = tagged ? null : builtInInfractionId(label);
    let infraction = state.settings.infractions.find(i => i.label === label) ?? (builtIn ? state.settings.infractions.find(i => i.id === builtIn) : undefined);
    if (!infraction) {
      infraction = { id: `legacy-infraction-${state.settings.infractions.length + 1}`, label, defaultPenalty: penalty };
      state.settings.infractions.push(infraction);
    }
    state.penalties.push({ id: `legacy-penalty-${state.penalties.length + 1}`, playerId: p.id, round: node.int("Round") || null, infractionId: infraction.id, penalty,
      judge: staffNames.get(key(node.get("Judge"))) ?? (isBye(node.get("Judge")) ? null : node.get("Judge")), notes, at: ctx.now });
  }
  state.phase = root.bool("Finalized") ? "complete" : firstPlayoff ? "playoff" : state.rounds.length ? "swiss" : "registration";
  state.completedAt = state.phase === "complete" ? ctx.now : null;
  syncTeamMembers(state);
  state.playerStructureLocked = state.players.length > 0 || state.teams.length > 0;
  const issues = integrity(state);
  for (const warning of issues.memberIdWarnings) warnings.push(`Legacy member ID ${warning.memberId}: ${warning.problem} (${warning.playerId}).`);
  if (issues.unpairedActive.length) warnings.push(`${issues.unpairedActive.length} active players are unpaired in the current round.`);
  return { state, players: imported, warnings };
}

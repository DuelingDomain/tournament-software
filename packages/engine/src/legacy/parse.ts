import { CommandError, type CommandContext, type EventState, type MatchResult, type Penalty, type Player, type Round } from "../types.js";
import { createEvent } from "../reducer.js";
import { normalizeMemberId } from "../member-id.js";
import { integrity } from "../integrity.js";
import { Element, parseXml } from "./xml.js";

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

export function parseLegacyTournament(xml: string, ctx: CommandContext): LegacyTournamentImport {
  const root = parseXml(xml, "Tournament");
  const structure = root.get("Structure") || root.get("StructureCode");
  if (/^(open|opendueling)$/i.test(root.get("Format")) || root.int("TournamentStyleCode") === 4 || /^(opendueling|0?3)$/i.test(structure)) {
    throw new CommandError("unsupported_legacy_event", "Legacy Open Dueling events cannot be imported.");
  }
  const roster = root.child("TournamentPlayers");
  const playerStructure = root.get("PlayerStructure");
  if ((playerStructure && !/^(individual|0?1)$/i.test(playerStructure)) || roster.has("TournamentTeam")) {
    throw new CommandError("unsupported_legacy_event", "Legacy team events cannot be imported; choose an individual event.");
  }
  const warnings: string[] = [];
  const state = createEvent({ name: root.get("Name") || "Imported event", format: /^(singleelimination|0?2)$/i.test(structure) ? "single_elim" : "swiss",
    startsAt: timestamp(root, warnings), location: root.child("Location").get("Name") || null,
    startingTable: Math.max(1, root.int("TableOffset", 1)) }, ctx);
  const imported: LegacyTournamentImport["players"] = [];
  const byLegacyId = new Map<string, Player>();
  const staffNames = new Map<string, string>();
  const staffNodes = root.child("Staff").child("XmlStaffArray").all("XmlStaff").map(s => s.child("Player"));
  for (const field of ["HeadJudge", "Organizer", "ScoreKeeper"]) staffNodes.push(...root.child(field).all("Player"));
  staffNodes.push(...root.child("Judges").child("PlayerList").all("Player"));
  for (const node of staffNodes) {
    const p = readPlayer(node);
    const name = [p.firstName, p.lastName].filter(Boolean).join(" ") || "Unknown staff member";
    staffNames.set(key(node.get("ID")), name);
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
  for (const node of roster.all("TournPlayer")) {
    const nested = node.child("Player");
    const rawId = nested.get("ID");
    if (isBye(rawId)) { warnings.push("A legacy roster entry with no player ID was ignored."); continue; }
    // Score/drop fields are outside the nested Player element.
    const p = addPlayer(nested, rawId, false);
    const reason = node.get("DropReason").toLowerCase();
    const dropRound = node.int("DropRound");
    if (dropRound > 0 && reason !== "active" && reason !== "0") {
      p.status = /^(cut|playoffcut|topx|2|3|4)$/.test(reason) ? "cut" : "dropped";
      p.droppedAfterRound = dropRound;
    }
    p.fixedTable = node.int("AssignedSeat") > 0 ? node.int("AssignedSeat") : null;
    p.notes = node.get("Notes") || null;
  }
  function resolve(rawId: string, round: number): Player {
    const p = byLegacyId.get(key(rawId)) ?? addPlayer(new Element(undefined), rawId, true);
    if (p.name === "(n/a)" && p.status === "dropped") p.droppedAfterRound = Math.max(p.droppedAfterRound ?? 0, round);
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
    round.matches.push({ id: `legacy-match-${number}-${round.matches.length + 1}`, round: number, table: p2 === null ? null : node.int("Table") || null,
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
    // Bracket table order is preserved; seed order cannot be recovered from the file.
    state.cut = [...new Set(firstPlayoff.matches.flatMap(m => m.p2 === null ? [m.p1] : [m.p1, m.p2]))];
    state.settings.topCut = [2, 4, 8, 16, 32, 64].includes(state.cut.length) ? state.cut.length : 0;
  }
  for (const node of root.child("PenaltyList").all("PlayerPenalty")) {
    const rawId = node.get("Player");
    const p = resolve(rawId, node.int("Round"));
    const penalty = readPenalty(node);
    const label = node.get("Infraction") || "Unknown legacy infraction";
    let infraction = state.settings.infractions.find(i => i.label === label);
    if (!infraction) {
      infraction = { id: `legacy-infraction-${state.settings.infractions.length + 1}`, label, defaultPenalty: penalty };
      state.settings.infractions.push(infraction);
    }
    state.penalties.push({ id: `legacy-penalty-${state.penalties.length + 1}`, playerId: p.id, round: node.int("Round") || null, infractionId: infraction.id, penalty,
      judge: staffNames.get(key(node.get("Judge"))) ?? (isBye(node.get("Judge")) ? null : node.get("Judge")), notes: node.get("Notes") || null, at: ctx.now });
  }
  state.phase = root.bool("Finalized") ? "complete" : firstPlayoff ? "playoff" : state.rounds.length ? "swiss" : "registration";
  state.completedAt = state.phase === "complete" ? ctx.now : null;
  const issues = integrity(state);
  for (const warning of issues.memberIdWarnings) warnings.push(`Legacy member ID ${warning.memberId}: ${warning.problem} (${warning.playerId}).`);
  if (issues.unpairedActive.length) warnings.push(`${issues.unpairedActive.length} active players are unpaired in the current round.`);
  return { state, players: imported, warnings };
}

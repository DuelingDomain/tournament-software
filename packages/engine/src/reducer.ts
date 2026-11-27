import { CommandError, type Command, type CommandContext, type EventSettings, type EventState, type Match, type MatchResult, type Player, type Round } from "./types.js";
import { DEFAULT_INFRACTIONS } from "./defaults.js";
import { createRng, randomId, shuffle } from "./rng.js";
import { assignTables, makeMatch, pairSwiss } from "./pairing.js";
import { advanceBracket, initialBracket, updateEliminations } from "./bracket.js";
import { cutoffTies, standings, winner } from "./standings.js";
import { isTeamId, isTemporaryMemberId, normalizeMemberId } from "./member-id.js";
import { competitors, competitorId, nextTeamId, syncTeamMembers, teamForPlayer, teamSize, validateTeamMembers } from "./competitors.js";
import { recordActivity } from "./activity.js";
import { staffAssignment } from "./staff.js";
import { integrity } from "./integrity.js";
import { isIanaTimeZone } from "./time-zone.js";

function requireCondition(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new CommandError(code, message);
}

function validateContext(ctx: CommandContext): void {
  requireCondition(Number.isSafeInteger(ctx.seed) && ctx.seed >= 0, "INVALID_SEED", "The command needs a nonnegative safe-integer seed.");
  requireCondition(Number.isFinite(Date.parse(ctx.now)), "INVALID_TIME", "The command needs a valid timestamp.");
}

function validateSettings(settings: EventSettings): void {
  requireCondition(["swiss", "single_elim", "open_dueling"].includes(settings.format), "INVALID_FORMAT", "Choose a pairing structure.");
  requireCondition(["advanced", "traditional", "sealed", "open_dueling"].includes(settings.style), "INVALID_STYLE", "Choose a tournament style.");
  requireCondition([1, 2, 3, 4, 5].includes(settings.playerStructure), "INVALID_PLAYER_STRUCTURE", "Choose a player structure from one through five.");
  requireCondition(settings.startsAt === null || Number.isFinite(Date.parse(settings.startsAt)), "INVALID_TIME", "Choose a valid event date and time.");
  requireCondition(settings.timeZone === undefined || isIanaTimeZone(settings.timeZone), "INVALID_TIME_ZONE", "Choose a valid IANA time zone.");
  requireCondition(settings.name.trim(), "INVALID_NAME", "Give the event a name.");
  requireCondition(Number.isInteger(settings.startingTable) && settings.startingTable >= 1, "INVALID_TABLE", "Starting table must be a positive integer.");
  requireCondition(Number.isFinite(settings.roundMinutes) && settings.roundMinutes > 0, "INVALID_MINUTES", "Round length must be positive.");
  requireCondition(settings.plannedRounds === null || (Number.isInteger(settings.plannedRounds) && settings.plannedRounds > 0), "INVALID_ROUNDS", "Planned rounds must be a positive integer or left open.");
  requireCondition([0, 2, 4, 8, 16, 32, 64].includes(settings.topCut), "INVALID_CUT", "The configured top cut must be 0, 2, 4, 8, 16, 32 or 64.");
  requireCondition(new Set(settings.infractions.map(i => i.id)).size === settings.infractions.length, "INVALID_INFRACTIONS", "Infraction identifiers must be unique.");
}

export function createEvent(settings: Partial<EventSettings> & { name: string }, ctx: CommandContext): EventState {
  validateContext(ctx);
  const configured: EventSettings = structuredClone({
    format: "swiss", style: "advanced", playerStructure: 1, locationId: null, locationDetails: null, plannedRounds: null, topCut: 0, tiebreak: "legacy",
    startingTable: 1, roundMinutes: 50, location: null, startsAt: null,
    infractions: DEFAULT_INFRACTIONS, publicNames: "full", registrationOpen: true,
    requireMemberId: false, allowLateEntry: true, ...settings,
  });
  validateSettings(configured);
  const state: EventState = { schemaVersion: 1, settings: configured, phase: "registration", players: [], teams: [], rounds: [], cut: [], swissCuts: [], penalties: [], staff: [], createdAt: ctx.now, completedAt: null };
  recordActivity(state, "CreateEvent", ctx);
  return state;
}

function player(state: EventState, id: string): Player {
  const found = [...competitors(state), ...state.players].find(p => p.id === id);
  requireCondition(found, "PLAYER_NOT_FOUND", "That player is not registered for this event.");
  return found;
}

function registeredPlayer(state: EventState, id: string): Player {
  const found = state.players.find(p => p.id === id);
  requireCondition(found, "PLAYER_NOT_FOUND", "That person is not registered for this event.");
  return found;
}

function currentRound(state: EventState): Round {
  const round = state.rounds.at(-1);
  requireCondition(round, "NO_ROUND", "Pair a round first.");
  return round;
}

function findMatch(state: EventState, id: string): { round: Round; match: Match } {
  for (const round of state.rounds) {
    const match = round.matches.find(m => m.id === id);
    if (match) return { round, match };
  }
  throw new CommandError("MATCH_NOT_FOUND", "That match does not exist in this event.");
}

function validateResult(round: Round, match: Match, result: MatchResult | null): void {
  if (result === null) return;
  if (match.p2 === null) {
    requireCondition(result === "bye_win" || (round.stage === "swiss" && result === "bye_loss"), "INVALID_BYE_RESULT", "A bye needs a bye win or, in Swiss, a bye loss.");
  } else {
    requireCondition(!result.startsWith("bye_"), "INVALID_RESULT", "A two-player match cannot have a bye result.");
    requireCondition(round.stage !== "playoff" || result === "p1" || result === "p2", "PLAYOFF_REQUIRES_WINNER", "Playoff matches must have a winner; draws and double losses are not allowed.");
  }
}

function drop(state: EventState, id: string): void {
  const p = player(state, competitorId(state, id));
  p.status = "dropped";
  p.droppedAfterRound = state.rounds.at(-1)?.number ?? 0;
}

function allResults(state: EventState): void {
  requirePaired(state);
  requireCondition(state.rounds.every(r => r.matches.every(m => m.result !== null)), "MISSING_RESULTS", "Enter every outstanding result before continuing.");
}

function pairNextRound(state: EventState, ctx: CommandContext, random: () => number, ids: Set<string>): void {
  allResults(state);
  requireCondition(state.staff.length > 0, "NO_STAFF", "Add a staff member before you pair a round.");
  const active = competitors(state).filter(p => p.status === "active");
  requireCondition(active.length, "NO_PLAYERS", "Add or reactivate players before pairing a round.");
  for (const t of state.teams ?? []) if (t.status === "active") validateTeamMembers(state, t.memberIds, t.id);
  requireCondition(active.length >= 2, "NOT_ENOUGH_PLAYERS", "At least two active players are required to pair a round.");
  for (const cut of state.swissCuts) cut.roundPairedAfter = true;
  if (state.phase === "playoff") state.rounds.push(advanceBracket(state, ctx.seed, random, ids));
  else if (state.settings.format === "single_elim") {
    state.cut = shuffle(active.map(p => p.id), random);
    state.phase = "playoff";
    state.rounds.push(initialBracket(state, state.cut, ctx.seed, random, ids));
  } else {
    state.rounds.push(pairSwiss(state, (state.rounds.at(-1)?.number ?? 0) + 1, ctx.seed, random, ids));
    state.phase = "swiss";
  }
  state.rounds[state.rounds.length - 1]!.pairedAt = ctx.now;
}

function requirePaired(state: EventState): void {
  requireCondition(integrity(state).unpairedActive.length === 0, "unpaired_players", "Pair every active player in the current round before entering results or continuing.");
}

function requireAccount(userId: number): void {
  requireCondition(Number.isSafeInteger(userId) && userId > 0, "INVALID_ACCOUNT", "Choose a valid player account.");
}

function requireUnusedAccount(state: EventState, userId: number): void {
  requireAccount(userId);
  requireCondition(!state.players.some(p => p.userId === userId), "duplicate_account", "This account is already entered in the event.");
}

function requireUnpaired(state: EventState, round: Round, id: string): void {
  requireCondition(competitors(state).some(p => p.id === id && p.status === "active"), "INACTIVE_PLAYER", "Only active players can be assigned to a pairing.");
  requireCondition(!round.matches.some(m => m.p1 === id || m.p2 === id), "PLAYER_ALREADY_PAIRED", "This player already has a current-round match.");
}

function manualTable(state: EventState, round: Round, match: Match, table?: number | null): number {
  const a = round.stage === "swiss" ? player(state, match.p1).fixedTable : null;
  const b = round.stage === "swiss" && match.p2 !== null ? player(state, match.p2).fixedTable : null;
  requireCondition(a === null || b === null || a === b, "FIXED_TABLE_CONFLICT", "These players require different fixed tables.");
  const fixed = a ?? b;
  requireCondition(table == null || (Number.isInteger(table) && table > 0), "INVALID_TABLE", "A table must be a positive integer.");
  requireCondition(fixed === null || table == null || table === fixed, "FIXED_TABLE_CONFLICT", "The pairing must use the player's fixed table.");
  let assigned = table ?? fixed ?? state.settings.startingTable;
  const width = teamSize(state);
  const used = new Set(round.matches.flatMap(m => {
    const table = m.table ?? m.byeTable;
    return m.id === match.id || table === undefined ? [] : Array.from({ length: width }, (_, i) => table + i);
  }));
  const overlaps = () => Array.from({ length: width }, (_, i) => assigned + i).some(t => used.has(t));
  if (table == null && fixed === null) while (overlaps()) assigned++;
  requireCondition(!overlaps(), "TABLE_IN_USE", "That table already has a match.");
  return assigned;
}

/** Keep existing tables when creating a manual match. */
function addManualMatch(state: EventState, round: Round, match: Match, table?: number | null): void {
  validateResult(round, match, match.result);
  if (match.p2 !== null) match.table = manualTable(state, round, match, table);
  else {
    requireCondition(table == null, "INVALID_TABLE", "A bye does not take a live table assignment.");
    const width = teamSize(state);
    let last = state.settings.startingTable - width;
    for (const m of round.matches) last = Math.max(last, m.table ?? m.byeTable ?? last);
    match.byeTable = last + width;
  }
  round.matches.push(match);
}

function convertBye(state: EventState, round: Round, match: Match, opponent: string, honorFixed = false): void {
  const table = match.byeTable ?? match.table;
  const paired: Match = { ...match, p2: opponent, result: null, reports: [] };
  if (honorFixed) {
    const fixed = player(state, match.p1).fixedTable ?? player(state, opponent).fixedTable;
    paired.table = manualTable(state, round, paired, fixed === null || fixed === table ? table : null);
  } else paired.table = table ?? manualTable(state, round, paired);
  delete paired.byeTable;
  round.matches[round.matches.indexOf(match)] = paired;
}

function repairUndrop(state: EventState, round: Round, returning: Player, random: () => number, ids: Set<string>): void {
  const points = new Map(standings({ ...state, rounds: state.rounds.filter(r => r.number < round.number) })
    .map(row => [row.playerId, row.matchPoints]));
  const score = (id: string | null) => id === null ? 0 : points.get(id) ?? 0;
  const group = (m: Match) => Math.max(score(m.p1), score(m.p2));
  const total = (m: Match) => score(m.p1) + score(m.p2);
  const eligible = round.matches.filter(m => group(m) <= score(returning.id) && (m.result !== null || m.reports.length === 0));
  eligible.sort((a, b) => (a.table ?? a.byeTable ?? Infinity) - (b.table ?? b.byeTable ?? Infinity));
  const selected = eligible.filter(m => m.p2 === null || score(m.p1) !== score(m.p2));
  const represented = new Set(selected.map(group));
  const fallback = new Map<number, Match[]>();
  for (const match of eligible) {
    const points = group(match);
    if (represented.has(points)) continue;
    const choices = fallback.get(points) ?? [];
    choices.push(match);
    fallback.set(points, choices);
  }
  const chooseTable = createRng(round.seed);
  for (const [, choices] of [...fallback].sort(([a], [b]) => a - b)) {
    selected.push(choices[Math.floor(chooseTable() * (choices.length - 1))]);
  }
  selected.sort((a, b) => total(b) - total(a));

  const roster = new Map(competitors(state).map((p, index) => [p.id, { index, memberId: p.memberId }]));
  let carried: string | null = returning.id;
  for (const match of selected) {
    if (match.p2 === null) {
      if (carried !== null) convertBye(state, round, match, carried);
      else {
        match.result = null;
        match.reports = [];
      }
      carried = null;
      continue;
    }
    const a = roster.get(match.p1)!;
    const b = roster.get(match.p2)!;
    const firstById = a.memberId !== null && b.memberId !== null
      ? Number(a.memberId) <= Number(b.memberId) : a.index < b.index;
    const replaceFirst = score(match.p1) < score(match.p2) || (score(match.p1) === score(match.p2) && firstById);
    const displaced = replaceFirst ? match.p1 : match.p2;
    if (carried === null) {
      match.p1 = replaceFirst ? match.p2 : match.p1;
      match.p2 = null;
      if (match.table !== null) match.byeTable = match.table;
      match.table = null;
    } else if (replaceFirst) match.p1 = carried;
    else match.p2 = carried;
    match.result = null;
    match.reports = [];
    carried = displaced;
  }
  if (carried !== null) addManualMatch(state, round, makeMatch(carried, null, round.number, random, ids));
}

function swapCurrentOpponents(round: Round, a: string, b: string): Match[] {
  const first = round.matches.find(m => m.p1 === a || m.p2 === a);
  const second = round.matches.find(m => m.p1 === b || m.p2 === b);
  requireCondition(first && second, "PLAYER_NOT_PAIRED", "Both players need current-round matches to exchange opponents.");
  if (first === second) return [];

  for (const [match, outgoing, incoming] of [[first, a, b], [second, b, a]] as const) {
    const winningPlayer = winner(match);
    if (match.p1 === outgoing) match.p1 = incoming;
    else match.p2 = incoming;
    if (winningPlayer === outgoing) match.result = null;
    match.reports = [];
  }
  return [first, second];
}

function playersAtCut(state: EventState, size: number, tieOrder: string[] | undefined, allowExtras: boolean): string[] {
  const rows = standings(state).filter(row => row.status === "active");
  const ties = cutoffTies(rows, size);
  if (ties === null) {
    requireCondition(tieOrder === undefined, "INVALID_TIE_ORDER", "There is no tie across the cut line.");
    return rows.slice(0, size).map(row => row.playerId);
  }
  const { start, end } = ties;
  if (allowExtras && tieOrder === undefined) return rows.slice(0, end).map(row => row.playerId);
  requireCondition(tieOrder !== undefined, "CUT_TIE_SELECTION_REQUIRED", "Select which tied competitors advance.");

  const tied = rows.slice(start, end).map(row => row.playerId);
  const required = size - start;
  const tiedIds = new Set(tied);
  const selected = new Set(tieOrder);
  requireCondition(selected.size === tieOrder.length && tieOrder.every(id => tiedIds.has(id))
    && (allowExtras ? selected.size >= required : selected.size === required || selected.size === tied.length),
    "INVALID_TIE_ORDER", allowExtras ? "Select at least enough tied competitors to fill the cut." : "Select exactly enough tied competitors to fill the cut.");
  // A full playoff tie order is also accepted from callers that select by prefix.
  const admitted = allowExtras ? selected : new Set(tieOrder.slice(0, required));
  return [...rows.slice(0, start).map(row => row.playerId), ...tied.filter(id => admitted.has(id))];
}

function editable(match: Match): void {
  requireCondition(match.result === null, "RESULT_ALREADY_ENTERED", "Clear the result before editing this pairing.");
}

function validatePairings(state: EventState, round: Round, before: Round): void {
  const ids = round.matches.flatMap(m => m.p2 === null ? [m.p1] : [m.p1, m.p2]);
  requireCondition(ids.length === new Set(ids).size, "DUPLICATE_PLAYER", "Each player must appear exactly once in this round.");
  for (const id of ids) requireCondition(competitors(state).some(p => p.id === id), "PLAYER_NOT_FOUND", "Choose an enrolled competitor.");
  // The round roster excludes next-round undrops. Late entrants already have
  // their one-player backfill matches, so they remain part of this roster.
  const required = before.matches.flatMap(m => m.p2 === null ? [m.p1] : [m.p1, m.p2]).filter(id => player(state, id).status === "active");
  requireCondition(required.every(id => ids.includes(id)), "MISSING_PLAYER", "Every active player in this round must appear exactly once.");
  assignTables(round.matches, competitors(state), state.settings.startingTable, round.stage === "swiss", teamSize(state));
}

function shiftTime(time: string, minutes: number): string {
  requireCondition(Number.isFinite(minutes), "INVALID_MINUTES", "Timer adjustments must be a finite number of minutes.");
  const shifted = Date.parse(time) + minutes * 60_000;
  requireCondition(Number.isFinite(shifted) && Math.abs(shifted) <= 8.64e15, "INVALID_TIME", "The timer adjustment is outside the supported date range.");
  return new Date(shifted).toISOString();
}

export function applyCommand(input: EventState, command: Command, ctx: CommandContext): EventState {
  validateContext(ctx);
  const memberIdOnly = command.type === "UpdatePlayer" && command.memberId !== undefined &&
    command.name === undefined && command.fixedTable === undefined && command.notes === undefined;
  requireCondition(input.phase !== "complete" || command.type === "ReopenEvent" || memberIdOnly, "EVENT_COMPLETE", "Reopen the event before making changes.");
  const state = structuredClone(input);
  state.teams ??= [];
  if ("teamId" in command) requireCondition(state.teams.some(t => t.id === command.teamId), "TEAM_NOT_FOUND", "That team is not enrolled.");
  const random = createRng(ctx.seed);
  const ids = new Set([...state.players.map(p => p.id), ...state.teams.map(t => t.id), ...state.rounds.flatMap(r => r.matches.map(m => m.id)), ...state.staff.map(s => s.id), ...state.penalties.map(p => p.id)]);
  switch (command.type) {
    case "UpdateSettings": {
      requireCondition(command.settings.playerStructure === undefined || command.settings.playerStructure === state.settings.playerStructure || (!state.playerStructureLocked && state.players.length === 0 && state.teams.length === 0),
        "PLAYER_STRUCTURE_LOCKED", "Player structure cannot change after anyone is enrolled.");
      state.settings = { ...state.settings, ...structuredClone(command.settings) };
      validateSettings(state.settings);
      if (command.staff) {
        const previousStaff = new Map(state.staff.map(s => [s.userId, s]));
        state.staff = [];
        for (const entry of command.staff) {
          requireAccount(entry.userId);
          requireCondition(entry.name.trim(), "INVALID_NAME", "The staff member needs a name.");
          requireCondition(!state.staff.some(s => s.userId === entry.userId), "duplicate_account", "This account is already on the event staff.");
          state.staff.push({ id: previousStaff.get(entry.userId)?.id ?? randomId(random, ids), userId: entry.userId, name: entry.name.trim(), ...staffAssignment(entry) });
        }
      }
      break;
    }
    case "AddTeams": {
      requireCondition(state.phase === "registration" || state.phase === "swiss", "REGISTRATION_CLOSED", "Teams cannot enter after the playoff cut.");
      requireCondition(state.rounds.length === 0 || state.settings.allowLateEntry, "LATE_ENTRY_CLOSED", "Late entry is disabled for this event.");
      for (const entry of command.teams) {
        requireCondition(entry.name.trim(), "INVALID_NAME", "Every team needs a name.");
        const existing = entry.teamId ? state.teams.find(t => t.id === entry.teamId) : undefined;
        const id = entry.teamId ?? nextTeamId(state);
        requireCondition(id.length === 10 && isTeamId(id), "INVALID_TEAM_ID", "Use a team ID in the reserved team range.");
        validateTeamMembers(state, entry.memberIds, id);
        if (existing) {
          existing.name = entry.name.trim(); existing.memberIds = [...entry.memberIds];
          requireCondition(existing.status !== "cut", "PLAYER_CUT", "A cut team cannot be re-enrolled.");
          existing.status = "active"; existing.droppedAfterRound = null;
          for (const r of state.rounds) if (!r.matches.some(m => m.p1 === id || m.p2 === id)) addManualMatch(state, r, makeMatch(id, null, r.number, random, ids, "bye_loss"));
        } else {
          requireCondition(!ids.has(id) && !state.players.some(p => p.memberId !== null && normalizeMemberId(p.memberId) === id),
            "DUPLICATE_TEAM_ID", "That team ID is already used.");
          ids.add(id);
          state.teams.push({ id, userId: null, memberId: id, name: entry.name.trim(), memberIds: [...entry.memberIds], status: "active", droppedAfterRound: null,
            enteredRound: (state.rounds.at(-1)?.number ?? 0) + 1, fixedTable: null, checkedIn: false, notes: null });
          for (const r of state.rounds) addManualMatch(state, r, makeMatch(id, null, r.number, random, ids, "bye_loss"));
        }
        state.playerStructureLocked = true;
      }
      break;
    }
    case "UpdateTeam": {
      const team = state.teams.find(t => t.id === command.teamId);
      requireCondition(team, "TEAM_NOT_FOUND", "That team is not enrolled.");
      if (command.name !== undefined) { requireCondition(command.name.trim(), "INVALID_NAME", "The team needs a name."); team.name = command.name.trim(); }
      if (command.memberIds) { validateTeamMembers(state, command.memberIds, team.id); team.memberIds = [...command.memberIds]; }
      if (command.fixedTable !== undefined) {
        requireCondition(command.fixedTable === null || (Number.isInteger(command.fixedTable) && command.fixedTable > 0), "INVALID_TABLE", "A fixed table must be positive.");
        team.fixedTable = command.fixedTable;
      }
      break;
    }
    case "RemoveTeam":
      requireCondition(state.phase === "registration", "REGISTRATION_ONLY", "Teams can only be removed during registration.");
      requireCondition(state.teams.some(t => t.id === command.teamId), "TEAM_NOT_FOUND", "That team is not enrolled.");
      state.teams = state.teams.filter(t => t.id !== command.teamId);
      state.penalties = state.penalties.filter(p => p.playerId !== command.teamId);
      break;
    case "AddPlayers": {
      requireCondition(state.phase === "registration" || state.phase === "swiss", "REGISTRATION_CLOSED", "Players cannot enter after the playoff cut.");
      requireCondition(state.rounds.length === 0 || state.settings.allowLateEntry, "LATE_ENTRY_CLOSED", "Late entry is disabled for this event.");
      for (const entry of command.players) {
        requireCondition(entry.name.trim(), "INVALID_NAME", "Every player needs a name.");
        if (entry.userId !== null) requireUnusedAccount(state, entry.userId);
        const memberId = entry.memberId == null ? null : normalizeMemberId(entry.memberId);
        requireCondition(memberId === null || !isTeamId(memberId), "INVALID_MEMBER_ID", "Team IDs belong to teams.");
        requireCondition(!state.settings.requireMemberId || memberId !== null, "member_id_required", "A member ID is required to enter this event.");
        const p: Player = { id: randomId(random, ids), userId: entry.userId, name: entry.name.trim(), memberId, status: "active", droppedAfterRound: null,
          enteredRound: (state.rounds.at(-1)?.number ?? 0) + 1, fixedTable: null, checkedIn: false, notes: null };
        state.players.push(p);
        state.playerStructureLocked = true;
        for (const r of teamSize(state) > 1 ? [] : state.rounds) addManualMatch(state, r, makeMatch(p.id, null, r.number, random, ids, "bye_loss"));
      }
      break;
    }
    case "UpdatePlayer": {
      const p = registeredPlayer(state, command.playerId);
      if (command.name !== undefined) { requireCondition(command.name.trim(), "INVALID_NAME", "The player needs a name."); p.name = command.name.trim(); }
      if (command.memberId !== undefined) {
        const memberId = command.memberId === null ? null : normalizeMemberId(command.memberId);
        requireCondition(memberId === null || memberId === p.memberId || !isTeamId(memberId), "INVALID_MEMBER_ID", "Team IDs belong to teams.");
        requireCondition(!state.settings.requireMemberId || memberId !== null, "member_id_required", "A member ID is required for this event.");
        requireCondition(!(input.phase === "complete" && state.settings.requireMemberId && memberId !== null && isTemporaryMemberId(memberId)),
          "TEMPORARY_MEMBER_IDS", "A finalized tournament that requires member IDs cannot use a temporary ID.");
        p.memberId = memberId;
        const team = teamForPlayer(state, p.id);
        if (team) validateTeamMembers(state, team.memberIds, team.id);
      }
      if (command.notes !== undefined) p.notes = command.notes;
      if (command.fixedTable !== undefined) {
        requireCondition(command.fixedTable === null || (Number.isInteger(command.fixedTable) && command.fixedTable > 0), "INVALID_TABLE", "A fixed table must be a positive integer.");
        p.fixedTable = command.fixedTable;
      }
      break;
    }
    case "LinkPlayerAccount": {
      const p = registeredPlayer(state, command.playerId);
      requireCondition(p.userId === null, "ACCOUNT_ALREADY_LINKED", "This entry already has an account.");
      requireUnusedAccount(state, command.userId);
      p.userId = command.userId;
      break;
    }
    case "ReEnrollTeam":
    case "ReEnroll": {
      const p = player(state, competitorId(state, "teamId" in command ? command.teamId : command.playerId));
      requireCondition(p.status === "dropped", "PLAYER_NOT_DROPPED", "This player has not been dropped.");
      requireCondition(state.phase !== "playoff", "PLAYOFF_ORDER_LOCKED", "Dropped playoff players cannot re-enter the bracket.");
      for (const round of state.rounds) if (!round.matches.some(m => m.p1 === p.id || m.p2 === p.id)) {
        addManualMatch(state, round, makeMatch(p.id, null, round.number, random, ids, "bye_loss"));
      }
      p.status = "active"; p.droppedAfterRound = null;
      break;
    }
    case "RemovePlayer":
      requireCondition(state.phase === "registration", "REGISTRATION_ONLY", "Players can only be removed during registration. Drop them after play begins.");
      registeredPlayer(state, command.playerId);
      requireCondition(!state.teams.some(t => t.memberIds.includes(command.playerId)), "MEMBER_ON_TEAM", "Remove the player from their team first.");
      state.players = state.players.filter(p => p.id !== command.playerId);
      state.penalties = state.penalties.filter(p => p.playerId !== command.playerId);
      break;
    case "SetCheckedIn": registeredPlayer(state, command.playerId).checkedIn = command.checkedIn; break;
    case "AddStaff":
      requireCondition(command.name.trim(), "INVALID_NAME", "The staff member needs a name.");
      requireAccount(command.userId);
      requireCondition(!state.staff.some(s => s.userId === command.userId), "duplicate_account", "This account is already on the event staff.");
      state.staff.push({ id: randomId(random, ids), userId: command.userId, name: command.name.trim(), ...staffAssignment(command) });
      break;
    case "SetStaffPosition": {
      const staff = state.staff.find(s => s.id === command.staffId);
      requireCondition(staff, "STAFF_NOT_FOUND", "That staff member does not exist.");
      Object.assign(staff, staffAssignment({ position: command.position }));
      break;
    }
    case "SetStaffRole": {
      const staff = state.staff.find(s => s.id === command.staffId);
      requireCondition(staff, "STAFF_NOT_FOUND", "That staff member does not exist.");
      Object.assign(staff, staffAssignment({ role: command.role }));
      break;
    }
    case "RemoveStaff":
      requireCondition(state.staff.some(s => s.id === command.staffId), "STAFF_NOT_FOUND", "That staff member does not exist.");
      state.staff = state.staff.filter(s => s.id !== command.staffId);
      break;
    case "PairNextRound": pairNextRound(state, ctx, random, ids); break;
    case "RepairRound": {
      const round = currentRound(state);
      requireCondition(command.round === undefined || command.round === round.number, "CURRENT_ROUND_ONLY", "Only the current round can be re-paired; cancel later rounds first.");
      requireCondition(round.seed !== ctx.seed, "NEW_SEED_REQUIRED", "Use a new seed to repair this round.");
      state.rounds.pop();
      if (round.stage === "playoff") {
        updateEliminations(state, round.matches, true);
        if (!state.rounds.some(r => r.stage === "playoff")) {
          state.cut = state.cut.filter(id => player(state, id).status === "active");
          requireCondition(state.cut.length >= 2, "NOT_ENOUGH_PLAYERS", "At least two active players are required to pair a round.");
          if (state.settings.format === "single_elim") state.cut = shuffle(state.cut, random);
          state.rounds.push(initialBracket(state, state.cut, ctx.seed, random, ids));
        } else state.rounds.push(advanceBracket(state, ctx.seed, random, ids));
        break;
      }
      const late = round.matches.filter(m => player(state, m.p1).enteredRound > round.number);
      // Late entrants already have backfill for this round and wait until the next.
      const pairingState = { ...state, players: state.players.filter(p => p.enteredRound <= round.number), teams: state.teams.filter(t => t.enteredRound <= round.number) };
      const replacement = pairSwiss(pairingState, round.number, ctx.seed, random, ids);
      for (const match of late) addManualMatch(state, replacement, match);
      replacement.pairedAt = round.pairedAt;
      state.rounds.push(replacement);
      break;
    }
    case "CancelRound": {
      const removed = currentRound(state);
      state.rounds.pop();
      if (removed.stage === "playoff" && !state.rounds.some(r => r.stage === "playoff")) {
        for (const id of state.cut) { const p = player(state, id); if (p.status !== "dropped") p.status = "active"; }
        const swissCutPlayers = new Set(state.swissCuts.flatMap(c => c.cutPlayers));
        for (const p of competitors(state)) if (p.status === "cut" && !swissCutPlayers.has(p.id)) p.status = "active";
        state.cut = [];
        state.phase = state.settings.format === "single_elim" ? "registration" : "swiss";
      } else if (removed.stage === "playoff") updateEliminations(state, removed.matches, true);
      else state.phase = state.rounds.length ? "swiss" : "registration";
      const remainingRound = state.rounds.at(-1)?.number ?? 0;
      for (const cut of state.swissCuts) if (cut.afterRound >= remainingRound) {
        for (const id of cut.cutPlayers) if (player(state, id).status === "cut") player(state, id).status = "active";
        cut.roundPairedAfter = false;
      }
      break;
    }
    case "SwapPlayers": {
      requireCondition(command.a !== command.b, "SAME_PLAYER", "Choose two different players to swap.");
      const round = currentRound(state);
      requireCondition(player(state, command.a).status === "active" && player(state, command.b).status === "active", "INACTIVE_PLAYER", "Only active players can be swapped.");
      const a = round.matches.find(m => m.p1 === command.a || m.p2 === command.a);
      const b = round.matches.find(m => m.p1 === command.b || m.p2 === command.b);
      requireCondition(a && b, "PLAYER_NOT_PAIRED", "Both players must have a match in the current round.");
      editable(a); editable(b);
      for (const m of new Set([a, b])) {
        m.p1 = m.p1 === command.a ? command.b : m.p1 === command.b ? command.a : m.p1;
        m.p2 = m.p2 === command.a ? command.b : m.p2 === command.b ? command.a : m.p2;
        m.reports = [];
      }
      validatePairings(state, round, currentRound(input));
      break;
    }
    case "SetPairing": {
      const round = currentRound(state);
      const match = round.matches.find(m => m.id === command.matchId);
      requireCondition(match, "CURRENT_ROUND_ONLY", "Only a current-round pairing can be edited.");
      editable(match);
      requireCondition(player(state, command.p1).status === "active" && (command.p2 === null || player(state, command.p2).status === "active"), "INACTIVE_PLAYER", "Only active players can be assigned to a pairing.");
      match.p1 = command.p1; match.p2 = command.p2; match.reports = [];
      match.result = command.p2 === null ? "bye_win" : null;
      validatePairings(state, round, currentRound(input));
      break;
    }
    case "SplitMatch": {
      const round = currentRound(state);
      const match = round.matches.find(m => m.id === command.matchId);
      requireCondition(match, "CURRENT_ROUND_ONLY", "Only a current-round pairing can be split.");
      editable(match);
      round.matches = round.matches.filter(m => m.id !== match.id);
      break;
    }
    case "CreateMatch": {
      const round = currentRound(state);
      requireUnpaired(state, round, command.p1);
      requireCondition(command.p1 !== command.p2, "SAME_PLAYER", "Choose two different players.");
      if (command.p2 !== null) requireUnpaired(state, round, command.p2);
      addManualMatch(state, round, makeMatch(command.p1, command.p2, round.number, random, ids), command.table);
      break;
    }
    case "AddByeMatch": {
      const round = currentRound(state);
      requireUnpaired(state, round, command.playerId);
      addManualMatch(state, round, makeMatch(command.playerId, null, round.number, random, ids, command.result));
      break;
    }
    case "StartTimer": {
      const round = currentRound(state);
      const minutes = command.minutes ?? state.settings.roundMinutes;
      requireCondition(Number.isFinite(minutes) && minutes > 0, "INVALID_MINUTES", "The timer length must be positive.");
      round.startedAt = ctx.now; round.endsAt = shiftTime(ctx.now, minutes);
      break;
    }
    case "AdjustTimer": {
      const round = currentRound(state);
      requireCondition(round.endsAt, "TIMER_NOT_STARTED", "Start the round timer before adjusting it.");
      round.endsAt = shiftTime(round.endsAt, command.deltaMinutes);
      break;
    }
    case "ExtendMatch": {
      const { round, match } = findMatch(state, command.matchId);
      requireCondition(round === currentRound(state), "CURRENT_ROUND_ONLY", "Only current-round matches can receive an extension.");
      requireCondition(Number.isFinite(command.minutes) && command.minutes >= 0, "INVALID_MINUTES", "An extension must be a nonnegative number of minutes.");
      match.extensionMinutes += command.minutes;
      break;
    }
    case "AdjustPoints": {
      requireCondition(state.settings.format === "open_dueling" || state.settings.style === "open_dueling", "OPEN_DUELING_ONLY", "Manual points are available for Open Dueling events.");
      const p = player(state, competitorId(state, command.playerId));
      const points = (p.openDuelingPoints ?? 0) + command.delta;
      requireCondition(Number.isSafeInteger(command.delta) && Number.isSafeInteger(points), "INVALID_POINTS", "Points and adjustments must be safe integers.");
      p.openDuelingPoints = points;
      break;
    }
    case "EnterResult": {
      if (command.result !== null) requirePaired(state);
      const { round, match } = findMatch(state, command.matchId);
      validateResult(round, match, command.result);
      match.result = command.result; match.reports = [];
      if (round.stage === "playoff") updateEliminations(state, [match]);
      if (command.swapPlayers) {
        requireCondition(match.p2, "INVALID_SWAP", "Choose a match with two competitors to exchange their current opponents.");
        const current = currentRound(state);
        const changed = swapCurrentOpponents(current, match.p1, match.p2);
        if (current.stage === "playoff") updateEliminations(state, changed);
      }
      if (command.result !== null && command.drop && command.drop !== "none") {
        if (command.drop === "both" || command.result === "draw" || command.result === "double_loss") {
          drop(state, match.p1); if (match.p2) drop(state, match.p2);
        } else if (command.result === "p1" && match.p2) drop(state, match.p2);
        else if (command.result === "p2" || command.result === "bye_loss") drop(state, match.p1);
      }
      break;
    }
    case "ReportResult": {
      requirePaired(state);
      const { round, match } = findMatch(state, command.matchId);
      requireCondition(round === currentRound(state), "CURRENT_ROUND_ONLY", "Players can only report their current-round match.");
      const reportingId = competitorId(state, command.playerId);
      requireCondition(match.p1 === reportingId || match.p2 === reportingId, "NOT_YOUR_MATCH", "A player may only report their own match.");
      requireCondition(match.p2 !== null, "BYE_ALREADY_SCORED", "Byes are scored automatically.");
      requireCondition(match.result === null || match.reports.length > 0, "RESULT_ALREADY_ENTERED", "Staff have already entered this result.");
      validateResult(round, match, command.result);
      match.reports = match.reports.filter(r => r.by !== reportingId);
      match.reports.push({ by: reportingId, result: command.result, at: ctx.now });
      match.result = match.reports.length === 2 && match.reports.every(r => r.result === command.result) ? command.result : null;
      if (round.stage === "playoff") updateEliminations(state, [match]);
      break;
    }
    case "DropTeam":
    case "DropPlayer": {
      const id = competitorId(state, "teamId" in command ? command.teamId : command.playerId);
      requireCondition(player(state, id).status !== "cut", "PLAYER_CUT", "A cut player cannot be dropped. Undo the cut to restore them.");
      drop(state, id);
      break;
    }
    case "UndropTeam":
    case "UndropPlayer": {
      const p = player(state, competitorId(state, "teamId" in command ? command.teamId : command.playerId));
      requireCondition(p.status === "dropped", "PLAYER_NOT_DROPPED", "This player has not been dropped.");
      requireCondition(state.phase !== "playoff", "PLAYOFF_ORDER_LOCKED", "Dropped playoff players cannot re-enter the bracket.");
      if (command.option !== "next_round") {
        const round = currentRound(state);
        const alreadyPaired = round.matches.some(m => m.p1 === p.id || m.p2 === p.id);
        requireCondition(!alreadyPaired || command.option === "bye_win" || command.option === "bye_loss",
          "PLAYER_ALREADY_PAIRED", "This player already has a current-round match. Use next round or correct that result.");
        if (command.option === "repair") {
          repairUndrop(state, round, p, random, ids);
        } else if (command.option === "swap_previous_opponent") {
          const former = state.rounds.find(r => r.number === round.number - 1)?.matches.find(m => m.p2 !== null && (m.p1 === p.id || m.p2 === p.id));
          requireCondition(former, "NO_FORMER_OPPONENT", "The returning player has no previous opponent.");
          const other = player(state, former.p1 === p.id ? former.p2! : former.p1);
          requireCondition(other.status === "active", "INVALID_SWAP", "The former opponent must still be active.");
          const match = round.matches.find(m => m.p1 === other.id || m.p2 === other.id);
          requireCondition(match, "PLAYER_NOT_PAIRED", "The former opponent has no current-round match.");
          other.status = "dropped";
          other.droppedAfterRound = round.number - 1;
          if (match.p1 === other.id) match.p1 = p.id; else match.p2 = p.id;
          match.result = null;
          match.reports = [];
        } else if (command.option === "swap_with_dropped") {
          const other = player(state, command.swapWith ?? "");
          requireCondition(other.status === "dropped" && other.id !== p.id, "INVALID_SWAP", "Choose another dropped player with an unscored current-round seat.");
          const match = round.matches.find(m => m.p1 === other.id || m.p2 === other.id);
          requireCondition(match, "PLAYER_NOT_PAIRED", "The dropped player has no current-round seat.");
          editable(match);
          if (match.p1 === other.id) match.p1 = p.id; else match.p2 = p.id;
          match.reports = [];
          assignTables(round.matches, competitors(state), state.settings.startingTable, true, teamSize(state));
        } else if (command.option === "take_bye") {
          const bye = round.matches.find(m => m.p2 === null && m.result === "bye_win");
          requireCondition(bye, "NO_BYE", "There is no awarded bye to take in the current round.");
          convertBye(state, round, bye, p.id, true);
        } else if (!alreadyPaired) addManualMatch(state, round, makeMatch(p.id, null, round.number, random, ids, command.option));
      }
      p.status = "active"; p.droppedAfterRound = null;
      break;
    }
    case "CutToPlayoff": {
      requireCondition(state.settings.format === "swiss" && state.phase !== "playoff", "INVALID_PHASE", "A Swiss event can be cut only before playoffs begin.");
      allResults(state);
      const size = command.size ?? state.settings.topCut;
      requireCondition(Number.isInteger(size) && size >= 2 && size <= competitors(state).filter(p => p.status === "active").length, "INVALID_CUT", "Choose a cut size of at least two and no larger than the active field.");
      state.cut = playersAtCut(state, size, command.tieOrder, false);
      for (const p of competitors(state)) if (p.status === "active" && !state.cut.includes(p.id)) p.status = "cut";
      state.phase = "playoff";
      for (const cut of state.swissCuts) cut.roundPairedAfter = true;
      state.rounds.push(initialBracket(state, state.cut, ctx.seed, random, ids));
      break;
    }
    case "SwissCut": {
      requireCondition(state.settings.format === "swiss" && state.phase === "swiss", "INVALID_PHASE", "A Swiss cut requires a Swiss round and cannot run during playoffs.");
      allResults(state);
      const active = competitors(state).filter(p => p.status === "active");
      requireCondition(Number.isInteger(command.value) && command.value >= 0 && (command.mode !== "top" || command.value <= active.length), "INVALID_CUT", "Choose a nonnegative cut value within the active field for a top cut.");
      requireCondition(command.mode === "top" || command.tieOrder === undefined, "INVALID_TIE_ORDER", "Minimum points cuts do not use a tie selection.");
      const survivors = new Set(command.mode === "top" ? playersAtCut(state, command.value, command.tieOrder, true)
        : standings(state).filter(row => row.status === "active" && row.matchPoints >= command.value).map(row => row.playerId));
      const cutPlayers = active.filter(p => !survivors.has(p.id)).map(p => p.id);
      for (const id of cutPlayers) player(state, id).status = "cut";
      state.swissCuts.push({ afterRound: currentRound(state).number, mode: command.mode, value: command.value, cutPlayers });
      if (command.pairNext) pairNextRound(state, ctx, random, ids);
      break;
    }
    case "UndoSwissCut": {
      const cut = state.swissCuts.at(-1);
      requireCondition(cut, "NO_SWISS_CUT", "There is no Swiss cut to undo.");
      requireCondition(!cut.roundPairedAfter && state.phase !== "playoff" && (state.rounds.at(-1)?.number ?? 0) <= cut.afterRound, "SWISS_CUT_LOCKED", "A round has been paired after this Swiss cut.");
      for (const id of cut.cutPlayers) if (player(state, id).status === "cut") player(state, id).status = "active";
      state.swissCuts.pop();
      break;
    }
    case "CompleteEvent":
      allResults(state);
      requireCondition(!state.settings.requireMemberId || !state.players.some(p => p.memberId !== null && isTemporaryMemberId(p.memberId)),
        "TEMPORARY_MEMBER_IDS", "Temporary IDs must be replaced before finalizing");
      state.phase = "complete"; state.completedAt = ctx.now;
      break;
    case "ReopenEvent":
      requireCondition(state.phase === "complete", "EVENT_NOT_COMPLETE", "This event is already open.");
      state.phase = state.rounds.some(r => r.stage === "playoff") ? "playoff" : state.rounds.length ? "swiss" : "registration";
      state.completedAt = null;
      break;
    case "AddPenalty": {
      player(state, command.playerId);
      const infraction = state.settings.infractions.find(i => i.id === command.infractionId);
      requireCondition(infraction, "INFRACTION_NOT_FOUND", "Choose an infraction from this event's infraction list.");
      requireCondition(command.round == null || state.rounds.some(r => r.number === command.round), "ROUND_NOT_FOUND", "That penalty round does not exist.");
      state.penalties.push({ id: randomId(random, ids), playerId: command.playerId, infractionId: command.infractionId, penalty: command.penalty ?? infraction.defaultPenalty,
        round: command.round ?? null, judge: command.judge ?? null, notes: command.notes ?? null, at: ctx.now });
      break;
    }
    case "RemovePenalty":
      requireCondition(state.penalties.some(p => p.id === command.penaltyId), "PENALTY_NOT_FOUND", "That penalty does not exist.");
      state.penalties = state.penalties.filter(p => p.id !== command.penaltyId);
      break;
    default: { const exhaustive: never = command; throw new CommandError("UNKNOWN_COMMAND", `Unknown command: ${String(exhaustive)}`); }
  }
  syncTeamMembers(state);
  recordActivity(state, command.type, ctx, command);
  return state;
}

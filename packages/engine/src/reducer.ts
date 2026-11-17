import { CommandError, type Command, type CommandContext, type EventSettings, type EventState, type Match, type MatchResult, type Player, type Round } from "./types.js";
import { DEFAULT_INFRACTIONS } from "./defaults.js";
import { createRng, randomId, shuffle } from "./rng.js";
import { assignTables, makeMatch, pairSwiss } from "./pairing.js";
import { advanceBracket, initialBracket, refreshEliminations } from "./bracket.js";
import { compareStandings, standings } from "./standings.js";
import { normalizeMemberId } from "./member-id.js";
import { integrity } from "./integrity.js";

function requireCondition(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new CommandError(code, message);
}

function validateContext(ctx: CommandContext): void {
  requireCondition(Number.isSafeInteger(ctx.seed) && ctx.seed >= 0, "INVALID_SEED", "The command needs a nonnegative safe-integer seed.");
  requireCondition(Number.isFinite(Date.parse(ctx.now)), "INVALID_TIME", "The command needs a valid timestamp.");
}

function validateSettings(settings: EventSettings): void {
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
    format: "swiss", plannedRounds: null, topCut: 0, tiebreak: "legacy",
    startingTable: 1, roundMinutes: 50, location: null, startsAt: null,
    infractions: DEFAULT_INFRACTIONS, publicNames: "full", registrationOpen: true,
    requireMemberId: false, allowLateEntry: true, ...settings,
  });
  validateSettings(configured);
  return { schemaVersion: 1, settings: configured, phase: "registration", players: [], rounds: [], cut: [], swissCuts: [], penalties: [], staff: [], createdAt: ctx.now, completedAt: null };
}

function player(state: EventState, id: string): Player {
  const found = state.players.find(p => p.id === id);
  requireCondition(found, "PLAYER_NOT_FOUND", "That player is not registered for this event.");
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
  const p = player(state, id);
  p.status = "dropped";
  p.droppedAfterRound = state.rounds.at(-1)?.number ?? 0;
}

function allResults(state: EventState): void {
  requirePaired(state);
  requireCondition(state.rounds.every(r => r.matches.every(m => m.result !== null)), "MISSING_RESULTS", "Enter every outstanding result before continuing.");
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
  requireCondition(player(state, id).status === "active", "INACTIVE_PLAYER", "Only active players can be assigned to a pairing.");
  requireCondition(!round.matches.some(m => m.p1 === id || m.p2 === id), "PLAYER_ALREADY_PAIRED", "This player already has a current-round match.");
}

/** Preserve existing tables; manual additions use the next available table. */
function addManualMatch(state: EventState, round: Round, match: Match, table?: number | null): void {
  validateResult(round, match, match.result);
  if (match.p2 !== null) {
    const a = round.stage === "swiss" ? player(state, match.p1).fixedTable : null;
    const b = round.stage === "swiss" ? player(state, match.p2).fixedTable : null;
    requireCondition(a === null || b === null || a === b, "FIXED_TABLE_CONFLICT", "These players require different fixed tables.");
    const fixed = a ?? b;
    requireCondition(table == null || (Number.isInteger(table) && table > 0), "INVALID_TABLE", "A table must be a positive integer.");
    requireCondition(fixed === null || table == null || table === fixed, "FIXED_TABLE_CONFLICT", "The pairing must use the player's fixed table.");
    let assigned = table ?? fixed ?? state.settings.startingTable;
    const used = new Set(round.matches.map(m => m.table));
    if (table == null && fixed === null) while (used.has(assigned)) assigned++;
    requireCondition(!used.has(assigned), "TABLE_IN_USE", "That table already has a match.");
    match.table = assigned;
  } else requireCondition(table == null, "INVALID_TABLE", "A bye has no table.");
  round.matches.push(match);
}

function orderAtCut(state: EventState, size: number, tieOrder: string[] | undefined, random: () => number) {
  const rows = standings(state).filter(s => s.status === "active");
  let start = size - 1, end = size;
  const cutSet = new Set<string>();
  if (size > 0 && rows[size] && compareStandings(rows[size - 1], rows[size], cutSet) === 0) {
    while (start > 0 && compareStandings(rows[start - 1], rows[size - 1], cutSet) === 0) start--;
    while (end < rows.length && compareStandings(rows[end], rows[size - 1], cutSet) === 0) end++;
    const tied = rows.slice(start, end);
    const order = tieOrder ?? shuffle(tied.map(s => s.playerId), random);
    requireCondition(order.length === tied.length && new Set(order).size === tied.length && order.every(id => tied.some(s => s.playerId === id)), "INVALID_TIE_ORDER", "Tie order must list every player tied across the cut line exactly once.");
    const byId = new Map(tied.map(s => [s.playerId, s]));
    rows.splice(start, tied.length, ...order.map(id => byId.get(id)!));
  } else requireCondition(tieOrder === undefined, "INVALID_TIE_ORDER", "There is no tie across the cut line to override.");
  return rows;
}

function editable(match: Match): void {
  requireCondition(match.result === null, "RESULT_ALREADY_ENTERED", "Clear the result before editing this pairing.");
}

function validatePairings(state: EventState, round: Round, before: Round): void {
  const ids = round.matches.flatMap(m => m.p2 === null ? [m.p1] : [m.p1, m.p2]);
  requireCondition(ids.length === new Set(ids).size, "DUPLICATE_PLAYER", "Each player must appear exactly once in this round.");
  for (const id of ids) player(state, id);
  // The round roster excludes next-round undrops. Late entrants already have
  // their one-player backfill matches, so they remain part of this roster.
  const required = before.matches.flatMap(m => m.p2 === null ? [m.p1] : [m.p1, m.p2]).filter(id => player(state, id).status === "active");
  requireCondition(required.every(id => ids.includes(id)), "MISSING_PLAYER", "Every active player in this round must appear exactly once.");
  assignTables(round.matches, state.players, state.settings.startingTable, round.stage === "swiss");
}

function shiftTime(time: string, minutes: number): string {
  requireCondition(Number.isFinite(minutes), "INVALID_MINUTES", "Timer adjustments must be a finite number of minutes.");
  const shifted = Date.parse(time) + minutes * 60_000;
  requireCondition(Number.isFinite(shifted) && Math.abs(shifted) <= 8.64e15, "INVALID_TIME", "The timer adjustment is outside the supported date range.");
  return new Date(shifted).toISOString();
}

export function applyCommand(input: EventState, command: Command, ctx: CommandContext): EventState {
  validateContext(ctx);
  requireCondition(input.phase !== "complete" || command.type === "ReopenEvent", "EVENT_COMPLETE", "Reopen the event before making changes.");
  const state = structuredClone(input);
  const random = createRng(ctx.seed);
  const ids = new Set([...state.players.map(p => p.id), ...state.rounds.flatMap(r => r.matches.map(m => m.id)), ...state.staff.map(s => s.id), ...state.penalties.map(p => p.id)]);
  switch (command.type) {
    case "UpdateSettings": {
      requireCondition(command.settings.format === undefined || command.settings.format === state.settings.format || state.rounds.length === 0, "FORMAT_LOCKED", "The format cannot change after a round has been paired.");
      state.settings = { ...state.settings, ...structuredClone(command.settings) };
      validateSettings(state.settings);
      break;
    }
    case "AddPlayers": {
      requireCondition(state.phase === "registration" || state.phase === "swiss", "REGISTRATION_CLOSED", "Players cannot enter after the playoff cut.");
      requireCondition(state.rounds.length === 0 || state.settings.allowLateEntry, "LATE_ENTRY_CLOSED", "Late entry is disabled for this event.");
      for (const entry of command.players) {
        requireCondition(entry.name.trim(), "INVALID_NAME", "Every player needs a name.");
        if (entry.userId !== null) requireUnusedAccount(state, entry.userId);
        const memberId = entry.memberId == null ? null : normalizeMemberId(entry.memberId);
        requireCondition(!state.settings.requireMemberId || memberId !== null, "member_id_required", "A member ID is required to enter this event.");
        const p: Player = { id: randomId(random, ids), userId: entry.userId, name: entry.name.trim(), memberId, status: "active", droppedAfterRound: null,
          enteredRound: (state.rounds.at(-1)?.number ?? 0) + 1, fixedTable: null, checkedIn: false, notes: null };
        state.players.push(p);
        for (const r of state.rounds) r.matches.push(makeMatch(p.id, null, r.number, random, ids, "bye_loss"));
      }
      break;
    }
    case "UpdatePlayer": {
      const p = player(state, command.playerId);
      if (command.name !== undefined) { requireCondition(command.name.trim(), "INVALID_NAME", "The player needs a name."); p.name = command.name.trim(); }
      if (command.memberId !== undefined) {
        const memberId = command.memberId === null ? null : normalizeMemberId(command.memberId);
        requireCondition(!state.settings.requireMemberId || memberId !== null, "member_id_required", "A member ID is required for this event.");
        p.memberId = memberId;
      }
      if (command.notes !== undefined) p.notes = command.notes;
      if (command.fixedTable !== undefined) {
        requireCondition(command.fixedTable === null || (Number.isInteger(command.fixedTable) && command.fixedTable > 0), "INVALID_TABLE", "A fixed table must be a positive integer.");
        p.fixedTable = command.fixedTable;
      }
      break;
    }
    case "LinkPlayerAccount": {
      const p = player(state, command.playerId);
      requireCondition(p.userId === null, "ACCOUNT_ALREADY_LINKED", "This entry already has an account.");
      requireUnusedAccount(state, command.userId);
      p.userId = command.userId;
      break;
    }
    case "ReEnroll": {
      const p = player(state, command.playerId);
      requireCondition(p.status === "dropped", "PLAYER_NOT_DROPPED", "This player has not been dropped.");
      requireCondition(state.phase !== "playoff", "PLAYOFF_ORDER_LOCKED", "Dropped playoff players cannot re-enter the bracket.");
      for (const round of state.rounds) if (!round.matches.some(m => m.p1 === p.id || m.p2 === p.id)) {
        round.matches.push(makeMatch(p.id, null, round.number, random, ids, "bye_loss"));
      }
      p.status = "active"; p.droppedAfterRound = null;
      break;
    }
    case "RemovePlayer":
      requireCondition(state.phase === "registration", "REGISTRATION_ONLY", "Players can only be removed during registration. Drop them after play begins.");
      player(state, command.playerId);
      state.players = state.players.filter(p => p.id !== command.playerId);
      state.penalties = state.penalties.filter(p => p.playerId !== command.playerId);
      break;
    case "SetCheckedIn": player(state, command.playerId).checkedIn = command.checkedIn; break;
    case "AddStaff":
      requireCondition(command.name.trim(), "INVALID_NAME", "The staff member needs a name.");
      requireAccount(command.userId);
      requireCondition(!state.staff.some(s => s.userId === command.userId), "duplicate_account", "This account is already on the event staff.");
      state.staff.push({ id: randomId(random, ids), userId: command.userId, name: command.name.trim(), role: command.role });
      break;
    case "SetStaffRole": {
      const staff = state.staff.find(s => s.id === command.staffId);
      requireCondition(staff, "STAFF_NOT_FOUND", "That staff member does not exist.");
      staff.role = command.role;
      break;
    }
    case "RemoveStaff":
      requireCondition(state.staff.some(s => s.id === command.staffId), "STAFF_NOT_FOUND", "That staff member does not exist.");
      state.staff = state.staff.filter(s => s.id !== command.staffId);
      break;
    case "PairNextRound": {
      allResults(state);
      for (const cut of state.swissCuts) cut.roundPairedAfter = true;
      if (state.phase === "playoff") state.rounds.push(advanceBracket(state, ctx.seed, random, ids));
      else {
        const active = state.players.filter(p => p.status === "active");
        requireCondition(active.length, "NO_PLAYERS", "Add or reactivate players before pairing a round.");
        if (state.settings.format === "single_elim") {
          state.cut = shuffle(active.map(p => p.id), random);
          state.phase = "playoff";
          state.rounds.push(initialBracket(state, state.cut, ctx.seed, random, ids));
        } else {
          state.rounds.push(pairSwiss(state, (state.rounds.at(-1)?.number ?? 0) + 1, ctx.seed, random, ids));
          state.phase = "swiss";
        }
      }
      break;
    }
    case "RepairRound": {
      const round = currentRound(state);
      requireCondition(round.matches.every(m => m.p2 === null || m.result === null), "RESULT_ALREADY_ENTERED", "A round can only be repaired before any non-bye result is entered.");
      requireCondition(round.seed !== ctx.seed, "NEW_SEED_REQUIRED", "Use a new seed to repair this round.");
      state.rounds.pop();
      if (round.stage === "playoff") {
        if (!state.rounds.some(r => r.stage === "playoff")) {
          if (state.settings.format === "single_elim") state.cut = shuffle(state.cut, random);
          state.rounds.push(initialBracket(state, state.cut, ctx.seed, random, ids));
        } else state.rounds.push(advanceBracket(state, ctx.seed, random, ids));
        break;
      }
      const late = round.matches.filter(m => player(state, m.p1).enteredRound > round.number);
      // Late entrants already have backfill for this round and wait until the next.
      const pairingState = { ...state, players: state.players.filter(p => p.enteredRound <= round.number) };
      const replacement = pairSwiss(pairingState, round.number, ctx.seed, random, ids);
      replacement.matches.push(...late);
      state.rounds.push(replacement);
      break;
    }
    case "CancelRound": {
      const removed = currentRound(state);
      state.rounds.pop();
      if (removed.stage === "playoff" && !state.rounds.some(r => r.stage === "playoff")) {
        for (const id of state.cut) { const p = player(state, id); if (p.status !== "dropped") p.status = "active"; }
        const swissCutPlayers = new Set(state.swissCuts.flatMap(c => c.cutPlayers));
        for (const p of state.players) if (p.status === "cut" && !swissCutPlayers.has(p.id)) p.status = "active";
        state.cut = [];
        state.phase = state.settings.format === "single_elim" ? "registration" : "swiss";
      } else if (removed.stage === "playoff") refreshEliminations(state);
      else state.phase = state.rounds.length ? "swiss" : "registration";
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
    case "EnterResult": {
      if (command.result !== null) requirePaired(state);
      const { round, match } = findMatch(state, command.matchId);
      validateResult(round, match, command.result);
      match.result = command.result; match.reports = [];
      if (round.stage === "playoff") refreshEliminations(state);
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
      requireCondition(match.p1 === command.playerId || match.p2 === command.playerId, "NOT_YOUR_MATCH", "A player may only report their own match.");
      requireCondition(match.p2 !== null, "BYE_ALREADY_SCORED", "Byes are scored automatically.");
      requireCondition(match.result === null || match.reports.length > 0, "RESULT_ALREADY_ENTERED", "Staff have already entered this result.");
      validateResult(round, match, command.result);
      match.reports = match.reports.filter(r => r.by !== command.playerId);
      match.reports.push({ by: command.playerId, result: command.result, at: ctx.now });
      match.result = match.reports.length === 2 && match.reports.every(r => r.result === command.result) ? command.result : null;
      if (round.stage === "playoff") refreshEliminations(state);
      break;
    }
    case "DropPlayer": drop(state, command.playerId); break;
    case "UndropPlayer": {
      const p = player(state, command.playerId);
      requireCondition(p.status === "dropped", "PLAYER_NOT_DROPPED", "This player has not been dropped.");
      requireCondition(state.phase !== "playoff", "PLAYOFF_ORDER_LOCKED", "Dropped playoff players cannot re-enter the bracket.");
      if (command.option !== "next_round") {
        const round = currentRound(state);
        requireCondition(!round.matches.some(m => m.p1 === p.id || m.p2 === p.id), "PLAYER_ALREADY_PAIRED", "This player already has a current-round match. Use next round or correct that result.");
        if (command.option === "swap_with_dropped") {
          const other = player(state, command.swapWith ?? "");
          requireCondition(other.status === "dropped" && other.id !== p.id, "INVALID_SWAP", "Choose another dropped player with an unscored current-round seat.");
          const match = round.matches.find(m => m.p1 === other.id || m.p2 === other.id);
          requireCondition(match, "PLAYER_NOT_PAIRED", "The dropped player has no current-round seat.");
          editable(match);
          if (match.p1 === other.id) match.p1 = p.id; else match.p2 = p.id;
          match.reports = [];
          assignTables(round.matches, state.players, state.settings.startingTable, true);
        } else if (command.option === "take_bye") {
          const bye = round.matches.find(m => m.p2 === null && m.result === "bye_win" && player(state, m.p1).status === "active");
          requireCondition(bye, "NO_BYE", "There is no active player's bye to take in the current round.");
          round.matches = round.matches.filter(m => m.id !== bye.id);
          addManualMatch(state, round, makeMatch(p.id, bye.p1, round.number, random, ids));
        } else round.matches.push(makeMatch(p.id, null, round.number, random, ids, command.option));
      }
      p.status = "active"; p.droppedAfterRound = null;
      break;
    }
    case "CutToPlayoff": {
      requireCondition(state.settings.format === "swiss" && state.phase !== "playoff", "INVALID_PHASE", "A Swiss event can be cut only before playoffs begin.");
      allResults(state);
      const size = command.size ?? state.settings.topCut;
      requireCondition(Number.isInteger(size) && size >= 2 && size <= state.players.filter(p => p.status === "active").length, "INVALID_CUT", "Choose a cut size of at least two and no larger than the active field.");
      const rows = orderAtCut(state, size, command.tieOrder, random);
      state.cut = rows.slice(0, size).map(s => s.playerId);
      for (const p of state.players) if (p.status === "active" && !state.cut.includes(p.id)) p.status = "cut";
      state.phase = "playoff";
      for (const cut of state.swissCuts) cut.roundPairedAfter = true;
      state.rounds.push(initialBracket(state, state.cut, ctx.seed, random, ids));
      break;
    }
    case "SwissCut": {
      requireCondition(state.settings.format === "swiss" && state.phase === "swiss", "INVALID_PHASE", "A Swiss cut requires a Swiss round and cannot run during playoffs.");
      allResults(state);
      const active = state.players.filter(p => p.status === "active");
      requireCondition(Number.isInteger(command.value) && command.value >= 0 && (command.mode !== "top" || command.value <= active.length), "INVALID_CUT", "Choose a nonnegative cut value within the active field for a top cut.");
      const rows = command.mode === "top" ? orderAtCut(state, command.value, command.tieOrder, random) : standings(state).filter(s => s.status === "active");
      requireCondition(command.mode === "top" || command.tieOrder === undefined, "INVALID_TIE_ORDER", "Minimum points cuts do not use a tie order.");
      const cutPlayers = (command.mode === "top" ? rows.slice(command.value) : rows.filter(s => s.matchPoints < command.value)).map(s => s.playerId);
      for (const id of cutPlayers) player(state, id).status = "cut";
      state.swissCuts.push({ afterRound: currentRound(state).number, mode: command.mode, value: command.value, cutPlayers });
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
    case "CompleteEvent": allResults(state); state.phase = "complete"; state.completedAt = ctx.now; break;
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
  return state;
}

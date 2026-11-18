import { randomBytes, randomInt } from "node:crypto";
import { applyCommand, createEvent, integrity, playerView, standings, suggestRounds, type Command, type CommandContext, type DeskView, type EventState, type Player, type StaffRole, type StaffAssignment, competitors, printData, recordActivity } from "@dd-tournament/engine";
import { parseLegacyPlayerList, parseLegacyTournament, type LegacyPlayer } from "@dd-tournament/engine/legacy";
import { isTemporaryMemberId, normalizeMemberId } from "@dd-tournament/engine";
import { lookupAccounts, searchAccounts } from "./bridge";
import { cacheUser, cachedUser, database, eventRecord, saveEvent, type EventRecord } from "./db";
import { HttpError } from "./http";
import { mergeGlobalPlayers } from "./global-players";
import { joinReason, requireCommand, requireDummyData, requireImport, requireStaff } from "./permissions";
import { locationSettings } from "./locations";
import type { DummyData, TournamentUser } from "./validation";

export function context(user: TournamentUser): CommandContext {
  return { now: new Date().toISOString(), seed: randomInt(0, 2 ** 48 - 1), actor: String(user.id) };
}
export function deskView(event: EventRecord, role: StaffRole): DeskView {
  return { state: event.state, standings: standings(event.state), suggestedRounds: suggestRounds(competitors(event.state).length),
    version: event.version, integrity: integrity(event.state), printData: printData(event.state), viewerRole: role, ownerUserId: event.ownerUserId,
    links: { public: `/e/${event.code}`, desk: `/e/${event.code}/desk`, join: `/e/${event.code}/me` },
    accounts: Object.fromEntries(event.state.players.map(player => {
      const user = player.userId === null ? null : cachedUser(player.userId);
      return [player.id, { userId: player.userId, username: user?.username ?? null, discordUserId: user?.discordUserId ?? null, discordUsername: user?.discordUsername ?? null }];
    })) };
}
export function playerResponse(event: EventRecord, user: TournamentUser) {
  const player = event.state.players.find(player => player.userId === user.id);
  if (player) return { joined: true, view: playerView(event.state, player.id, event.version) };
  const reason = joinReason(event.state, user.memberId);
  return { joined: false, canJoin: !reason, ...(reason ? { reason } : {}), memberId: user.memberId };
}
export function newEvent(user: TournamentUser, name: string, settings: Parameters<typeof createEvent>[0], staff: StaffAssignment[] = []) {
  return database().transaction(() => {
    cacheUser(user);
    let state = createEvent({ ...locationSettings(user.id, settings), name }, context(user));
    state = applyCommand(state, { type: "AddStaff", userId: user.id, name: user.displayName, role: "organizer" }, context(user));
    for (const entry of staff) {
      if (entry.userId === user.id) {
        if ((entry.position ?? entry.role) !== "organizer") throw new HttpError(403, "forbidden_role");
        continue;
      }
      state = applyCommand(state, { type: "AddStaff", ...entry }, context(user));
    }
    let code: string;
    do { code = randomBytes(5).toString("hex").toUpperCase(); } while (database().prepare("SELECT 1 FROM events WHERE code=?").get(code));
    database().prepare("INSERT INTO events(code,owner_user_id,state,version) VALUES (?,?,?,1)").run(code, user.id, JSON.stringify(state));
    return code;
  }).immediate();
}
export async function resolveCommand(command: Command): Promise<Command> {
  const ids = command.type === "UpdateSettings" && command.staff ? command.staff.map(s => s.userId) : command.type === "AddPlayers" ? command.players.flatMap(p => p.userId === null ? [] : [p.userId]) : command.type === "AddStaff" || command.type === "LinkPlayerAccount" ? [command.userId] : [];
  if (!ids.length) return command;
  const { users, missing } = await lookupAccounts(ids);
  if (missing.length) throw new HttpError(422, "account_not_found");
  function account(id: number) {
    const user = users.find(user => user.id === id);
    if (!user) throw new HttpError(422, "account_not_found");
    return user;
  }
  if (command.type === "UpdateSettings" && command.staff) return { ...command, staff: command.staff.map(s => ({ ...s, name: account(s.userId).displayName })) };
  if (command.type === "AddPlayers") return { ...command, players: command.players.map(p => {
    if (p.userId === null) return p;
    const user = account(p.userId); return { userId: user.id, name: user.displayName, memberId: user.memberId };
  }) };
  if (command.type === "AddStaff") return { ...command, name: account(command.userId).displayName };
  return command;
}
function runCommands(code: string, user: TournamentUser, expectedVersion: number,
  authorize: (event: EventRecord) => void, makeCommands: (event: EventRecord) => Command[]) {
  return database().transaction(() => {
    const event = eventRecord(code);
    authorize(event);
    const role = requireStaff(event, user.id);
    if (event.version !== expectedVersion) throw new HttpError(409, "version_conflict", { desk: deskView(event, role) });
    const commands = makeCommands(event);
    let state = event.state;
    for (const command of commands) state = applyCommand(state, command.type === "UpdateSettings"
      ? { ...command, settings: locationSettings(event.ownerUserId, command.settings) } : command, context(user));
    return { desk: deskView(saveEvent(event, state), role), count: commands.length };
  }).immediate();
}
export function runCommand(code: string, user: TournamentUser, expectedVersion: number, command: Command) {
  return runCommands(code, user, expectedVersion, event => requireCommand(event, user.id, command), () => [command]).desk;
}
export function runDummyData(code: string, user: TournamentUser, data: DummyData) {
  const result = runCommands(code, user, data.expectedVersion, event => requireDummyData(event, user.id), event => {
    if (data.action === "players") {
      if (event.state.phase !== "registration") throw new HttpError(422, "REGISTRATION_ONLY");
      let number = 0;
      const used = new Set(event.state.players.map(p => p.memberId));
      let memberId = 9999000000;
      for (const player of event.state.players) {
        const match = /^Test Player (\d+)$/.exec(player.name);
        if (match) number = Math.max(number, Number(match[1]));
      }
      const players = Array.from({ length: data.count }, () => {
        while (used.has(String(memberId))) memberId++;
        if (memberId > 9999999999) throw new HttpError(422, "temporary_id_exhausted");
        const id = String(memberId++); used.add(id);
        return { userId: null, name: `Test Player ${String(++number).padStart(2, "0")}`, memberId: id };
      });
      return [{ type: "AddPlayers", players }];
    }
    if (event.state.phase === "complete") throw new HttpError(422, "EVENT_COMPLETE");
    const round = event.state.rounds.at(-1);
    if (!round) throw new HttpError(422, "NO_ROUND");
    return round.matches.filter(match => match.result === null && match.p2 !== null).map(match => {
      const roll = Math.random();
      return { type: "EnterResult", matchId: match.id, result: round.stage === "playoff" ? (roll < 0.5 ? "p1" : "p2")
        : roll < 0.425 ? "p1" : roll < 0.85 ? "p2" : roll < 0.95 ? "draw" : "double_loss" };
    });
  });
  return data.action === "players" ? { desk: result.desk, added: data.count } : { desk: result.desk, entered: result.count };
}
export function joinEvent(code: string, user: TournamentUser) {
  return database().transaction(() => {
    const event = eventRecord(code);
    if (event.state.players.some(p => p.userId === user.id)) return playerResponse(event, user);
    const reason = joinReason(event.state, user.memberId);
    if (reason) return playerResponse(event, user);
    const memberId = user.memberId === null ? null : normalizeMemberId(user.memberId);
    const imported = memberId && !isTemporaryMemberId(memberId) && event.state.players.find(player => player.userId === null && player.memberId === memberId);
    const command: Command = imported ? { type: "LinkPlayerAccount", playerId: imported.id, userId: user.id }
      : { type: "AddPlayers", players: [{ userId: user.id, name: user.displayName, memberId }] };
    return playerResponse(saveEvent(event, applyCommand(event.state, command, context(user))), user);
  }).immediate();
}
export function playerCommand(code: string, user: TournamentUser, make: (player: Player) => Command) {
  return database().transaction(() => {
    const event = eventRecord(code);
    const player = event.state.players.find(player => player.userId === user.id);
    if (!player) throw new HttpError(403, "not_joined");
    return playerResponse(saveEvent(event, applyCommand(event.state, make(player), context(user))), user);
  }).immediate();
}
async function matchLegacyPlayers(players: readonly LegacyPlayer[]) {
  const byMemberId = new Map<string, TournamentUser>();
  for (const player of players) {
    if (!player.memberId || isTemporaryMemberId(player.memberId) || byMemberId.has(player.memberId)) continue;
    const users = await searchAccounts(player.memberId);
    const exact = users.filter(user => user.memberId === player.memberId);
    if (exact.length === 1) byMemberId.set(player.memberId, exact[0]!);
  }
  return byMemberId;
}
export async function importEvent(code: string, user: TournamentUser, kind: "tournament" | "players" | "team-players", xml: string) {
  const before = eventRecord(code);
  requireImport(before, user.id);
  if (kind !== "tournament" && before.state.phase !== "registration") throw new HttpError(422, "REGISTRATION_ONLY");
  const source = kind !== "players" ? parseLegacyTournament(xml, context(user)) : null;
  const parsed = kind === "tournament" ? source : null;
  if (kind === "team-players" && ((source?.state.settings.playerStructure ?? 1) === 1 || before.state.settings.playerStructure !== 1)) throw new HttpError(422, "INVALID_PLAYER_STRUCTURE");
  const players = source ? source.players : parseLegacyPlayerList(xml);
  const matches = await matchLegacyPlayers(players);
  return database().transaction(() => {
    const event = eventRecord(code);
    requireImport(event, user.id);
    if (event.version !== before.version) throw new HttpError(409, "version_conflict", { desk: deskView(event, requireStaff(event, user.id)) });
    if (kind !== "tournament" && event.state.phase !== "registration") throw new HttpError(422, "REGISTRATION_ONLY");
    let state: EventState;
    let imported = 0;
    let unmatched = 0;
    if (parsed) {
      state = parsed.state;
      state.staff = event.state.staff;
      const linked = new Set<number>();
      for (const player of state.players) {
        const account = player.memberId ? matches.get(player.memberId) : undefined;
        if (account && !linked.has(account.id)) { player.userId = account.id; linked.add(account.id); }
        else unmatched++;
        imported++;
      }
    } else {
      state = structuredClone(event.state);
      for (const player of players) {
        const account = player.memberId ? matches.get(player.memberId) : undefined;
        if (state.players.some(p => (player.memberId !== null && p.memberId === player.memberId) || (account && p.userId === account.id))) continue;
        state = applyCommand(state, { type: "AddPlayers", players: [{ userId: account?.id ?? null,
          name: [player.firstName, player.lastName].filter(Boolean).join(" ") || "Imported player", memberId: player.memberId }] }, context(user));
        imported++; if (!account) unmatched++;
      }
    }
    if (parsed) state.activityLog = structuredClone(event.state.activityLog ?? []);
    recordActivity(state, parsed ? "ImportTournament" : "ImportPlayers", context(user));
    mergeGlobalPlayers(user.id, players);
    return { desk: deskView(saveEvent(event, state), requireStaff(event, user.id)), imported, unmatched };
  }).immediate();
}

/** Open Tournament: the file becomes a new event and the caller becomes its organizer. */
export async function openTournamentAsNewEvent(user: TournamentUser, xml: string) {
  const parsed = parseLegacyTournament(xml, context(user));
  const matches = await matchLegacyPlayers(parsed.players);
  return database().transaction(() => {
    cacheUser(user);
    const phase = parsed.state.phase;
    // Staff can be added only while the event is open for changes; the real phase comes back straight after.
    let state: EventState = applyCommand({ ...parsed.state, phase: "registration" }, { type: "AddStaff", userId: user.id, name: user.displayName, role: "organizer" }, context(user));
    state = { ...state, phase };
    let unmatched = 0;
    const linked = new Set<number>();
    for (const player of state.players) {
      const account = player.memberId ? matches.get(player.memberId) : undefined;
      if (account && !linked.has(account.id)) { player.userId = account.id; linked.add(account.id); } else unmatched++;
    }
    recordActivity(state, "ImportTournament", context(user));
    mergeGlobalPlayers(user.id, parsed.players);
    let code: string;
    do { code = randomBytes(5).toString("hex").toUpperCase(); } while (database().prepare("SELECT 1 FROM events WHERE code=?").get(code));
    database().prepare("INSERT INTO events(code,owner_user_id,state,version) VALUES (?,?,?,1)").run(code, user.id, JSON.stringify(state));
    return { code, imported: state.players.length, unmatched, warnings: parsed.warnings };
  }).immediate();
}

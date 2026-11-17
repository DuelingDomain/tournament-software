import { randomBytes, randomInt } from "node:crypto";
import { applyCommand, createEvent, integrity, playerView, standings, suggestRounds, type Command, type CommandContext, type DeskView, type EventState, type Player, type StaffRole } from "@dd-tournament/engine";
import { parseLegacyPlayerList, parseLegacyTournament, type LegacyPlayer } from "@dd-tournament/engine/legacy";
import { isTemporaryMemberId, normalizeMemberId } from "@dd-tournament/engine";
import { lookupAccounts, searchAccounts } from "./bridge";
import { cacheUser, cachedUser, database, eventRecord, saveEvent, type EventRecord } from "./db";
import { HttpError } from "./http";
import { joinReason, requireCommand, requireImport, requireStaff } from "./permissions";
import type { TournamentUser } from "./validation";

export function context(user: TournamentUser): CommandContext {
  return { now: new Date().toISOString(), seed: randomInt(0, 2 ** 48 - 1), actor: String(user.id) };
}
export function deskView(event: EventRecord, role: StaffRole): DeskView {
  return { state: event.state, standings: standings(event.state), suggestedRounds: suggestRounds(event.state.players.length),
    version: event.version, integrity: integrity(event.state), viewerRole: role,
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
export function newEvent(user: TournamentUser, name: string, settings: Parameters<typeof createEvent>[0]) {
  return database().transaction(() => {
    cacheUser(user);
    let state = createEvent({ ...settings, name }, context(user));
    state = applyCommand(state, { type: "AddStaff", userId: user.id, name: user.displayName, role: "organizer" }, context(user));
    let code: string;
    do { code = randomBytes(5).toString("hex").toUpperCase(); } while (database().prepare("SELECT 1 FROM events WHERE code=?").get(code));
    database().prepare("INSERT INTO events(code,owner_user_id,state,version) VALUES (?,?,?,1)").run(code, user.id, JSON.stringify(state));
    return code;
  }).immediate();
}
export async function resolveCommand(command: Command): Promise<Command> {
  const ids = command.type === "AddPlayers" ? command.players.map(p => p.userId) : command.type === "AddStaff" || command.type === "LinkPlayerAccount" ? [command.userId] : [];
  if (!ids.length) return command;
  const { users, missing } = await lookupAccounts(ids);
  if (missing.length) throw new HttpError(422, "account_not_found");
  function account(id: number) {
    const user = users.find(user => user.id === id);
    if (!user) throw new HttpError(422, "account_not_found");
    return user;
  }
  if (command.type === "AddPlayers") return { ...command, players: command.players.map(p => {
    const user = account(p.userId); return { userId: user.id, name: user.displayName, memberId: user.memberId };
  }) };
  if (command.type === "AddStaff") return { ...command, name: account(command.userId).displayName };
  return command;
}
export function runCommand(code: string, user: TournamentUser, expectedVersion: number, command: Command) {
  return database().transaction(() => {
    const event = eventRecord(code);
    requireCommand(event, user.id, command);
    if (event.version !== expectedVersion) throw new HttpError(409, "version_conflict", { desk: deskView(event, requireStaff(event, user.id)) });
    return deskView(saveEvent(event, applyCommand(event.state, command, context(user))), requireStaff(event, user.id));
  }).immediate();
}
export function joinEvent(code: string, user: TournamentUser) {
  return database().transaction(() => {
    const event = eventRecord(code);
    if (event.state.players.some(p => p.userId === user.id)) return playerResponse(event, user);
    const reason = joinReason(event.state, user.memberId);
    if (reason) return playerResponse(event, user);
    const memberId = user.memberId === null ? null : normalizeMemberId(user.memberId);
    const imported = memberId && event.state.players.find(player => player.userId === null && player.memberId === memberId);
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
export async function importEvent(code: string, user: TournamentUser, kind: "tournament" | "players", xml: string) {
  const before = eventRecord(code);
  requireImport(before, user.id);
  if (kind === "players" && before.state.phase !== "registration") throw new HttpError(422, "REGISTRATION_ONLY");
  const parsed = kind === "tournament" ? parseLegacyTournament(xml, context(user)) : null;
  const players = parsed ? parsed.players : parseLegacyPlayerList(xml);
  const matches = await matchLegacyPlayers(players);
  return database().transaction(() => {
    const event = eventRecord(code);
    requireImport(event, user.id);
    if (event.version !== before.version) throw new HttpError(409, "version_conflict", { desk: deskView(event, requireStaff(event, user.id)) });
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
        state.players.push({ id: randomBytes(12).toString("hex"), userId: account?.id ?? null,
          name: [player.firstName, player.lastName].filter(Boolean).join(" ") || "Imported player", memberId: player.memberId,
          status: "active", droppedAfterRound: null, enteredRound: 1, fixedTable: null, checkedIn: false, notes: null });
        imported++; if (!account) unmatched++;
      }
    }
    return { desk: deskView(saveEvent(event, state), requireStaff(event, user.id)), imported, unmatched };
  }).immediate();
}

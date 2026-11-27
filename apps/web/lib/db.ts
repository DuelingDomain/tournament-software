import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { createEvent, normalizeMemberId, type EventState } from "@dd-tournament/engine";
import { tournamentUserSchema, type TournamentUser } from "./validation";
import { HttpError } from "./http";

let active: { path: string; db: Database.Database } | undefined;
export function database() {
  const path = resolve(process.env.DATABASE_PATH || "../../data/tournaments.sqlite");
  if (active?.path === path) return active.db;
  active?.db.close();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS known_accounts (
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (owner_user_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS account_grants (
      viewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (viewer_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS account_grants_expiry ON account_grants (expires_at);
    CREATE TABLE IF NOT EXISTS organizer_invites (
      owner_user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS events (code TEXT PRIMARY KEY, owner_user_id INTEGER NOT NULL REFERENCES users(id), state TEXT NOT NULL, version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS locations (id TEXT PRIMARY KEY, owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS global_players (owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, member_id TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL, PRIMARY KEY (owner_user_id, member_id));
    CREATE TABLE IF NOT EXISTS discord_settings (event_code TEXT PRIMARY KEY REFERENCES events(code) ON DELETE CASCADE, webhook_url TEXT, post_pairings INTEGER NOT NULL DEFAULT 0, post_standings INTEGER NOT NULL DEFAULT 0);`);
  db.transaction(() => {
    if (db.pragma("user_version", { simple: true }) === 0) {
      // Keep links backed by this owner's global list. Event links are still read from events.
      db.function("normalize_member_id", { deterministic: true }, (id: unknown) => typeof id === "string" ? normalizeMemberId(id) : null);
      db.exec(`DELETE FROM known_accounts WHERE NOT EXISTS (
        SELECT 1 FROM users JOIN global_players
          ON global_players.owner_user_id = known_accounts.owner_user_id
          AND global_players.member_id = normalize_member_id(json_extract(users.data, '$.memberId'))
        WHERE users.id = known_accounts.user_id
      ); PRAGMA user_version = 1`);
    }
  }).immediate();
  active = { path, db };
  return db;
}
export function cacheUser(user: TournamentUser) {
  database().prepare("INSERT INTO users(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(user.id, JSON.stringify(user));
}
export function cachedUser(id: number): TournamentUser | null {
  const row = database().prepare<[number], { data: string }>("SELECT data FROM users WHERE id=?").get(id);
  return row ? tournamentUserSchema.parse(JSON.parse(row.data)) : null;
}
const ACCOUNT_GRANT_MS = 15 * 60_000;
export function grantAccount(viewerId: number, user: TournamentUser) {
  const db = database();
  const now = Date.now();
  db.transaction(() => {
    cacheUser(user);
    db.prepare("DELETE FROM account_grants WHERE expires_at <= ?").run(now);
    db.prepare(`INSERT INTO account_grants (viewer_id, user_id, expires_at) VALUES (?, ?, ?)
      ON CONFLICT (viewer_id, user_id) DO UPDATE SET expires_at = excluded.expires_at`).run(viewerId, user.id, now + ACCOUNT_GRANT_MS);
  }).immediate();
}
export function grantedAccountIds(viewerId: number) {
  const rows = database().prepare<[number, number], { user_id: number }>(
    "SELECT user_id FROM account_grants WHERE viewer_id = ? AND expires_at > ?").all(viewerId, Date.now());
  return rows.map(row => row.user_id);
}
export function rememberAccounts(ownerId: number, userIds: readonly number[]) {
  if (!userIds.length) return;
  const db = database();
  const insert = db.prepare("INSERT INTO known_accounts (owner_user_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING");
  db.transaction(() => {
    for (const userId of userIds) insert.run(ownerId, userId);
  })();
}
export function knownAccounts(ownerId: number, limit = -1): TournamentUser[] {
  // Roster and staff entries also cover events saved before account searches were tracked.
  const rows = database().prepare<[{ ownerId: number; limit: number }], { data: string }>(`
    WITH known(id) AS (
      SELECT @ownerId
      UNION SELECT user_id FROM known_accounts WHERE owner_user_id = @ownerId
      UNION SELECT json_extract(player.value, '$.userId')
        FROM events, json_each(events.state, '$.players') AS player WHERE owner_user_id = @ownerId
      UNION SELECT json_extract(staff.value, '$.userId')
        FROM events, json_each(events.state, '$.staff') AS staff WHERE owner_user_id = @ownerId
    )
    SELECT users.data FROM known JOIN users ON users.id = known.id
    ORDER BY json_extract(users.data, '$.displayName') COLLATE NOCASE, users.id
    LIMIT @limit`).all({ ownerId, limit });
  return rows.map(row => tournamentUserSchema.parse(JSON.parse(row.data)));
}
export interface EventRecord { code: string; ownerUserId: number; state: EventState; version: number }
interface EventRow { code: string; owner_user_id: number; state: string; version: number }
function decode(row: EventRow): EventRecord {
  // Only the engine and legacy parser write this private document; schemaVersion gates storage upgrades.
  const parsed: unknown = JSON.parse(row.state);
  z.object({ schemaVersion: z.literal(1) }).parse(parsed);
  const state = parsed as EventState;
  state.teams ??= [];
  state.settings = { ...createEvent({ name: state.settings.name }, { now: state.createdAt, seed: 0, actor: "migration" }).settings, ...state.settings };
  return { code: row.code, ownerUserId: row.owner_user_id, state, version: row.version };
}
export function eventRecord(code: string): EventRecord {
  const row = database().prepare<[string], EventRow>("SELECT * FROM events WHERE code=?").get(code);
  if (!row) throw new HttpError(404, "not_found");
  return decode(row);
}
export function eventRecords() { return database().prepare<[], EventRow>("SELECT * FROM events ORDER BY rowid DESC").all().map(decode); }
export function eventAccountIds(state: EventState) {
  return new Set([...state.players.flatMap(p => p.userId === null ? [] : [p.userId]), ...state.staff.map(s => s.userId)]);
}
export function rememberEventAccounts(ownerId: number, state: EventState, previous?: EventState) {
  const existing = previous ? eventAccountIds(previous) : new Set<number>();
  rememberAccounts(ownerId, [...eventAccountIds(state)].filter(id => id !== ownerId && !existing.has(id)));
}
export function saveEvent(event: EventRecord, state: EventState) {
  rememberEventAccounts(event.ownerUserId, state, event.state);
  database().prepare("UPDATE events SET state=?, version=version+1 WHERE code=?").run(JSON.stringify(state), event.code);
  return { ...event, state, version: event.version + 1 };
}

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { createEvent, type EventState } from "@dd-tournament/engine";
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
    CREATE TABLE IF NOT EXISTS events (code TEXT PRIMARY KEY, owner_user_id INTEGER NOT NULL REFERENCES users(id), state TEXT NOT NULL, version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS locations (id TEXT PRIMARY KEY, owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS global_players (owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, member_id TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL, PRIMARY KEY (owner_user_id, member_id));
    CREATE TABLE IF NOT EXISTS discord_settings (event_code TEXT PRIMARY KEY REFERENCES events(code) ON DELETE CASCADE, webhook_url TEXT, post_pairings INTEGER NOT NULL DEFAULT 0, post_standings INTEGER NOT NULL DEFAULT 0);`);
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
export function saveEvent(event: EventRecord, state: EventState) {
  database().prepare("UPDATE events SET state=?, version=version+1 WHERE code=?").run(JSON.stringify(state), event.code);
  return { ...event, state, version: event.version + 1 };
}

import { CommandError, isTemporaryMemberId, normalizeMemberId, padMemberId } from "@dd-tournament/engine";
import { parseLegacyPlayerList, parseLegacyTournament, type LegacyPlayer } from "@dd-tournament/engine/legacy";
import { database } from "./db";
import { HttpError } from "./http";

export interface GlobalPlayer { memberId: string; firstName: string; lastName: string }

/** A real player ID: one to ten digits, not zero, and not in the temporary range. */
function realId(raw: string | null): string | null {
  const id = raw === null ? null : normalizeMemberId(raw);
  return id && id !== "0" && !isTemporaryMemberId(id) ? id : null;
}

export function globalPlayers(ownerId: number): GlobalPlayer[] {
  return database().prepare<[number], { memberId: string; firstName: string; lastName: string }>(
    "SELECT member_id AS memberId, first_name AS firstName, last_name AS lastName FROM global_players WHERE owner_user_id=?").all(ownerId)
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || Number(a.memberId) - Number(b.memberId));
}

/** Existing IDs are never changed, as in the original. */
export function mergeGlobalPlayers(ownerId: number, players: readonly { memberId: string | null; firstName: string; lastName: string }[]) {
  const insert = database().prepare("INSERT OR IGNORE INTO global_players(owner_user_id,member_id,first_name,last_name) VALUES (?,?,?,?)");
  let added = 0, skipped = 0, invalid = 0;
  for (const player of players) {
    const id = realId(player.memberId);
    if (!id || !(player.firstName.trim() || player.lastName.trim())) { invalid++; continue; }
    if (insert.run(ownerId, id, player.firstName.trim().slice(0, 100), player.lastName.trim().slice(0, 100)).changes) added++; else skipped++;
  }
  return { added, skipped, invalid };
}

/** Header "ID","First Name","Last Name"; ID padded to ten digits; quotes escaped with a backslash. */
export function globalPlayersCsv(list: readonly GlobalPlayer[]): string {
  const cell = (value: string) => `"${(/^[=+@\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '\\"')}"`;
  return ['"ID","First Name","Last Name"', ...list.map(p => [padMemberId(p.memberId), p.firstName, p.lastName].map(cell).join(","))].join("\r\n") + "\r\n";
}

function csvFields(line: string): string[] {
  const fields: string[] = [];
  let value = "", open = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === "\\" && line[i + 1] === '"' && open) { value += '"'; i++; }
    else if (c === '"' && open && line[i + 1] === '"') { value += '"'; i++; }
    else if (c === '"') { open = !open; }
    else if (c === "," && !open) { fields.push(value); value = ""; }
    else value += c;
  }
  fields.push(value);
  return fields;
}
/** The first line is skipped. Each other line needs exactly three fields and a whole-number ID that is not zero. */
export function parsePlayerCsv(text: string): { players: LegacyPlayer[]; invalid: number } {
  const players: LegacyPlayer[] = [];
  let invalid = 0;
  for (const line of text.replace(/^﻿/, "").split(/\r\n|\r|\n/).slice(1)) {
    if (!line.trim()) continue;
    const fields = csvFields(line);
    const id = fields.length === 3 && /^\s*\d+\s*$/.test(fields[0]!) ? normalizeMemberId(fields[0]!) : null;
    if (!id || id === "0") { invalid++; continue; }
    const text = (v: string) => v.trim().replace(/^'(?=[=+@])/, "");
    players.push({ memberId: id, firstName: text(fields[1]!), lastName: text(fields[2]!) });
  }
  return { players, invalid };
}

/** Player CSV, player-list XML, or a tournament file; the content decides. */
export function importGlobalPlayers(ownerId: number, text: string) {
  const body = text.replace(/^﻿/, "").trimStart();
  let players: readonly LegacyPlayer[], invalid = 0;
  if (body.startsWith("<")) {
    if (!/^(<\?xml[^>]*\?>\s*)?<(Tournament|PlayerList)[\s>]/.test(body)) throw new HttpError(422, "invalid_player_file");
    try {
      players = /^(<\?xml[^>]*\?>\s*)?<Tournament[\s>]/.test(body)
        ? parseLegacyTournament(body, { now: new Date().toISOString(), seed: 1, actor: "import" }).players : parseLegacyPlayerList(body);
    } catch (error) { if (error instanceof HttpError || error instanceof CommandError) throw error; throw new HttpError(422, "invalid_player_file"); }
  } else ({ players, invalid } = parsePlayerCsv(body));
  return database().transaction(() => {
    const merged = mergeGlobalPlayers(ownerId, players);
    return { ...merged, invalid: merged.invalid + invalid, total: globalPlayers(ownerId).length };
  }).immediate();
}

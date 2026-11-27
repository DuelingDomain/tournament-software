import { randomBytes } from "node:crypto";
import { cachedUser, database, rememberAccounts } from "./db";
import { HttpError } from "./http";

export const inviteTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function organizerInvite(ownerId: number, regenerate: boolean) {
  const db = database();
  const get = db.prepare<[number], { token: string }>("SELECT token FROM organizer_invites WHERE owner_user_id=?");
  const current = regenerate ? undefined : get.get(ownerId);
  if (current) return `/join/${current.token}`;

  return db.transaction(() => {
    const token = randomBytes(32).toString("base64url");
    if (regenerate) {
      db.prepare(`INSERT INTO organizer_invites (owner_user_id, token) VALUES (?, ?)
        ON CONFLICT(owner_user_id) DO UPDATE SET token=excluded.token`).run(ownerId, token);
    } else {
      db.prepare("INSERT INTO organizer_invites (owner_user_id, token) VALUES (?, ?) ON CONFLICT(owner_user_id) DO NOTHING").run(ownerId, token);
    }
    return `/join/${get.get(ownerId)!.token}`;
  }).immediate();
}

export function invitedOrganizer(token: string) {
  const invite = database().prepare<[string], { owner_user_id: number }>(
    "SELECT owner_user_id FROM organizer_invites WHERE token=?").get(token);
  return invite ? cachedUser(invite.owner_user_id) : null;
}

export function joinOrganizer(token: string, userId: number) {
  return database().transaction(() => {
    const organizer = invitedOrganizer(token);
    if (!organizer) throw new HttpError(404, "invite_not_found");
    if (userId !== organizer.id) rememberAccounts(organizer.id, [userId]);
    return organizer.displayName;
  }).immediate();
}

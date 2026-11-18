import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { normalizeMemberId, memberIdCheckDigitOk } from "@dd-tournament/engine";
import { appUrl, mockEnabled, secret } from "./config";
import { cacheUser, knownAccounts, rememberAccounts } from "./db";
import { HttpError } from "./http";
import { tournamentUserSchema, type TournamentUser } from "./validation";

export function validReturn(path: string) {
  return path.length <= 512 && path.startsWith("/") && !path.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(path);
}
const assertionSchema = z.strictObject({ v: z.literal(1), nonce: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  iat: z.number().int().nonnegative().safe(), exp: z.number().int().positive().safe(),
  return: z.string().refine(validReturn), user: tournamentUserSchema });
export function verifyAssertion(token: string) {
  if (token.length > 8192) throw new HttpError(401, "invalid_assertion");
  const match = /^([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/.exec(token);
  if (!match) throw new HttpError(401, "invalid_assertion");
  const payload = match[1]!;
  const expected = createHmac("sha256", secret("DD_BRIDGE_SECRET")).update(`dd-tournament-assertion.v1.${payload}`).digest();
  if (!timingSafeEqual(Buffer.from(match[2]!, "hex"), expected)) throw new HttpError(401, "invalid_assertion");
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
  catch { throw new HttpError(401, "invalid_assertion"); }
  const parsed = assertionSchema.safeParse(decoded);
  if (!parsed.success) throw new HttpError(401, "invalid_assertion");
  const value = parsed.data;
  const now = Math.floor(Date.now() / 1000);
  if (value.iat > now || value.exp !== value.iat + 60 || value.exp <= now) throw new HttpError(401, "expired_assertion");
  return value;
}
export function mockAssertion(user: TournamentUser, returnTo: string) {
  if (!mockEnabled()) throw new HttpError(404, "not_found");
  const iat = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, nonce: randomBytes(16).toString("base64url"), iat, exp: iat + 60, return: returnTo, user })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret("DD_BRIDGE_SECRET")).update(`dd-tournament-assertion.v1.${payload}`).digest("hex")}`;
}
export const fakeUsers: TournamentUser[] = [
  { id: 1, username: "mira-demo", displayName: "Mira Meadow", discordUserId: null, discordUsername: null, memberId: "101" },
  { id: 2, username: "oren-demo", displayName: "Oren Orbit", discordUserId: null, discordUsername: null, memberId: "202" },
  { id: 3, username: "lumi-demo", displayName: "Lumi Lantern", discordUserId: null, discordUsername: null, memberId: null },
  { id: 4, username: "pax-demo", displayName: "Pax Pebble", discordUserId: null, discordUsername: null, memberId: null },
  { id: 5, username: "tavi-demo", displayName: "Tavi Thistle", discordUserId: null, discordUsername: null, memberId: null },
  { id: 6, username: "nori-demo", displayName: "Nori Nimbus", discordUserId: null, discordUsername: null, memberId: null },
];
async function bridgeRequest(method: string, pathWithQuery: string, body?: object): Promise<unknown> {
  const rawBody = body === undefined ? "" : JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret("DD_BRIDGE_SECRET"))
    .update(`dd-tournament-api.v1\n${method}\n${pathWithQuery}\n${timestamp}\n`).update(rawBody).digest("hex");
  let response: Response;
  try {
    response = await fetch(new URL(pathWithQuery, appUrl()), { method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: { "x-bridge-signature": `t=${timestamp},v1=${signature}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: rawBody } : {}) });
  } catch { throw new HttpError(503, "bridge_unavailable"); }
  if (!response.ok) {
    if (response.status === 409) throw new HttpError(409, "member_id_taken");
    if (response.status === 404) throw new HttpError(404, "account_not_found");
    if (response.status === 400) throw new HttpError(400, "invalid_member_id");
    throw new HttpError(503, "bridge_unavailable");
  }
  try { return await response.json(); } catch { throw new HttpError(503, "bridge_unavailable"); }
}
function parseBridge<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new HttpError(503, "bridge_unavailable");
  return parsed.data;
}
export async function searchAccounts(query: string) {
  const users = mockEnabled() ? fakeUsers.filter(user => query.trim() && [user.username, user.displayName, user.discordUserId, user.discordUsername, user.memberId]
    .some(value => value?.toLowerCase().includes(query.trim().toLowerCase()))).slice(0, 20)
    : parseBridge(z.object({ users: z.array(tournamentUserSchema) }), await bridgeRequest("GET", `/api/tournament-bridge/users/search?${new URLSearchParams({ q: query })}`)).users;
  users.forEach(cacheUser);
  return users;
}
const KNOWN_ACCOUNT_LIMIT = 100;
export async function searchOrganizerAccounts(ownerId: number, query: string) {
  if (!query.trim()) {
    return mockEnabled()
      ? [...fakeUsers].sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id - b.id).slice(0, KNOWN_ACCOUNT_LIMIT)
      : knownAccounts(ownerId, KNOWN_ACCOUNT_LIMIT);
  }
  const users = await searchAccounts(query);
  rememberAccounts(ownerId, users);
  return users;
}
export async function lookupAccounts(ids: number[]) {
  const unique = [...new Set(ids)];
  const users: TournamentUser[] = [];
  const missing: number[] = [];
  for (let i = 0; i < unique.length; i += 500) {
    const batch = unique.slice(i, i + 500);
    const found = mockEnabled() ? { users: fakeUsers.filter(user => batch.includes(user.id)), missing: batch.filter(id => !fakeUsers.some(user => user.id === id)) }
      : parseBridge(z.object({ users: z.array(tournamentUserSchema), missing: z.array(z.number().int().positive()) }), await bridgeRequest("POST", "/api/tournament-bridge/users/lookup", { ids: batch }));
    users.push(...found.users); missing.push(...found.missing);
  }
  users.forEach(cacheUser);
  return { users, missing };
}
export async function setMemberId(userId: number, value: string | null) {
  const memberId = value === null ? null : normalizeMemberId(value);
  if (value !== null && memberId === null) throw new HttpError(400, "invalid_member_id");
  let updated: { memberId: string | null; checkDigitOk: boolean };
  if (mockEnabled()) {
    const user = fakeUsers.find(user => user.id === userId);
    if (!user) throw new HttpError(404, "account_not_found");
    if (memberId !== null && fakeUsers.some(user => user.id !== userId && user.memberId === memberId)) throw new HttpError(409, "member_id_taken");
    user.memberId = memberId;
    cacheUser(user);
    updated = { memberId, checkDigitOk: memberId !== null && memberIdCheckDigitOk(memberId) };
  } else {
    updated = parseBridge(z.strictObject({ memberId: z.string().nullable(), checkDigitOk: z.boolean() }),
      await bridgeRequest("PUT", `/api/tournament-bridge/users/${userId}/member-id`, { memberId }));
    await lookupAccounts([userId]);
  }
  return updated;
}

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { z } from "zod";
import type { Command, StaffRole } from "@dd-tournament/engine";
import { GET as apiGet, POST as apiPost, PUT as apiPut, DELETE as apiDelete } from "../app/api/[...path]/route";
import { GET as authGet, POST as authPost } from "../app/auth/[action]/route";
import { GET as healthGet } from "../app/api/health/route";
import { database } from "../lib/db";

const bridgeSecret = randomBytes(32).toString("hex");
const directory = resolve("../../.cache/route-tests", randomBytes(8).toString("hex"));
const originalEnv = { ...process.env };
const names = ["Mira Meadow", "Oren Orbit", "Lumi Lantern", "Pax Pebble", "Tavi Thistle", "Nori Nimbus"];
function user(id = 1) {
  return { id, username: `${["mira", "oren", "lumi", "pax", "tavi", "nori"][id - 1]}-demo`, displayName: names[id - 1],
    discordUserId: null, discordUsername: null, memberId: id === 1 ? "101" : id === 2 ? "202" : null };
}
function assertion(overrides: object = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ v: 1, nonce: randomBytes(16).toString("base64url"), iat: now, exp: now + 60,
    return: "/e/EXAMPLE/desk", user: user(), ...overrides })).toString("base64url");
  // Independent protocol peer: fixtures are not signed by production helpers.
  return `${payload}.${createHmac("sha256", bridgeSecret).update(`dd-tournament-assertion.v1.${payload}`).digest("hex")}`;
}
async function auth(action: string, token?: string, cookie?: string, method = "GET") {
  const request = new Request(`http://localhost:3000/auth/${action}${token ? `?assertion=${encodeURIComponent(token)}` : ""}`,
    { method, headers: cookie ? { cookie } : {} });
  return (method === "GET" ? authGet : authPost)(request, { params: Promise.resolve({ action }) });
}
async function login(id = 1) {
  const response = await auth("callback", assertion({ user: user(id), return: "/" }));
  expect(response.status).toBe(302);
  return response.headers.get("set-cookie")!.split(";")[0]!;
}
async function api(path: string, cookie?: string, method = "GET", data?: unknown) {
  const request = new Request(`http://localhost:3000/api/${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(data ? { "Content-Type": "application/json" } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}) });
  const context = { params: Promise.resolve({ path: new URL(request.url).pathname.slice(5).split("/") }) };
  return method === "GET" ? apiGet(request, context) : method === "PUT" ? apiPut(request, context) : method === "DELETE" ? apiDelete(request, context) : apiPost(request, context);
}
async function create(cookie: string, settings = {}) {
  const response = await api("events", cookie, "POST", { name: "Cloudberry Cup", createCode: "", settings });
  expect(response.status).toBe(201);
  return z.object({ code: z.string() }).parse(await response.json()).code;
}
const deskSchema = z.object({ version: z.number(), state: z.object({ players: z.array(z.object({ id: z.string(), userId: z.number().nullable(), name: z.string(), memberId: z.string().nullable(), status: z.string() })),
  staff: z.array(z.object({ id: z.string(), userId: z.number(), role: z.string() })), rounds: z.array(z.object({ matches: z.array(z.object({ id: z.string(), p1: z.string(), p2: z.string().nullable(), result: z.string().nullable() })) })) }) });
const dummyPlayersSchema = z.object({ desk: deskSchema, added: z.number() });
const dummyResultsSchema = z.object({ desk: deskSchema, entered: z.number() });
async function dummyPlayers(code: string, cookie: string, expectedVersion: number, count: number) {
  const response = await api(`events/${code}/dummy-data`, cookie, "POST", { action: "players", count, expectedVersion });
  expect(response.status).toBe(200);
  return dummyPlayersSchema.parse(await response.json());
}
async function desk(code: string, cookie: string) { return deskSchema.parse(await (await api(`events/${code}/desk`, cookie)).json()); }
async function command(code: string, cookie: string, expectedVersion: number, command: Command) {
  return api(`events/${code}/commands`, cookie, "POST", { expectedVersion, command });
}
async function upload(code: string, cookie: string, kind = "tournament", xml = readFileSync(new URL("./fixtures/synthetic.Tournament", import.meta.url), "utf8")) {
  const form = new FormData(); form.set("kind", kind); form.set("file", new File([xml], "synthetic.Tournament", { type: "application/xml" }));
  return apiPost(new Request(`http://localhost:3000/api/events/${code}/import`, { method: "POST", headers: { cookie }, body: form }),
    { params: Promise.resolve({ path: ["events", code, "import"] }) });
}
beforeAll(() => {
  mkdirSync(directory, { recursive: true });
  process.env.DATABASE_PATH = resolve(directory, "test.sqlite");
  process.env.PUBLIC_URL = "http://localhost:3000";
  process.env.DD_BRIDGE_SECRET = bridgeSecret;
  process.env.SESSION_SECRET = randomBytes(32).toString("hex");
});
beforeEach(() => {
  process.env.DD_APP_URL = "mock";
  process.env.CREATE_CODE = "";
  database().exec("DELETE FROM events; DELETE FROM sessions; DELETE FROM users; DELETE FROM nonces;");
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  database().close(); rmSync(directory, { recursive: true, force: true });
  for (const key of ["DATABASE_PATH", "PUBLIC_URL", "DD_APP_URL", "DD_BRIDGE_SECRET", "SESSION_SECRET", "CREATE_CODE"]) {
    if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  }
});

describe("authentication routes", () => {
  it("accepts a signed assertion, persists a private 30-day session, and signs out", async () => {
    const token = assertion();
    const response = await auth("callback", token);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/e/EXAMPLE/desk");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=Lax"); expect(cookie).toContain("Max-Age=2592000");
    const browserCookie = cookie.split(";")[0]!;
    expect(await (await api("me", browserCookie)).json()).toEqual({ user: user(), canCreate: true, createCodeRequired: false });
    const stored = database().prepare<[], { token_hash: string }>("SELECT token_hash FROM sessions").get()!;
    expect(browserCookie).not.toContain(stored.token_hash);
    const signedOut = await auth("sign-out", undefined, browserCookie, "POST");
    expect(signedOut.status).toBe(204); expect(signedOut.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await (await api("me", browserCookie)).json()).toEqual({ user: null, canCreate: false, createCodeRequired: false });
  });
  it.each([
    ["expired", () => { const now = Math.floor(Date.now() / 1000); return assertion({ iat: now - 61, exp: now - 1 }); }],
    ["future", () => { const now = Math.floor(Date.now() / 1000); return assertion({ iat: now + 60, exp: now + 120 }); }],
    ["extended lifetime", () => assertion({ exp: Math.floor(Date.now() / 1000) + 3600 })],
    ["tampered signature", () => assertion().replace(/.$/, c => c === "0" ? "1" : "0")],
    ["foreign return", () => assertion({ return: "//outside.example" })],
    ["backslash return", () => assertion({ return: "/\\outside.example" })],
    ["invalid identity", () => assertion({ user: { ...user(), id: -1 } })],
  ])("rejects %s assertions without establishing a session", async (_name, make) => {
    const response = await auth("callback", make());
    expect(response.status).toBe(401); expect(response.headers.get("set-cookie")).toBeNull();
    expect(database().prepare("SELECT * FROM sessions").all()).toEqual([]);
  });
  it("consumes each assertion nonce only once, including after logout", async () => {
    const token = assertion(); const first = await auth("callback", token);
    await auth("sign-out", undefined, first.headers.get("set-cookie")!.split(";")[0], "POST");
    const replay = await auth("callback", token);
    expect(replay.status).toBe(401); expect(await replay.json()).toEqual({ error: "replayed_assertion" });
  });
  it("offers a mock form and completes its fake-account login through the signed callback", async () => {
    const context = { params: Promise.resolve({ action: "mock" }) };
    const form = await authGet(new Request("http://localhost:3000/auth/mock?return=/e/ABC/me"), context);
    expect(form.status).toBe(200); expect(await form.text()).toContain("Fake accounts (development only)");
    const selected = await authPost(new Request("http://localhost:3000/auth/mock?return=/e/ABC/me", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "userId=2",
    }), context);
    expect(selected.status).toBe(302);
    const callback = new URL(selected.headers.get("location")!, "http://localhost:3000");
    const completed = await auth("callback", callback.searchParams.get("assertion")!);
    expect(completed.status).toBe(302); expect(completed.headers.get("location")).toBe("/e/ABC/me");
    expect(await (await api("me", completed.headers.get("set-cookie")!.split(";")[0])).json()).toMatchObject({ user: { id: 2 } });
  });
  it("routes to DD or the mock form with a relative return and rejects external returns", async () => {
    let response = await authGet(new Request("http://localhost:3000/auth/start?return=/e/ABC/desk"), { params: Promise.resolve({ action: "start" }) });
    expect(response.headers.get("location")).toBe("http://localhost:3000/auth/mock?return=%2Fe%2FABC%2Fdesk");
    process.env.DD_APP_URL = "https://accounts.example";
    response = await authGet(new Request("http://localhost:3000/auth/start?return=/e/ABC/desk"), { params: Promise.resolve({ action: "start" }) });
    expect(response.headers.get("location")).toBe("https://accounts.example/api/tournament-bridge/start?return=%2Fe%2FABC%2Fdesk");
    response = await authGet(new Request("http://localhost:3000/auth/start?return=//outside.example"), { params: Promise.resolve({ action: "start" }) });
    expect(response.status).toBe(400);
  });
});

describe("event HTTP contract", () => {
  it("requires a session and creation code, lists my events, and allows anonymous version polling", async () => {
    expect((await api("events", undefined, "POST", { name: "Private", createCode: "" })).status).toBe(401);
    const cookie = await login(); process.env.CREATE_CODE = randomBytes(16).toString("hex");
    expect((await api("events", cookie, "POST", { name: "Private", createCode: "wrong" })).status).toBe(403);
    const created = await api("events", cookie, "POST", { name: "Private", createCode: process.env.CREATE_CODE });
    const { code } = z.object({ code: z.string() }).parse(await created.json());
    const publicResponse = await api(`events/${code}`);
    expect(publicResponse.headers.get("cache-control")).toBe("no-store");
    const publicData = await publicResponse.json();
    expect(publicData).toMatchObject({ name: "Private", version: 1, phase: "registration" });
    expect(publicData).not.toHaveProperty("state");
    expect(await (await api(`events/${code}?since=1`)).json()).toEqual({ unchanged: true, version: 1 });
    expect(await (await api("events", cookie)).json()).toMatchObject({ events: [{ code, role: "organizer", joined: false }] });
    expect(await (await api("events", await login(2))).json()).toEqual({ events: [] });
    expect((await api(`events/${code}/desk`)).status).toBe(401);
    expect((await api(`events/${code}/desk`, await login(2))).status).toBe(403);
    expect((await healthGet()).status).toBe(200);
  });
  it("commits one competing command and returns current desk on stale versions without a second write", async () => {
    const cookie = await login(); const code = await create(cookie);
    const requests = ["First name", "Second name"].map(name => command(code, cookie, 1, { type: "UpdateSettings", settings: { name } }));
    const responses = await Promise.all(requests);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const conflict = await responses.find(r => r.status === 409)!.json();
    expect(conflict).toMatchObject({ error: "version_conflict", desk: { version: 2 } });
    expect((await desk(code, cookie)).version).toBe(2);
  });
  it("returns engine errors as 422 and rolls back the version", async () => {
    const cookie = await login(); const code = await create(cookie);
    const response = await command(code, cookie, 1, { type: "PairNextRound" });
    expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ error: "NO_PLAYERS", message: expect.any(String) });
    expect((await desk(code, cookie)).version).toBe(1);
  });
  it("accepts cut-and-pair as one version and persists neither change when too few players survive", async () => {
    const owner = await login(); const code = await create(owner);
    await dummyPlayers(code, owner, 1, 4);
    expect((await command(code, owner, 2, { type: "PairNextRound" })).status).toBe(200);
    expect((await api(`events/${code}/dummy-data`, owner, "POST", { action: "results", expectedVersion: 3 })).status).toBe(200);
    const before: unknown = await (await api(`events/${code}/desk`, owner)).json();
    const rejected = await command(code, owner, 4, { type: "SwissCut", mode: "top", value: 1, pairNext: true });
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toMatchObject({ error: "NOT_ENOUGH_PLAYERS" });
    expect(await (await api(`events/${code}/desk`, owner)).json()).toEqual(before);
    const paired = await command(code, owner, 4, { type: "SwissCut", mode: "top", value: 2, pairNext: true });
    expect(paired.status).toBe(200);
    expect(await paired.json()).toMatchObject({ version: 5, state: {
      phase: "swiss", swissCuts: [{ afterRound: 1, roundPairedAfter: true }], rounds: [{ number: 1 }, { number: 2 }],
    } });
    const saved = await desk(code, owner);
    expect(saved.version).toBe(5);
    expect(saved.state.players.filter(p => p.status === "cut")).toHaveLength(2);
    expect(saved.state.rounds[1]!.matches.flatMap(m => [m.p1, m.p2]).sort())
      .toEqual(saved.state.players.filter(p => p.status === "active").map(p => p.id).sort());
  });
  it("accepts an explicit current round for scored re-pairing and rejects it after advancement without saving", async () => {
    const owner = await login(); const code = await create(owner);
    await dummyPlayers(code, owner, 1, 4);
    expect((await command(code, owner, 2, { type: "PairNextRound" })).status).toBe(200);
    expect((await api(`events/${code}/dummy-data`, owner, "POST", { action: "results", expectedVersion: 3 })).status).toBe(200);
    const repaired = await command(code, owner, 4, { type: "RepairRound", round: 1 });
    expect(repaired.status).toBe(200);
    const current = deskSchema.parse(await repaired.json());
    expect(current.version).toBe(5);
    expect(current.state.rounds[0]!.matches.map(m => m.result)).toEqual([null, null]);
    expect((await api(`events/${code}/dummy-data`, owner, "POST", { action: "results", expectedVersion: 5 })).status).toBe(200);
    expect((await command(code, owner, 6, { type: "PairNextRound" })).status).toBe(200);
    const before: unknown = await (await api(`events/${code}/desk`, owner)).json();
    const rejected = await command(code, owner, 7, { type: "RepairRound", round: 1 });
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toMatchObject({ error: "CURRENT_ROUND_ONLY" });
    expect(await (await api(`events/${code}/desk`, owner)).json()).toEqual(before);
  });
  it("joins by account, confirms agreeing reports, restricts reports to the session's player, and drops", async () => {
    const owner = await login(); const other = await login(2); const outsider = await login(3); const code = await create(owner);
    expect(await (await api(`events/${code}/me`, other)).json()).toEqual({ joined: false, canJoin: true, memberId: "202" });
    expect((await api(`events/${code}/join`, owner, "POST", {})).status).toBe(200);
    expect((await api(`events/${code}/join`, other, "POST", {})).status).toBe(200);
    const before = await desk(code, owner);
    expect((await api(`events/${code}/join`, other, "POST", {})).status).toBe(200);
    expect((await desk(code, owner)).version).toBe(before.version);
    const paired = deskSchema.parse(await (await command(code, owner, before.version, { type: "PairNextRound" })).json());
    const matchId = paired.state.rounds[0]!.matches[0]!.id;
    expect((await api(`events/${code}/report`, outsider, "POST", { matchId, result: "p1" })).status).toBe(403);
    expect((await api(`events/${code}/report`, owner, "POST", { matchId, result: "p1" })).status).toBe(200);
    expect((await desk(code, owner)).state.rounds[0]!.matches[0]!.result).toBeNull();
    expect((await api(`events/${code}/report`, other, "POST", { matchId, result: "p1" })).status).toBe(200);
    expect((await desk(code, owner)).state.rounds[0]!.matches[0]!.result).toBe("p1");
    expect(await (await api(`events/${code}/drop`, other, "POST", {})).json()).toMatchObject({ joined: true, view: { me: { status: "dropped" }, history: [{ round: 1 }] } });
  });
  it.each([
    [{ registrationOpen: false }, "closed"],
    [{ requireMemberId: true }, "member_id_required"],
    [{ allowLateEntry: false }, "late_entry_closed"],
  ])("explains entry restrictions for %j", async (settings, reason) => {
    const owner = await login(); const code = await create(owner, settings); const entrant = await login(3);
    if (reason === "late_entry_closed") {
      await command(code, owner, 1, { type: "AddPlayers", players: [{ userId: 1, name: "Ignored" }, { userId: 2, name: "Ignored" }] });
      await command(code, owner, 2, { type: "PairNextRound" });
    }
    expect(await (await api(`events/${code}/me`, entrant)).json()).toMatchObject({ joined: false, canJoin: false, reason });
    expect(await (await api(`events/${code}/join`, entrant, "POST", {})).json()).toMatchObject({ joined: false, reason });
  });
  it("saves a supplied member ID to the account before joining and rejects IDs owned by another account", async () => {
    const owner = await login(); const entrant = await login(3); const code = await create(owner, { requireMemberId: true });
    const duplicate = await api(`events/${code}/join`, entrant, "POST", { memberId: "000-101" });
    expect(duplicate.status).toBe(409); expect(await duplicate.json()).toEqual({ error: "member_id_taken" });
    const joined = await api(`events/${code}/join`, entrant, "POST", { memberId: "000-404" });
    expect(joined.status).toBe(200); expect(await joined.json()).toMatchObject({ joined: true, view: { me: { name: "Lumi Lantern" } } });
    expect(await (await api("me", entrant)).json()).toMatchObject({ user: { memberId: "404" } });
    expect((await desk(code, owner)).state.players).toHaveLength(1);
    await api(`accounts/3/member-id?event=${code}`, owner, "PUT", { memberId: null });
  });
  it("rejects malformed commands and foreign-origin browser writes before state changes", async () => {
    const cookie = await login(); const code = await create(cookie);
    expect((await api(`events/${code}/commands`, cookie, "POST", { expectedVersion: 1, command: { type: "SetCheckedIn", playerId: "x", checkedIn: "yes" } })).status).toBe(400);
    const response = await apiPost(new Request(`http://localhost:3000/api/events/${code}/drop`, { method: "POST", headers: { cookie, origin: "https://outside.example" } }), { params: Promise.resolve({ path: ["events", code, "drop"] }) });
    expect(response.status).toBe(403); expect((await desk(code, cookie)).version).toBe(1);
  });
});

const roles: StaffRole[] = ["organizer", "head_judge", "judge", "scorekeeper", "staff"];
describe("dummy-data route", () => {
  it.each([...roles, "outsider"].flatMap(role => ["players", "results"].map(action => ({ role, action }))))("$role: $action", async ({ role, action }) => {
    const owner = await login(); const code = await create(owner);
    let version = 1;
    if (role !== "organizer" && role !== "outsider") {
      const staffRole = z.enum(["head_judge", "judge", "scorekeeper", "staff"]).parse(role);
      expect((await command(code, owner, version++, { type: "AddStaff", userId: 2, name: "Ignored", role: staffRole })).status).toBe(200);
    }
    await dummyPlayers(code, owner, version++, 2);
    if (action === "results") expect((await command(code, owner, version++, { type: "PairNextRound" })).status).toBe(200);
    const before = await desk(code, owner);
    const response = await api(`events/${code}/dummy-data`, role === "organizer" ? owner : await login(2), "POST",
      { action, expectedVersion: version, ...(action === "players" ? { count: 1 } : {}) });
    const allowed = role === "organizer" || role === "head_judge";
    expect(response.status).toBe(allowed ? 200 : 403);
    if (allowed) expect(await response.json()).toMatchObject({ desk: { version: version + 1, viewerRole: role }, [action === "players" ? "added" : "entered"]: 1 });
    else { expect(await response.json()).toEqual({ error: "forbidden_role" }); expect(await desk(code, owner)).toEqual(before); }
  });

  it.each(["players", "results"])("requires authentication for %s", async action => {
    const owner = await login(); const code = await create(owner);
    expect((await api(`events/${code}/dummy-data`, undefined, "POST", { action, count: 1, expectedVersion: 1 })).status).toBe(401);
    expect((await desk(code, owner)).version).toBe(1);
  });

  it("lets staff enroll a player without an account through AddPlayers", async () => {
    const owner = await login(); const staff = await login(2); const code = await create(owner);
    await command(code, owner, 1, { type: "AddStaff", userId: 2, name: "Ignored", role: "staff" });
    const response = await api(`events/${code}/commands`, staff, "POST", { expectedVersion: 2,
      command: { type: "AddPlayers", players: [{ userId: null, name: "Test Player 01", memberId: "9999000000" }] } });
    expect(response.status).toBe(200);
    expect(await desk(code, owner)).toMatchObject({ version: 3, state: { players: [{ userId: null, name: "Test Player 01", memberId: "9999000000" }] } });
  });

  it.each([
    { action: "players", count: 0, expectedVersion: 1 },
    { action: "players", count: -1, expectedVersion: 1 },
    { action: "players", count: 257, expectedVersion: 1 },
    { action: "players", count: 1.5, expectedVersion: 1 },
    { action: "players", count: "2", expectedVersion: 1 },
    { action: "players", expectedVersion: 1 },
    { action: "players", count: 1 },
    { action: "players", count: 1, expectedVersion: 0 },
    { action: "results", expectedVersion: 1.5 },
    { action: "results", expectedVersion: "1" },
    { action: "results", expectedVersion: 1, count: 1 },
    { action: "unknown", expectedVersion: 1 },
  ])("rejects invalid body %j without a write", async data => {
    const owner = await login(); const code = await create(owner);
    const response = await api(`events/${code}/dummy-data`, owner, "POST", data);
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "invalid_body" });
    expect((await desk(code, owner)).version).toBe(1);
  });

  it("accepts the count limits and continues sparse names with unique temporary IDs", async () => {
    const owner = await login(); const code = await create(owner, { registrationOpen: false, requireMemberId: true });
    const first = await dummyPlayers(code, owner, 1, 1);
    expect(first).toMatchObject({ added: 1, desk: { version: 2, state: { players: [{ name: "Test Player 01", userId: null, memberId: "9999000000" }] } } });
    await command(code, owner, 2, { type: "UpdatePlayer", playerId: first.desk.state.players[0]!.id, name: "Test Player 07" });
    const next = await dummyPlayers(code, owner, 3, 256);
    expect(next.added).toBe(256); expect(next.desk.version).toBe(4);
    const players = next.desk.state.players;
    expect(players).toHaveLength(257);
    expect(players.slice(1).map(p => p.name)).toEqual(Array.from({ length: 256 }, (_, i) => `Test Player ${String(i + 8).padStart(2, "0")}`));
    expect(players.every(p => p.userId === null && p.status === "active")).toBe(true);
    expect(players.map(p => p.memberId)).toEqual(Array.from({ length: 257 }, (_, i) => String(9999000000 + i)));
    expect(new Set(players.map(p => p.id)).size).toBe(257);
    expect(await desk(code, owner)).toEqual(next.desk);
    expect(await (await api(`events/${code}?since=3`)).json()).toMatchObject({ version: 4, playerCount: 257 });
  });

  it.each(["swiss", "playoff", "complete"])("refuses dummy players during %s", async phase => {
    const owner = await login(); const code = await create(owner, { format: phase === "playoff" ? "single_elim" : "swiss" });
    await dummyPlayers(code, owner, 1, 4);
    await command(code, owner, 2, { type: "PairNextRound" });
    if (phase === "complete") {
      await api(`events/${code}/dummy-data`, owner, "POST", { action: "results", expectedVersion: 3 });
      await command(code, owner, 4, { type: "CompleteEvent" });
    }
    const before = await desk(code, owner);
    const stale = await api(`events/${code}/dummy-data`, owner, "POST", { action: "players", count: 1, expectedVersion: before.version - 1 });
    expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ error: "version_conflict", desk: before });
    const response = await api(`events/${code}/dummy-data`, owner, "POST", { action: "players", count: 1, expectedVersion: before.version });
    expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ error: "REGISTRATION_ONLY" });
    expect(await desk(code, owner)).toEqual(before);
  });

  it.each(["players", "results"])("commits one competing %s request and returns the latest desk on conflict", async action => {
    const owner = await login(); const code = await create(owner);
    await dummyPlayers(code, owner, 1, 4);
    if (action === "results") await command(code, owner, 2, { type: "PairNextRound" });
    const before = await desk(code, owner);
    const data = { action, expectedVersion: before.version, ...(action === "players" ? { count: 3 } : {}) };
    const responses = await Promise.all([api(`events/${code}/dummy-data`, owner, "POST", data), api(`events/${code}/dummy-data`, owner, "POST", data)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    const after = await desk(code, owner);
    expect(after.version).toBe(before.version + 1);
    expect(after.state.players).toHaveLength(action === "players" ? 7 : 4);
    expect(await responses.find(r => r.status === 409)!.json()).toMatchObject({ error: "version_conflict", desk: after });
    expect(await (await api(`events/${code}?since=${before.version}`)).json()).toMatchObject({ version: after.version });
  });

  it("generates roughly 85% wins, 10% draws and 5% double losses with a fixed random seed", async () => {
    const owner = await login(); const code = await create(owner);
    await dummyPlayers(code, owner, 1, 256);
    await command(code, owner, 2, { type: "PairNextRound" });
    let seed = 20261116;
    vi.spyOn(Math, "random").mockImplementation(() => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; });
    const response = await api(`events/${code}/dummy-data`, owner, "POST", { action: "results", expectedVersion: 3 });
    expect(response.status).toBe(200);
    const generated = dummyResultsSchema.parse(await response.json());
    expect(generated.entered).toBe(128); expect(generated.desk.version).toBe(4);
    const results = generated.desk.state.rounds[0]!.matches.map(m => m.result);
    const wins = results.filter(r => r === "p1" || r === "p2").length;
    const draws = results.filter(r => r === "draw").length;
    const losses = results.filter(r => r === "double_loss").length;
    expect(wins).toBeGreaterThanOrEqual(95); expect(wins).toBeLessThanOrEqual(120);
    expect(draws).toBeGreaterThanOrEqual(5); expect(draws).toBeLessThanOrEqual(22);
    expect(losses).toBeGreaterThanOrEqual(1); expect(losses).toBeLessThanOrEqual(15);
    expect(wins + draws + losses).toBe(128);
    expect(results).toContain("p1"); expect(results).toContain("p2");
    expect(generated.desk.state.players.every(p => p.status === "active")).toBe(true);
    expect(await desk(code, owner)).toEqual(generated.desk);
  });

  it("fills only unreported current-round matches, preserving byes, prior rounds and player statuses", async () => {
    const owner = await login(); const code = await create(owner);
    await dummyPlayers(code, owner, 1, 7);
    await command(code, owner, 2, { type: "PairNextRound" });
    await api(`events/${code}/dummy-data`, owner, "POST", { action: "results", expectedVersion: 3 });
    const paired = deskSchema.parse(await (await command(code, owner, 4, { type: "PairNextRound" })).json());
    const current = paired.state.rounds[1]!.matches.filter(m => m.p2 !== null);
    await command(code, owner, 5, { type: "EnterResult", matchId: paired.state.rounds[0]!.matches[0]!.id, result: null });
    await command(code, owner, 6, { type: "EnterResult", matchId: current[0]!.id, result: "draw" });
    await command(code, owner, 7, { type: "ReportResult", playerId: current[1]!.p1, matchId: current[1]!.id, result: "p1" });
    await command(code, owner, 8, { type: "DropPlayer", playerId: current[2]!.p1 });
    const bye = paired.state.rounds[1]!.matches.find(m => m.p2 === null)!;
    await command(code, owner, 9, { type: "EnterResult", matchId: bye.id, result: null });
    const before = await desk(code, owner);
    const response = await api(`events/${code}/dummy-data`, owner, "POST", { action: "results", expectedVersion: 10 });
    expect(response.status).toBe(200);
    const generated = dummyResultsSchema.parse(await response.json());
    expect(generated.entered).toBe(2); expect(generated.desk.version).toBe(11);
    expect(generated.desk.state.rounds[0]).toEqual(before.state.rounds[0]);
    expect(generated.desk.state.rounds[1]!.matches.find(m => m.id === current[0]!.id)?.result).toBe("draw");
    expect(generated.desk.state.rounds[1]!.matches.find(m => m.p2 === null)).toEqual(before.state.rounds[1]!.matches.find(m => m.p2 === null));
    expect(generated.desk.state.players).toEqual(before.state.players);
    expect(generated.desk.state.rounds[1]!.matches.filter(m => m.p2 !== null).every(m => m.result !== null)).toBe(true);
    const repeated = await api(`events/${code}/dummy-data`, owner, "POST", { action: "results", expectedVersion: 11 });
    expect(await repeated.json()).toMatchObject({ entered: 0, desk: { version: 12, state: generated.desk.state } });
  });

  it("generates only wins in playoffs without dropping entrants or changing byes", async () => {
    const owner = await login(); const code = await create(owner, { format: "single_elim" });
    await dummyPlayers(code, owner, 1, 5);
    await command(code, owner, 2, { type: "PairNextRound" });
    const before = await desk(code, owner);
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const response = await api(`events/${code}/dummy-data`, owner, "POST", { action: "results", expectedVersion: 3 });
    expect(response.status).toBe(200);
    const generated = dummyResultsSchema.parse(await response.json());
    const matches = generated.desk.state.rounds[0]!.matches;
    expect(generated.entered).toBe(matches.filter(m => m.p2 !== null).length);
    expect(matches.filter(m => m.p2 !== null).every(m => m.result === "p1" || m.result === "p2")).toBe(true);
    expect(matches.filter(m => m.p2 === null)).toEqual(before.state.rounds[0]!.matches.filter(m => m.p2 === null));
    expect(generated.desk.state.players.every(p => p.status !== "dropped")).toBe(true);
  });

  it("refuses results without a round or after completion, and rolls back engine failures", async () => {
    const owner = await login(); const code = await create(owner);
    const missing = await api(`events/${code}/dummy-data`, owner, "POST", { action: "results", expectedVersion: 1 });
    expect(missing.status).toBe(422); expect(await missing.json()).toMatchObject({ error: "NO_ROUND" });
    await command(code, owner, 1, { type: "AddPlayers", players: [1, 2, 3, 4].map(userId => ({ userId, name: "Account" })) });
    const paired = deskSchema.parse(await (await command(code, owner, 2, { type: "PairNextRound" })).json());
    await command(code, owner, 3, { type: "SplitMatch", matchId: paired.state.rounds[0]!.matches[0]!.id });
    const before = await desk(code, owner);
    const invalid = await api(`events/${code}/dummy-data`, owner, "POST", { action: "results", expectedVersion: 4 });
    expect(invalid.status).toBe(422); expect(await invalid.json()).toMatchObject({ error: "unpaired_players" });
    expect(await desk(code, owner)).toEqual(before);
    await command(code, owner, 4, { type: "RepairRound" });
    await api(`events/${code}/dummy-data`, owner, "POST", { action: "results", expectedVersion: 5 });
    await command(code, owner, 6, { type: "CompleteEvent" });
    const complete = await api(`events/${code}/dummy-data`, owner, "POST", { action: "results", expectedVersion: 7 });
    expect(complete.status).toBe(422); expect(await complete.json()).toMatchObject({ error: "EVENT_COMPLETE" });
    expect((await desk(code, owner)).version).toBe(7);
  });

  it("never automatically links temporary entries during import or self-join, even on an exact member-ID match", async () => {
    const owner = await login(); const entrant = await login(3); const code = await create(owner);
    const generated = await dummyPlayers(code, owner, 1, 3);
    const memberId = generated.desk.state.players[0]!.memberId;
    try {
      expect((await api(`accounts/3/member-id?event=${code}`, owner, "PUT", { memberId })).status).toBe(200);
      const exported = await api(`events/${code}/export/tournament`, owner);
      const imported = await upload(code, owner, "tournament", await exported.text());
      expect(imported.status).toBe(200);
      const restored = z.object({ desk: deskSchema, imported: z.number(), unmatched: z.number() }).parse(await imported.json());
      expect(restored).toMatchObject({ imported: 3, unmatched: 3 });
      expect((await api(`events/${code}/join`, entrant, "POST", {})).status).toBe(200);
      const after = await desk(code, owner);
      expect(after.state.players).toHaveLength(4);
      expect(after.state.players.slice(0, 3)).toEqual(restored.desk.state.players);
      expect(after.state.players.slice(0, 3).every(p => p.userId === null)).toBe(true);
      expect(after.state.players[3]).toMatchObject({ userId: 3, name: "Lumi Lantern", memberId });
    } finally {
      await api(`accounts/3/member-id?event=${code}`, owner, "PUT", { memberId: null });
    }
  });
});

const permissionCases: { label: string; command: (playerId: string) => Command; allowed: StaffRole[] }[] = [
  { label: "rounds", command: () => ({ type: "PairNextRound" }), allowed: ["organizer", "head_judge", "scorekeeper"] },
  { label: "check-in", command: playerId => ({ type: "SetCheckedIn", playerId, checkedIn: true }), allowed: ["organizer", "head_judge", "scorekeeper", "staff"] },
  { label: "players", command: () => ({ type: "AddPlayers", players: [{ userId: 6, name: "Fake name" }] }), allowed: ["organizer", "head_judge", "scorekeeper", "staff"] },
  { label: "penalties", command: playerId => ({ type: "AddPenalty", playerId, infractionId: "slow_play" }), allowed: ["organizer", "head_judge", "judge"] },
  { label: "drops", command: playerId => ({ type: "DropPlayer", playerId }), allowed: ["organizer", "head_judge", "judge", "scorekeeper"] },
  { label: "staff", command: () => ({ type: "AddStaff", userId: 6, name: "Ignored", role: "staff" }), allowed: ["organizer", "head_judge"] },
  { label: "organizers", command: () => ({ type: "AddStaff", userId: 6, name: "Ignored", role: "organizer" }), allowed: ["organizer"] },
];
describe("role matrix at the command route", () => {
  it.each(roles.flatMap(role => permissionCases.map(test => ({ role, ...test }))))("$role: $label", async ({ role, command: make, allowed }) => {
    const owner = await login(); const code = await create(owner);
    let version = 1;
    for (const [index, staffRole] of roles.slice(1).entries()) {
      expect((await command(code, owner, version++, { type: "AddStaff", userId: index + 2, name: "Ignored", role: staffRole })).status).toBe(200);
    }
    const added = deskSchema.parse(await (await command(code, owner, version++, { type: "AddPlayers", players: [{ userId: 1, name: "Ignored" }, { userId: 2, name: "Ignored" }] })).json());
    const cookie = role === "organizer" ? owner : await login(roles.indexOf(role) + 1);
    const response = await command(code, cookie, version, make(added.state.players[0]!.id));
    expect(response.status).toBe(allowed.includes(role) ? 200 : 403);
    if (!allowed.includes(role)) { expect(await response.json()).toEqual({ error: "forbidden_role" }); expect((await desk(code, owner)).version).toBe(version); }
  });
  it("prevents a head judge from editing/removing organizers and restricts Discord writes", async () => {
    const owner = await login(); const head = await login(2); const code = await create(owner);
    await command(code, owner, 1, { type: "AddStaff", userId: 2, name: "Ignored", role: "head_judge" });
    const state = deskSchema.parse(await (await command(code, owner, 2, { type: "AddStaff", userId: 3, name: "Ignored", role: "organizer" })).json());
    const target = state.state.staff.find(s => s.userId === 3)!.id;
    for (const cmd of [{ type: "SetStaffRole", staffId: target, role: "staff" }, { type: "RemoveStaff", staffId: target }] satisfies Command[])
      expect((await command(code, head, 3, cmd)).status).toBe(403);
    const webhookUrl = "https://discord.com/api/webhooks/123/synthetic-token";
    expect((await api(`events/${code}/discord`, head, "PUT", { webhookUrl, postPairings: true, postStandings: false })).status).toBe(403);
    expect((await api(`events/${code}/discord`, owner, "PUT", { webhookUrl, postPairings: true, postStandings: false })).status).toBe(200);
    const config = await (await api(`events/${code}/discord`, head)).json();
    expect(config).toEqual({ configured: true, postPairings: true, postStandings: false });
    expect(JSON.stringify(await (await api(`events/${code}/desk`, owner)).json())).not.toContain(webhookUrl);
  });
});

describe("legacy files and service bridge", () => {
  it("round-trips a synthetic tournament through multipart import and XML export", async () => {
    const cookie = await login(); const code = await create(cookie);
    const imported = await upload(code, cookie);
    expect(imported.status).toBe(200);
    const initial = await imported.json();
    expect(initial).toMatchObject({ imported: 3, unmatched: 1, desk: { viewerRole: "organizer", version: 2 } });
    expect(initial.desk.state.players.map((p: { name: string; userId: number | null; status: string }) => [p.name, p.userId, p.status])).toEqual([
      ["Mira Meadow", 1, "active"], ["Oren Orbit", 2, "dropped"], ["Zella Zephyr", null, "active"],
    ]);
    const exported = await api(`events/${code}/export/tournament`, cookie);
    expect(exported.headers.get("content-disposition")).toContain(".Tournament");
    const restored = await upload(code, cookie, "tournament", await exported.text());
    const next = await restored.json();
    expect(next.desk.state.players).toEqual(initial.desk.state.players);
    expect(next.desk.state.rounds.map((r: { matches: unknown }) => r.matches)).toEqual(initial.desk.state.rounds.map((r: { matches: unknown }) => r.matches));
    expect(next.desk.standings).toEqual(initial.desk.standings);
    for (const kind of ["players-xml", "players.csv", "standings.csv", "matches.csv"]) {
      const response = await api(`events/${code}/export/${kind}`, cookie);
      expect(response.status).toBe(200); expect(response.headers.get("content-disposition")).toContain("attachment");
    }
    expect((await api(`events/${code}/export/tournament`)).status).toBe(401);
    expect((await api(`events/${code}/export/tournament`, await login(3))).status).toBe(403);
  });
  it("imports player lists only during registration and retains unmatched entries", async () => {
    const owner = await login(); const code = await create(owner);
    const xml = "<PlayerList><Player><ID>101</ID><FirstName>Mira</FirstName><LastName>Meadow</LastName></Player><Player><ID>303</ID><FirstName>Zella</FirstName><LastName>Zephyr</LastName></Player></PlayerList>";
    expect(await (await upload(code, owner, "players", xml)).json()).toMatchObject({ imported: 2, unmatched: 1 });
    await command(code, owner, 2, { type: "PairNextRound" });
    const response = await upload(code, owner, "players", xml);
    expect(response.status).toBe(422); expect((await desk(code, owner)).version).toBe(3);
  });
  it("signs exact service paths and bodies for search, lookup, profile update, and propagates member-ID conflicts", async () => {
    const received: string[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString("utf8");
      const header = String(request.headers["x-bridge-signature"]);
      const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(header);
      const expected = createHmac("sha256", bridgeSecret).update(`dd-tournament-api.v1\n${request.method}\n${request.url}\n${match?.[1]}\n${raw}`).digest("hex");
      if (!match || match[2] !== expected) { response.writeHead(401).end(); return; }
      received.push(`${request.method} ${request.url} ${raw}`);
      response.setHeader("Content-Type", "application/json");
      if (request.method === "PUT") {
        if (raw.includes("999")) { response.writeHead(409).end(JSON.stringify({ error: "member_id_taken" })); return; }
        response.end(JSON.stringify({ memberId: "101", checkDigitOk: false }));
      } else if (request.method === "POST") response.end(JSON.stringify({ users: [user()], missing: [] }));
      else response.end(JSON.stringify({ users: [user()] }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address(); if (!address || typeof address === "string") throw new Error("No listener");
      process.env.DD_APP_URL = `http://127.0.0.1:${address.port}`;
      const cookie = await login(); const code = await create(cookie);
      expect(await (await api(`accounts/search?event=${code}&q=Mira%20%26%20friends`, cookie)).json()).toMatchObject({ users: [{ userId: 1, username: "mira-demo" }] });
      expect((await command(code, cookie, 1, { type: "AddPlayers", players: [{ userId: 1, name: "Spoofed name" }] })).status).toBe(200);
      expect((await desk(code, cookie)).state.players[0]!.name).toBe("Mira Meadow");
      expect(await (await api(`accounts/1/member-id?event=${code}`, cookie, "PUT", { memberId: "000-101" })).json()).toEqual({ memberId: "101", checkDigitOk: false });
      const conflict = await api(`accounts/1/member-id?event=${code}`, cookie, "PUT", { memberId: "999" });
      expect(conflict.status).toBe(409); expect(await conflict.json()).toEqual({ error: "member_id_taken" });
      expect(received).toContain("GET /api/tournament-bridge/users/search?q=Mira+%26+friends ");
      expect(received).toContain('POST /api/tournament-bridge/users/lookup {"ids":[1]}');
      expect(received).toContain('PUT /api/tournament-bridge/users/1/member-id {"memberId":"101"}');
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});


describe("tournament configuration", () => {
  it("creates and edits full settings and staff, and protects organizer locations in use", async () => {
    const cookie = await login();
    const other = await login(2);
    const fields = { name: "Sample Hall", address1: "1 Example Way", address2: "Room 2", city: "Example City", state: "ST",
      postal: "00000", country: "Example", phone: "000-0000", website: "https://example.test" };
    const added = await api("locations", cookie, "POST", fields);
    expect(added.status).toBe(201);
    const location = await added.json() as { id: string };
    expect((await api(`locations/${location.id}`, other, "PUT", fields)).status).toBe(404);
    const created = await api("events", cookie, "POST", { name: "Team Cup", createCode: "", settings: {
      style: "traditional", format: "open_dueling", playerStructure: 3, locationId: location.id, startsAt: "2026-12-02T13:15:00Z" },
      staff: [{ userId: 2, name: "Sample Judge", position: "floor_judge_team_lead" }] });
    expect(created.status).toBe(201);
    const { code } = await created.json() as { code: string };
    const initial = await (await api(`events/${code}/desk`, cookie)).json() as { version: number; state: { settings: object; staff: object[] } };
    expect(initial.state.settings).toMatchObject({ location: fields.name, locationId: location.id, locationDetails: fields, style: "traditional", playerStructure: 3 });
    expect(initial.state.staff).toContainEqual(expect.objectContaining({ userId: 2, role: "judge", position: "floor_judge_team_lead" }));
    expect((await api(`locations/${location.id}`, cookie, "DELETE")).status).toBe(409);
    expect((await api(`locations/${location.id}`, cookie, "PUT", { ...fields, city: "Updated City" })).status).toBe(200);
    expect((await api("locations", cookie)).status).toBe(200);
    expect((await command(code, cookie, initial.version, { type: "UpdateSettings", settings: { locationId: null, name: "Updated Cup" } })).status).toBe(200);
    expect((await api(`locations/${location.id}`, cookie, "DELETE")).status).toBe(200);
    expect((await api(`events/${code}/commands`, other, "POST", { expectedVersion: initial.version + 1,
      command: { type: "SetStaffPosition", staffId: "missing", position: "organizer" } })).status).toBe(403);
  });
});

describe("team HTTP workflow", () => {
  it("enrolls teams, versions roster edits and lets members report their team match", async () => {
    const cookie = await login();
    const memberCookie = await login(2);
    const code = await create(cookie, { playerStructure: 2 });
    const people = await command(code, cookie, 1, { type: "AddPlayers", players: [1, 2, 3, 4].map(userId => ({ userId, name: "Account" })) });
    expect(people.status).toBe(200);
    const enrolled = deskSchema.parse(await people.json());
    const teamResponse = await command(code, cookie, 2, { type: "AddTeams", teams: [
      { name: "North", memberIds: enrolled.state.players.slice(0, 2).map(p => p.id) },
      { name: "South", memberIds: enrolled.state.players.slice(2).map(p => p.id) },
    ] });
    expect(teamResponse.status).toBe(200);
    expect((await command(code, cookie, 2, { type: "DropTeam", teamId: "9988000000" })).status).toBe(409);
    const paired = await command(code, cookie, 3, { type: "PairNextRound" });
    expect(paired.status).toBe(200);
    const view = await (await api(`events/${code}/me`, memberCookie)).json() as { view: { currentMatch: { id: string; tables: number[] }; me: { teamId: string } } };
    expect(view.view.me.teamId).toBe("9988000000");
    expect(view.view.currentMatch.tables).toEqual([1, 2]);
    expect((await api(`events/${code}/report`, memberCookie, "POST", { matchId: view.view.currentMatch.id, result: "p1" })).status).toBe(200);
    expect((await api(`events/${code}/drop`, memberCookie, "POST")).status).toBe(200);
    const dropped = await (await api(`events/${code}/desk`, cookie)).json() as { state: { teams: { id: string; status: string }[] } };
    expect(dropped.state.teams.find(t => t.id === "9988000000")?.status).toBe("dropped");
  });
});

describe("team file interchange", () => {
  it("expands CSV by member with tag cross-pairs and enrolls a team file roster into an individual event", async () => {
    const cookie = await login();
    const code = await create(cookie, { playerStructure: 2 });
    const people = deskSchema.parse(await (await command(code, cookie, 1, { type: "AddPlayers", players: [1, 2, 3, 4].map(userId => ({ userId, name: "Account" })) })).json());
    await command(code, cookie, 2, { type: "AddTeams", teams: [{ name: "Left", memberIds: people.state.players.slice(0, 2).map(p => p.id) }, { name: "Right", memberIds: people.state.players.slice(2).map(p => p.id) }] });
    await command(code, cookie, 3, { type: "PairNextRound" });
    const csv = await (await api(`events/${code}/export/matches.csv`, cookie)).text();
    const lines = csv.trim().split("\r\n").map(line => line.split(",").map(cell => cell.slice(1, -1)));
    expect(lines).toHaveLength(3);
    const pairs = lines.slice(1).map(row => [row[3], row[4]]);
    const p = people.state.players;
    expect(pairs.every(([a, b]) => (a === p[0].id && b === p[3].id) || (a === p[1].id && b === p[2].id) || (a === p[2].id && b === p[1].id) || (a === p[3].id && b === p[0].id))).toBe(true);
    expect((await (await api(`events/${code}/export/standings.csv`, cookie)).text()).trim().split("\r\n")).toHaveLength(5);
    const xmlResponse = await api(`events/${code}/export/tournament`, cookie);
    expect(xmlResponse.status).toBe(200);
    const xml = await xmlResponse.text();
    const target = await create(cookie);
    const imported = await upload(target, cookie, "team-players", xml);
    expect(imported.status).toBe(200);
    expect(await imported.json()).toMatchObject({ imported: 4, desk: { state: { settings: { playerStructure: 1 } } } });
  });
});

describe("staff operational data", () => {
  it("keeps command history and print data staff-only and leaves conflicts and errors out of history", async () => {
    const cookie = await login();
    const outsider = await login(2);
    const code = await create(cookie);
    const before = await api(`events/${code}/activity`, cookie);
    expect(before.status).toBe(200);
    const initial = await before.json() as { activity: unknown[] };
    const failed = await command(code, cookie, 1, { type: "CancelRound" });
    expect(failed.status).toBe(422);
    const added = await command(code, cookie, 1, { type: "AddPlayers", players: [{ userId: 1, name: "Account" }, { userId: 2, name: "Account" }] });
    expect(added.status).toBe(200);
    expect((await command(code, cookie, 1, { type: "PairNextRound" })).status).toBe(409);
    const activity = await (await api(`events/${code}/activity`, cookie)).json() as { activity: { action: string; actor: string }[] };
    expect(activity.activity).toHaveLength(initial.activity.length + 1);
    expect(activity.activity[0]).toMatchObject({ action: "AddPlayers", actor: "1" });
    expect((await api(`events/${code}/activity`, outsider)).status).toBe(403);
    expect((await api(`events/${code}/print-data`)).status).toBe(401);
    await command(code, cookie, 2, { type: "PairNextRound" });
    const prints = await (await api(`events/${code}/print-data`, cookie)).json() as { unreportedMatches: unknown[] };
    expect(prints.unreportedMatches).toHaveLength(1);
    expect(await (await api(`events/${code}`)).json()).not.toHaveProperty("activityLog");
  });
});

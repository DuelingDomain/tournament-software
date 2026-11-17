import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { z } from "zod";
import type { Command, StaffRole } from "@dd-tournament/engine";
import { GET as apiGet, POST as apiPost, PUT as apiPut } from "../app/api/[...path]/route";
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
  return method === "GET" ? apiGet(request, context) : method === "PUT" ? apiPut(request, context) : apiPost(request, context);
}
async function create(cookie: string, settings = {}) {
  const response = await api("events", cookie, "POST", { name: "Cloudberry Cup", createCode: "", settings });
  expect(response.status).toBe(201);
  return z.object({ code: z.string() }).parse(await response.json()).code;
}
const deskSchema = z.object({ version: z.number(), state: z.object({ players: z.array(z.object({ id: z.string(), userId: z.number().nullable(), name: z.string(), memberId: z.string().nullable(), status: z.string() })),
  staff: z.array(z.object({ id: z.string(), userId: z.number(), role: z.string() })), rounds: z.array(z.object({ matches: z.array(z.object({ id: z.string(), result: z.string().nullable() })) })) }) });
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
    expect(await (await api("me", browserCookie)).json()).toEqual({ user: user(), canCreate: true });
    const stored = database().prepare<[], { token_hash: string }>("SELECT token_hash FROM sessions").get()!;
    expect(browserCookie).not.toContain(stored.token_hash);
    const signedOut = await auth("sign-out", undefined, browserCookie, "POST");
    expect(signedOut.status).toBe(204); expect(signedOut.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await (await api("me", browserCookie)).json()).toEqual({ user: null, canCreate: false });
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

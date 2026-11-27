import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { headers } from "next/headers";
import { redirect as pageRedirect } from "next/navigation";
import { renderToStaticMarkup } from "react-dom/server";
import type { Command, StaffRole } from "@dd-tournament/engine";
import { GET as apiGet, POST as apiPost, PUT as apiPut, DELETE as apiDelete } from "../app/api/[...path]/route";
import { GET as authGet, POST as authPost } from "../app/auth/[action]/route";
import { GET as healthGet } from "../app/api/health/route";
import InvitePage from "../app/join/[token]/page";
import { cacheUser, database, grantAccount, rememberAccounts } from "../lib/db";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("Page not found"); }),
  redirect: vi.fn(() => { throw new Error("Page redirected"); }),
}));

const bridgeSecret = randomBytes(32).toString("hex");
const directory = resolve("../../.cache/route-tests", randomBytes(8).toString("hex"));
const originalEnv = { ...process.env };
const names = ["Mira Meadow", "Oren Orbit", "Lumi Lantern", "Pax Pebble", "Tavi Thistle", "Nori Nimbus"];
function user(id = 1) {
  return { id, username: `${["mira", "oren", "lumi", "pax", "tavi", "nori"][id - 1]}-demo`, displayName: names[id - 1]!,
    discordUserId: null, discordUsername: id === 6 ? "nori.nimbus" : null, memberId: id === 1 ? "101" : id === 2 ? "202" : null };
}
function seedKnownAccounts(...ids: number[]) {
  for (const id of ids) cacheUser(user(id));
  rememberAccounts(1, ids);
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
async function openFile(cookie: string, xml: string, createCode = "") {
  const form = new FormData(); form.set("file", new File([xml], "x.Tournament", { type: "application/xml" })); form.set("createCode", createCode);
  return apiPost(new Request("http://localhost:3000/api/events/import", { method: "POST", headers: { cookie }, body: form }),
    { params: Promise.resolve({ path: ["events", "import"] }) });
}
async function uploadPlayers(cookie: string, text: string) {
  const form = new FormData(); form.set("file", new File([text], "list.csv", { type: "text/csv" }));
  return apiPost(new Request("http://localhost:3000/api/players/import", { method: "POST", headers: { cookie }, body: form }),
    { params: Promise.resolve({ path: ["players", "import"] }) });
}
beforeAll(() => {
  mkdirSync(directory, { recursive: true });
  process.env.DATABASE_PATH = resolve(directory, "test.sqlite");
  process.env.PUBLIC_URL = "http://localhost:3000";
  process.env.DD_BRIDGE_SECRET = bridgeSecret;
  process.env.SESSION_SECRET = randomBytes(32).toString("hex");
  delete process.env.SPECIAL_MEMBER_IDS_PATH;
});
beforeEach(() => {
  process.env.DD_APP_URL = "mock";
  process.env.CREATE_CODE = "";
  delete process.env.ADMIN_USER_IDS;
  database().exec("DELETE FROM events; DELETE FROM sessions; DELETE FROM users; DELETE FROM nonces;");
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  database().close(); rmSync(directory, { recursive: true, force: true });
  for (const key of ["DATABASE_PATH", "PUBLIC_URL", "DD_APP_URL", "DD_BRIDGE_SECRET", "SESSION_SECRET", "CREATE_CODE", "SPECIAL_MEMBER_IDS_PATH", "ADMIN_USER_IDS"]) {
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
    const [first, second] = (await desk(code, owner)).state.rounds[0]!.matches;
    expect((await command(code, owner, 3, { type: "EnterResult", matchId: first!.id, result: "p1" })).status).toBe(200);
    expect((await command(code, owner, 4, { type: "EnterResult", matchId: second!.id, result: "p1" })).status).toBe(200);
    const before: unknown = await (await api(`events/${code}/desk`, owner)).json();
    const rejected = await command(code, owner, 5, { type: "SwissCut", mode: "top", value: 1, pairNext: true, tieOrder: [first!.p1] });
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toMatchObject({ error: "NOT_ENOUGH_PLAYERS" });
    expect(await (await api(`events/${code}/desk`, owner)).json()).toEqual(before);
    const paired = await command(code, owner, 5, { type: "SwissCut", mode: "top", value: 2, pairNext: true });
    expect(paired.status).toBe(200);
    expect(await paired.json()).toMatchObject({ version: 6, state: {
      phase: "swiss", swissCuts: [{ afterRound: 1, roundPairedAfter: true }], rounds: [{ number: 1 }, { number: 2 }],
    } });
    const saved = await desk(code, owner);
    expect(saved.version).toBe(6);
    expect(saved.state.players.filter(p => p.status === "cut")).toHaveLength(2);
    expect(saved.state.rounds[1]!.matches.flatMap(m => [m.p1, m.p2]).sort())
      .toEqual(saved.state.players.filter(p => p.status === "active").map(p => p.id).sort());
  });
  it("lets a scorekeeper correct an event member ID through the cut and after finalization", async () => {
    const owner = await login(); const scorekeeper = await login(5); const other = await login(6);
    seedKnownAccounts(2, 3, 4, 5);
    const code = await create(owner, { allowLateEntry: false });
    let version = 1;
    const send = async (input: Command) => {
      const response = await command(code, scorekeeper, version, input);
      expect(await response.clone().json()).toMatchObject({ version: version + 1 });
      expect(response.status).toBe(200);
      version++;
      return deskSchema.parse(await response.json()).state;
    };
    expect((await command(code, owner, version++, { type: "AddStaff", userId: 5, name: "Scorekeeper", role: "scorekeeper" })).status).toBe(200);
    const enrolled = await command(code, owner, version++, { type: "AddPlayers", players: [1, 2, 3, 4].map(userId => ({ userId, name: "Account" })) });
    expect(enrolled.status).toBe(200);
    const { state: { players } } = deskSchema.parse(await enrolled.json());
    const playerId = players[0]!.id;
    const editId = async (memberId: string) => {
      const { players } = await send({ type: "UpdatePlayer", playerId, memberId });
      expect(players.find(p => p.id === playerId)?.memberId).toBe(memberId);
    };
    await editId("1000000014");
    const swiss = await send({ type: "PairNextRound" });
    await editId("1000000026");
    for (const m of swiss.rounds[0]!.matches) await send({ type: "EnterResult", matchId: m.id, result: m.p1 === playerId ? "p2" : "p1" });
    const playoff = await send({ type: "CutToPlayoff", size: 2 });
    expect(playoff.players.find(p => p.id === playerId)?.status).toBe("cut");
    await editId("1000000038");
    for (const m of playoff.rounds[1]!.matches) await send({ type: "EnterResult", matchId: m.id, result: "p1" });
    const complete = await send({ type: "CompleteEvent" });
    expect((await command(code, other, version, { type: "UpdatePlayer", playerId, memberId: "1000000040" })).status).toBe(403);
    const mixed = await command(code, scorekeeper, version, { type: "UpdatePlayer", playerId, memberId: "1000000040", name: "Changed name" });
    expect(await mixed.json()).toMatchObject({ error: "EVENT_COMPLETE" });
    await editId("1000000040");
    expect((await desk(code, owner)).state.rounds).toEqual(complete.rounds);
    expect(await (await api(`events/${code}`)).json()).toMatchObject({ phase: "complete" });
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
      seedKnownAccounts(2);
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
      seedKnownAccounts(2);
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
    seedKnownAccounts(2);
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
    seedKnownAccounts(2, 3, 4);
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
    seedKnownAccounts(3);
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
    seedKnownAccounts(2, 3, 4, 5, 6);
    let version = 1;
    for (const [index, staffRole] of roles.slice(1).entries()) {
      expect((await command(code, owner, version++, { type: "AddStaff", userId: index + 2, name: "Ignored", role: staffRole })).status).toBe(200);
    }
    const added = deskSchema.parse(await (await command(code, owner, version++, { type: "AddPlayers", players: [{ userId: 1, name: "Ignored" }, { userId: 2, name: "Ignored" }] })).json());
    const viewerId = roles.indexOf(role) + 1;
    const cookie = role === "organizer" ? owner : await login(viewerId);
    if (role !== "organizer") grantAccount(viewerId, user(6));
    const response = await command(code, cookie, version, make(added.state.players[0]!.id));
    expect(response.status).toBe(allowed.includes(role) ? 200 : 403);
    if (!allowed.includes(role)) { expect(await response.json()).toEqual({ error: "forbidden_role" }); expect((await desk(code, owner)).version).toBe(version); }
  });
  it("prevents a head judge from editing/removing organizers and restricts Discord writes", async () => {
    const owner = await login(); const head = await login(2); const code = await create(owner);
    seedKnownAccounts(2, 3);
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

  it("matches a staff import against the event owner's cached accounts before searching the bridge", async () => {
    const owner = await login(); const scorekeeper = await login(2);
    const code = await create(owner);
    seedKnownAccounts(2);
    expect((await command(code, owner, 1, { type: "AddStaff", userId: 2, name: "Scorekeeper", role: "scorekeeper" })).status).toBe(200);
    cacheUser({ ...user(3), memberId: "0000000303" });
    cacheUser({ ...user(4), memberId: "404" });
    rememberAccounts(1, [3]);
    rememberAccounts(2, [4]);
    process.env.DD_APP_URL = "https://service.example.test";
    const bridge = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const query = new URL(input.toString()).searchParams.get("q");
      return Response.json({ users: query === "404" ? [{ ...user(4), memberId: "404" }] : [] });
    });
    const xml = "<PlayerList><Player><ID>303</ID></Player><Player><ID>404</ID></Player></PlayerList>";
    const result = await upload(code, scorekeeper, "players", xml);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ unmatched: 0, desk: { state: { players: [{ userId: 3 }, { userId: 4 }] } } });
    expect(bridge).toHaveBeenCalledTimes(1);
    expect(new URL(bridge.mock.calls[0]![0].toString()).searchParams.get("q")).toBe("404");
  });

  it("rejects invalid player lists before looking up any member IDs", async () => {
    const owner = await login(); const code = await create(owner, { requireMemberId: true });
    process.env.DD_APP_URL = "https://service.example.test";
    const bridge = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ users: [] }));
    const xml = "<PlayerList><Player><ID>404</ID></Player><Player><FirstName>No ID</FirstName></Player></PlayerList>";
    const result = await upload(code, owner, "players", xml);
    expect(result.status).toBe(422);
    expect(await result.json()).toMatchObject({ error: "member_id_required" });
    expect(bridge).not.toHaveBeenCalled();
  });
  it("signs exact service paths and bodies for search, lookup, profile update, and propagates member-ID conflicts", async () => {
    const received: string[] = [];
    process.env.DD_APP_URL = "https://service.example.test";
    process.env.ADMIN_USER_IDS = " 1 , 99 ";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      expect(url.origin).toBe(process.env.DD_APP_URL);
      const path = url.pathname + url.search;
      const raw = await request.text();
      const signature = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(request.headers.get("x-bridge-signature") ?? "");
      const expected = createHmac("sha256", bridgeSecret).update(`dd-tournament-api.v1\n${request.method}\n${path}\n${signature?.[1]}\n${raw}`).digest("hex");
      if (!signature || signature[2] !== expected) return new Response(null, { status: 401 });
      received.push(`${request.method} ${path} ${raw}`);
      if (request.method === "PUT") {
        if (raw.includes("999")) return Response.json({ error: "member_id_taken" }, { status: 409 });
        return Response.json({ memberId: "101", checkDigitOk: false });
      }
      return Response.json(request.method === "POST" ? { users: [user()], missing: [] } : { users: [user()] });
    });
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
  });

  it("rejects ungranted account IDs before any bridge call for event creation and roster edits", async () => {
    const owner = await login();
    const code = await create(owner);
    const added = await dummyPlayers(code, owner, 1, 1);
    const playerId = added.desk.state.players[0]!.id;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    process.env.DD_APP_URL = "https://service.example.test";
    const updateStaff = [{ userId: 1, name: "Mira Meadow", role: "organizer" }, { userId: 4, name: "Pax", role: "staff" }] as const;
    const commands: Command[] = [
      { type: "AddPlayers", players: [{ userId: 4, name: "Pax" }] },
      { type: "AddPlayers", players: [{ userId: 9999, name: "Missing" }] },
      { type: "AddStaff", ...updateStaff[1] },
      { type: "LinkPlayerAccount", userId: 4, playerId },
      { type: "UpdateSettings", settings: {}, staff: [...updateStaff] },
    ];
    for (const input of commands) {
      const response = await command(code, owner, 2, input);
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "account_not_found" });
    }
    const created = await api("events", owner, "POST", { name: "New event", createCode: "", staff: [updateStaff[1]] });
    expect(created.status).toBe(422);
    expect(await created.json()).toEqual({ error: "account_not_found" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts a fresh exact lookup only from its viewer and remembers the account on use", async () => {
    const owner = await login(); const scorekeeper = await login(2);
    seedKnownAccounts(2);
    const code = await create(owner);
    expect((await command(code, owner, 1, { type: "AddStaff", userId: 2, name: "Staff", role: "scorekeeper" })).status).toBe(200);
    const query = `accounts/search?event=${code}&q=pax-demo&exact=1`;
    const enroll = { type: "AddPlayers", players: [{ userId: 4, name: "Pax" }] } satisfies Command;
    const time = vi.spyOn(Date, "now").mockReturnValue(Date.now() - 15 * 60_000);
    expect(await (await api(query, scorekeeper)).json()).toMatchObject({ users: [{ userId: 4 }] });
    expect((await command(code, owner, 2, enroll)).status).toBe(422);
    time.mockRestore();
    expect((await command(code, scorekeeper, 2, enroll)).status).toBe(422);
    expect((await api(query, scorekeeper)).status).toBe(200);
    expect((await command(code, scorekeeper, 2, enroll)).status).toBe(200);
    expect(await (await api("accounts/search", owner)).json()).toMatchObject({ users: [{ userId: 1 }, { userId: 2 }, { userId: 4 }] });
  });

  it("accepts event staff from the viewer's exact search and allows an admin to resolve other IDs", async () => {
    const owner = await login();
    const createWithStaff = (userId: number) => api("events", owner, "POST", {
      name: "New event", createCode: "", staff: [{ userId, name: "Placeholder", role: "staff" }],
    });
    expect((await api("accounts/search?q=pax-demo&exact=1", owner)).status).toBe(200);
    const response = await createWithStaff(4);
    expect(response.status).toBe(201);
    const { code } = z.object({ code: z.string() }).parse(await response.json());
    expect((await desk(code, owner)).state.staff).toContainEqual(expect.objectContaining({ userId: 4 }));
    process.env.ADMIN_USER_IDS = "1";
    expect((await createWithStaff(5)).status).toBe(201);
    const missing = await createWithStaff(9999);
    expect(missing.status).toBe(422);
    expect(await missing.json()).toEqual({ error: "account_not_found" });
  });

  it("allows profile edits for event players and known accounts and denies exact-only accounts", async () => {
    const owner = await login(); const entrant = await login(3);
    const code = await create(owner);
    seedKnownAccounts(2);
    const edit = (id: number, memberId: string | null) => api(`accounts/${id}/member-id?event=${code}`, owner, "PUT", { memberId });
    expect((await api("accounts/search?q=pax-demo&exact=1", owner)).status).toBe(200);
    expect((await edit(4, null)).status).toBe(404);
    expect((await edit(2, "202")).status).toBe(200);
    expect((await api(`events/${code}/join`, entrant, "POST", {})).status).toBe(200);
    database().prepare("DELETE FROM known_accounts WHERE owner_user_id = 1 AND user_id = 3").run();
    expect((await edit(3, null)).status).toBe(200);
    process.env.ADMIN_USER_IDS = "1";
    expect((await edit(4, null)).status).toBe(200);
  });

  it("scopes staff commands and profile edits to event accounts and the staff viewer's exact grants", async () => {
    const owner = await login(); const scorekeeper = await login(2);
    const code = await create(owner);
    seedKnownAccounts(2, 4, 5);
    expect((await command(code, owner, 1, { type: "AddStaff", userId: 2, name: "Scorekeeper", role: "scorekeeper" })).status).toBe(200);
    const edit = (id: number) => api(`accounts/${id}/member-id?event=${code}`, scorekeeper, "PUT", { memberId: user(id).memberId });
    const enroll = () => command(code, scorekeeper, 2, { type: "AddPlayers", players: [{ userId: 4, name: "Player" }] });
    const search = `accounts/search?event=${code}&q=pax-demo&exact=1`;
    expect((await api(search, owner)).status).toBe(200);
    expect((await enroll()).status).toBe(422);
    expect((await edit(4)).status).toBe(404);
    expect((await edit(1)).status).toBe(200);
    expect((await edit(2)).status).toBe(200);
    expect((await api(search, scorekeeper)).status).toBe(200);
    expect((await edit(4)).status).toBe(200);
    expect((await enroll()).status).toBe(200);
    process.env.ADMIN_USER_IDS = "2";
    expect((await edit(5)).status).toBe(200);
  });

  it("limits exact lookups per viewer without charging local searches or admins", async () => {
    const cookie = await login(5); const other = await login(6);
    const exact = "accounts/search?q=mira-demo&exact=1";
    for (let i = 0; i < 29; i++) expect((await api(exact, cookie)).status).toBe(200);
    expect(await (await api("accounts/search?q=unknown-demo&exact=1", cookie)).json()).toEqual({ users: [] });
    const limited = await api(exact, cookie);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect((await api("accounts/search?q=mira-demo", cookie)).status).toBe(200);
    expect((await api(exact, other)).status).toBe(200);
    process.env.ADMIN_USER_IDS = "5";
    expect((await api(exact, cookie)).status).toBe(200);
  });

  it("allows at most 300 exact lookups in a rolling day per viewer", async () => {
    const now = Date.now() + 24 * 60 * 60_000;
    const time = vi.spyOn(Date, "now").mockReturnValue(now);
    const cookie = await login(5); const other = await login(6);
    const exact = "accounts/search?q=unknown-demo&exact=1";
    for (let minute = 0; minute < 10; minute++) {
      time.mockReturnValue(now + minute * 60_000);
      for (let i = 0; i < 30; i++) expect((await api(exact, cookie)).status).toBe(200);
      expect((await api(exact, cookie)).status).toBe(429);
    }
    time.mockReturnValue(now + 10 * 60_000);
    expect((await api(exact, cookie)).status).toBe(429);
    expect((await api(exact, other)).status).toBe(200);
    expect((await api("accounts/search?q=unknown-demo", cookie)).status).toBe(200);
    process.env.ADMIN_USER_IDS = "5";
    expect((await api(exact, cookie)).status).toBe(200);
    delete process.env.ADMIN_USER_IDS;
    time.mockReturnValue(now + 24 * 60 * 60_000);
    expect((await api(exact, cookie)).status).toBe(200);
  });

  it("shares the file-open limit between event imports and opening new events", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.now() - 60_000);
    const cookie = await login(6);
    const code = await create(cookie);
    for (let i = 0; i < 10; i++) expect((await upload(code, cookie, "players", "<PlayerList></PlayerList>")).status).toBe(200);
    expect((await upload(code, cookie, "players", "<PlayerList></PlayerList>")).status).toBe(429);
    const xml = readFileSync(new URL("./fixtures/synthetic.Tournament", import.meta.url), "utf8");
    expect((await openFile(cookie, xml)).status).toBe(429);
  });

  it("counts import lookups across both file routes with a budget separate from search", async () => {
    const time = vi.spyOn(Date, "now").mockReturnValue(Date.now() - 24 * 60 * 60_000);
    const cookie = await login(4);
    const code = await create(cookie);
    const tournament = (count: number) => "<Tournament><TournamentPlayers>" + Array.from({ length: count }, (_, i) =>
      `<TournPlayer><Player><ID>${1_000_000_000 + i}</ID><FirstName>Sample</FirstName></Player></TournPlayer>`).join("")
      + "</TournamentPlayers></Tournament>";
    const full = tournament(2000);
    const numbered = full.replace("<Tournament>", "<Tournament><ID>A12-345678</ID>");
    expect((await upload(code, cookie, "tournament", full)).status).toBe(200);
    expect((await openFile(cookie, numbered)).status).toBe(201);
    expect((await openFile(cookie, numbered)).status).toBe(409);
    cacheUser({ ...user(3), memberId: "1000000000" });
    rememberAccounts(4, [3]);
    const cached = await upload(code, cookie, "tournament", tournament(1));
    expect(cached.status).toBe(200);
    expect(await cached.json()).toMatchObject({ unmatched: 0, desk: { state: { players: [{ userId: 3 }] } } });
    const uncached = tournament(1).replace("1000000000", "1000000001");
    const limited = await upload(code, cookie, "tournament", uncached);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: "import_lookup_rate_limited", message: "Daily account-lookup limit reached. Try again tomorrow." });
    expect((await api("accounts/search?q=mira-demo&exact=1", cookie)).status).toBe(200);
    time.mockRestore();
    expect((await openFile(cookie, tournament(1))).status).toBe(201);
  });

  it("remembers accounts after enrollment or staff assignment and scopes staff search to the event", async () => {
    const owner = await login(); const staff = await login(2); const other = await login(3);
    const code = await create(owner);
    const path = `accounts/search?event=${code}&q=`;
    expect(await (await api(path, owner)).json()).toMatchObject({ users: [{ userId: 1 }] });
    expect(await (await api(`${path}pax`, owner)).json()).toEqual({ users: [] });
    expect(await (await api(`${path}PAX-demo&exact=1`, owner)).json()).toMatchObject({ users: [{ userId: 4 }] });
    expect(await (await api(`${path}%40Nori.Nimbus&exact=1`, owner)).json()).toMatchObject({ users: [{ userId: 6 }] });
    expect(await (await api(`${path}000-202&exact=1`, owner)).json()).toMatchObject({ users: [{ userId: 2 }] });
    expect(await (await api(`${path}pax-demo%40example.test&exact=1`, owner)).json()).toMatchObject({ users: [{ userId: 4 }] });
    expect(await (await api(path, owner)).json()).toMatchObject({ users: [{ userId: 1 }] });
    const previous = await create(owner);
    expect((await command(previous, owner, 1, { type: "AddPlayers", players: [{ userId: 4, name: "Player" }] })).status).toBe(200);
    expect((await command(previous, owner, 2, { type: "AddPlayers", players: [{ userId: null, name: "Unlinked player" }] })).status).toBe(200);
    const playerId = (await desk(previous, owner)).state.players.find(player => player.userId === null)!.id;
    expect((await command(previous, owner, 3, { type: "LinkPlayerAccount", userId: 6, playerId })).status).toBe(200);
    expect((await command(code, owner, 1, { type: "AddStaff", userId: 2, name: "Scorekeeper", role: "scorekeeper" })).status).toBe(200);
    database().prepare("DELETE FROM events WHERE code=?").run(previous);
    expect(await (await api(path, owner)).json()).toMatchObject({ users: [{ userId: 1 }, { userId: 6 }, { userId: 2 }, { userId: 4 }] });
    expect(await (await api(path, staff)).json()).toMatchObject({ users: [{ userId: 1 }, { userId: 2 }] });
    expect(await (await api(`${path}pEBb`, staff)).json()).toEqual({ users: [] });
    expect(await (await api(`${path}PAX-demo&exact=1`, staff)).json()).toMatchObject({ users: [{ userId: 4 }] });
    expect(await (await api(`${path}0202`, staff)).json()).toMatchObject({ users: [{ userId: 2 }] });
    expect((await api(path, other)).status).toBe(403);
    expect(await (await api("accounts/search", staff)).json()).toMatchObject({ users: [{ userId: 2 }] });
    expect((await api(`events/${code}/join`, other, "POST", {})).status).toBe(200);
    expect(await (await api(path, staff)).json()).toMatchObject({ users: [{ userId: 3 }, { userId: 1 }, { userId: 2 }] });
  });

  it("clears old search history on upgrade and keeps links from the owner's global list and events", async () => {
    const owner = await login(); await login(2); await login(3);
    const code = await create(owner);
    seedKnownAccounts(2, 3, 4);
    expect((await command(code, owner, 1, { type: "AddStaff", userId: 2, name: "Staff", role: "staff" })).status).toBe(200);
    cacheUser({ ...user(4), memberId: "0000000404" });
    cacheUser({ ...user(3), memberId: "303" });
    const insert = database().prepare("INSERT INTO global_players (owner_user_id, member_id, first_name, last_name) VALUES (?, ?, ?, ?)");
    insert.run(1, "404", "Pax", "Pebble");
    insert.run(2, "303", "Lumi", "Lantern");
    database().pragma("user_version = 0");
    const path = process.env.DATABASE_PATH!;
    try {
      process.env.DATABASE_PATH = resolve(directory, "migration-reopen.sqlite");
      database();
    } finally {
      process.env.DATABASE_PATH = path;
    }
    expect(await (await api("accounts/search", owner)).json()).toMatchObject({ users: [{ userId: 1 }, { userId: 2 }, { userId: 4 }] });
    expect(database().prepare("SELECT * FROM known_accounts").all()).toEqual([{ owner_user_id: 1, user_id: 4 }]);
  });

  it("sends only explicit identifier lookups to the bridge and scopes admin search to the viewer", async () => {
    const owner = await login(); const staff = await login(2); const code = await create(owner);
    seedKnownAccounts(2);
    expect((await command(code, owner, 1, { type: "AddStaff", userId: 2, name: "Staff", role: "staff" })).status).toBe(200);
    process.env.DD_APP_URL = "https://service.example.test";
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ users: [user(4)] }))
      .mockResolvedValueOnce(Response.json({ users: [{ ...user(4), username: "mira" }] }))
      .mockResolvedValueOnce(Response.json({ users: [user(3), user(4)] }));
    const path = `accounts/search?event=${code}&q=`;
    expect(await (await api(`${path}pax`, owner)).json()).toEqual({ users: [] });
    expect(await (await api(`${path}Pax%20Peb&exact=1`, owner)).json()).toEqual({ users: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
    const search = await (await api(`${path}pax%40example.test&exact=1`, owner)).json();
    expect(search.users).toEqual([{ userId: 4, username: "pax-demo", displayName: "Pax Pebble", discordUserId: null, discordUsername: null, memberId: null }]);
    expect(fetchSpy.mock.calls[0]?.[0]?.toString()).toBe("https://service.example.test/api/tournament-bridge/users/search?q=pax%40example.test&exact=1");
    expect(await (await api(`${path}mira&exact=1`, owner)).json()).toMatchObject({ users: [{ userId: 4 }, { userId: 1 }] });
    expect(await (await api(`${path}pax`, owner)).json()).toEqual({ users: [] });

    process.env.ADMIN_USER_IDS = " 2 ";
    expect(await (await api(`${path}search`, staff)).json()).toMatchObject({ users: [{ userId: 3 }, { userId: 4 }] });
    expect(fetchSpy.mock.calls[2]?.[0]?.toString()).toBe("https://service.example.test/api/tournament-bridge/users/search?q=search");
    expect(await (await api(`${path}pax`, owner)).json()).toEqual({ users: [] });
    process.env.ADMIN_USER_IDS = "1";
    expect(await (await api(`${path}pax`, staff)).json()).toEqual({ users: [] });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

describe("organizer invites", () => {
  it("asks for confirmation after sign-in and revokes the previous link on regeneration", async () => {
    const owner = await login(); const code = await create(owner);
    const outsider = await login(3);
    const endpoint = `players/invite?event=${code}`;
    expect((await api(endpoint)).status).toBe(401);
    expect((await api(endpoint, outsider)).status).toBe(403);
    const inviteSchema = z.object({ path: z.string().regex(/^\/join\/[A-Za-z0-9_-]{43}$/) });
    const { path } = inviteSchema.parse(await (await api(endpoint, owner)).json());
    expect(await (await api(endpoint, owner)).json()).toEqual({ path });
    const token = path.split("/").at(-1)!;
    vi.mocked(headers).mockResolvedValue(new Headers());
    await expect(InvitePage({ params: Promise.resolve({ token }) })).rejects.toThrow("Page redirected");
    expect(pageRedirect).toHaveBeenCalledWith(`/auth/start?return=${encodeURIComponent(path)}`);
    expect((await api("players/join", undefined, "POST", { token })).status).toBe(401);
    const mockResponse = await authPost(new Request(`http://localhost:3000/auth/mock?return=${encodeURIComponent(path)}`, {
      method: "POST", body: "userId=4",
    }), { params: Promise.resolve({ action: "mock" }) });
    const callback = new URL(mockResponse.headers.get("location")!, "http://localhost:3000");
    const completed = await auth("callback", callback.searchParams.get("assertion")!);
    expect(completed.headers.get("location")).toBe(path);
    const visitor = completed.headers.get("set-cookie")!.split(";")[0]!;
    vi.mocked(headers).mockResolvedValue(new Headers({ cookie: visitor }));
    const page = renderToStaticMarkup(await InvitePage({ params: Promise.resolve({ token }) }));
    expect(page).toContain("Join Mira Meadow&#x27;s player list?");
    expect(page).toMatch(/<button[^>]*>Join<\/button>/);
    expect(await (await api("accounts/search", owner)).json()).toMatchObject({ users: [{ userId: 1 }] });
    for (let i = 0; i < 2; i++) {
      expect(await (await api("players/join", visitor, "POST", { token })).json()).toEqual({ organizerName: "Mira Meadow" });
    }
    expect(await (await api("accounts/search", owner)).json()).toMatchObject({ users: [{ userId: 1 }, { userId: 4 }] });
    expect(await (await api("accounts/search", outsider)).json()).toMatchObject({ users: [{ userId: 3 }] });
    const replacement = inviteSchema.parse(await (await api(endpoint, owner, "PUT")).json());
    expect(replacement.path).not.toBe(path);
    await expect(InvitePage({ params: Promise.resolve({ token }) })).rejects.toThrow("Page not found");
    expect((await api("players/join", outsider, "POST", { token })).status).toBe(404);
    expect(await (await api("players/join", outsider, "POST", { token: replacement.path.split("/").at(-1)! })).json())
      .toEqual({ organizerName: "Mira Meadow" });
    expect(await (await api("accounts/search", owner)).json()).toMatchObject({ users: [{ userId: 3 }, { userId: 1 }, { userId: 4 }] });
  });
});


describe("tournament configuration", () => {
  it("exports the scheduled date and time in the event's IANA zone or UTC by default", async () => {
    const owner = await login(); const startsAt = "2026-07-12T04:15:00Z";
    const local = await create(owner, { startsAt, timeZone: "America/Los_Angeles" });
    const utc = await create(owner, { startsAt });
    const xml = async (code: string) => (await api(`events/${code}/export/tournament`, owner)).text();
    expect(await xml(local)).toMatch(/<Date>2026-07-11<\/Date>\s*<Time>21:15<\/Time>/);
    expect(await xml(utc)).toMatch(/<Date>2026-07-12<\/Date>\s*<Time>04:15<\/Time>/);
    for (const timeZone of ["Invalid/Zone", "+04:00"]) {
      expect((await api("events", owner, "POST", { name: "Invalid zone", createCode: "", settings: { timeZone } })).status).toBe(400);
    }
  });
  it("creates and edits full settings and staff, and protects organizer locations in use", async () => {
    const cookie = await login();
    const other = await login(2);
    const fields = { name: "Sample Hall", address1: "1 Example Way", address2: "Room 2", city: "Example City", state: "ST",
      postal: "00000", country: "Example", phone: "000-0000", website: "https://example.test" };
    const added = await api("locations", cookie, "POST", fields);
    expect(added.status).toBe(201);
    const location = await added.json() as { id: string };
    expect((await api(`locations/${location.id}`, other, "PUT", fields)).status).toBe(404);
    seedKnownAccounts(2);
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
    seedKnownAccounts(2, 3, 4);
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

describe("open tournament and global player list", () => {
  it("opens a saved file as a new event with nothing lost, offers the finalized file, and keeps the global list", async () => {
    const cookie = await login();
    const code = await create(cookie);
    const reals = ["1000000014", "1000000026", "1000000038", "1000000040"];
    await command(code, cookie, 1, { type: "AddPlayers", players: reals.map((memberId, i) => ({ userId: null, name: `Pilot ${"ABCD"[i]} Fieldstone`, memberId })) });
    await command(code, cookie, 2, { type: "PairNextRound" });
    let view = await desk(code, cookie);
    for (const m of view.state.rounds[0]!.matches) await command(code, cookie, view.version, { type: "EnterResult", matchId: m.id, result: "p1" }).then(async r => { view = deskSchema.parse(await r.json()); });
    const dropped = view.state.players[3]!.id;
    view = deskSchema.parse(await (await command(code, cookie, view.version, { type: "DropPlayer", playerId: dropped })).json());
    view = deskSchema.parse(await (await command(code, cookie, view.version, { type: "AddPenalty", playerId: view.state.players[0]!.id, infractionId: "slow_play", notes: "Warned" })).json());
    // Several built-in infractions share one legacy name; each must still come back as itself.
    view = deskSchema.parse(await (await command(code, cookie, view.version, { type: "AddPenalty", playerId: view.state.players[1]!.id, infractionId: "extra_look" })).json());
    expect((await api(`events/${code}/export/finalized`, cookie)).status).toBe(422);
    view = deskSchema.parse(await (await command(code, cookie, view.version, { type: "CompleteEvent" })).json());
    const finalized = await api(`events/${code}/export/finalized`, cookie);
    expect(finalized.status).toBe(200);
    expect(finalized.headers.get("content-disposition")).toMatch(/Cloudberry Cup \(ID X99-\d{6}\)\.Tournament/);
    const xml = await finalized.text();

    const other = await login(5);
    const opened = await openFile(other, xml);
    expect(opened.status).toBe(201);
    const { code: copy, imported } = z.object({ code: z.string(), imported: z.number() }).parse(await opened.json());
    expect(copy).not.toBe(code); expect(imported).toBe(4);
    const mine = await (await api(`events/${code}/desk`, cookie)).json() as { state: Record<string, unknown>; standings: unknown };
    const next = await (await api(`events/${copy}/desk`, other)).json() as { state: Record<string, unknown>; standings: unknown; viewerRole: string };
    expect(next.viewerRole).toBe("organizer");
    // Internal player IDs are new in the copy, so compare through the member ID.
    type Shape = { phase: string; players: { id: string; name: string; memberId: string; status: string; openDuelingPoints?: number; droppedAfterRound: number | null; enteredRound: number; checkedIn: boolean }[];
      rounds: { number: number; matches: { p1: string; p2: string | null; result: string | null; table: number | null }[] }[];
      penalties: { playerId: string; round: number | null; infractionId: string; penalty: string; notes: string | null }[] };
    const shape = (s: Shape) => {
      const id = (playerId: string | null) => s.players.find(p => p.id === playerId)?.memberId ?? null;
      return { phase: s.phase, players: s.players.map(({ id: _id, ...p }) => ({ ...p, openDuelingPoints: undefined })),
        rounds: s.rounds.map(r => [r.number, r.matches.map(m => [id(m.p1), id(m.p2), m.result, m.table])]),
        penalties: s.penalties.map(p => [id(p.playerId), p.round, p.infractionId, p.penalty, p.notes]) };
    };
    expect(shape(next.state as unknown as Shape)).toEqual(shape(mine.state as unknown as Shape));
    expect((next.state as unknown as Shape).penalties).toHaveLength(2);
    const board = (rows: unknown) => (rows as { playerId: string }[]).map(({ playerId: _id, ...row }) => row);
    expect(board(next.standings)).toEqual(board(mine.standings));

    // Files from a newer program version are refused.
    const newer = await openFile(other, xml.replace("<SoftwareVersion>3.0.0.0", "<SoftwareVersion>3.1.0.0"));
    expect(newer.status).toBe(422); expect(await newer.json()).toMatchObject({ error: "legacy_version_too_new" });

    // The event number is kept (letters upper-cased), shows in the file name, and a file already opened by its owner is refused.
    const numbered = xml.replace(/<ID>X99-\d{6}<\/ID>/, "<ID>a12-345678</ID>");
    const sixth = await login(6);
    const first = await openFile(sixth, numbered);
    expect(first.status).toBe(201);
    const firstCode = z.object({ code: z.string() }).parse(await first.json()).code;
    const resaved = await api(`events/${firstCode}/export/finalized`, sixth);
    expect(resaved.headers.get("content-disposition")).toContain("(ID A12-345678).Tournament");
    expect(await resaved.text()).toContain("<ID>A12-345678</ID>");
    const again = await openFile(sixth, numbered);
    expect(again.status).toBe(409); expect(await again.json()).toMatchObject({ error: "already_open", code: firstCode });
    expect((await openFile(await login(4), numbered)).status).toBe(201);
    // A copy of an event I made myself is also refused: its number is the same.
    const own = await openFile(cookie, xml);
    expect(own.status).toBe(409); expect(await own.json()).toMatchObject({ error: "already_open", code });
    expect((await openFile(await login(6), "<PlayerList/>")).status).toBe(422);

    // Opening added the real player IDs to the caller's global list; the CSV round-trips and never changes a listed ID.
    const exported = await api("players/export", other);
    expect(exported.headers.get("content-disposition")).toContain("AllPlayers.csv");
    const csv = await exported.text();
    expect(csv.split("\r\n")[0]).toBe('"ID","First Name","Last Name"');
    expect(csv.split("\r\n")).toHaveLength(6);
    const third = await login(3);
    expect(((await (await api("players", third)).json()) as { players: unknown[] }).players).toEqual([]);
    expect(await (await uploadPlayers(third, csv)).json()).toMatchObject({ added: 4, skipped: 0, invalid: 0, total: 4 });
    expect(await (await uploadPlayers(third, `${csv}"0000000000","No","Id"\r\n"1000000014","Other","Name"\r\nbad line\r\n`)).json()).toMatchObject({ added: 0, skipped: 5, invalid: 2, total: 4 });
    expect((await api("players", third)).status).toBe(200);
    expect(await (await api("players", third)).json()).toMatchObject({ players: expect.arrayContaining([{ memberId: "1000000014", firstName: "Pilot A", lastName: "Fieldstone" }]) });
  });
  it("keeps a global list safe from hostile files and reports invalid IDs apart", async () => {
    const cookie = await login(2);
    // Quotes in names cannot break out of a cell, and no cell can start like a formula.
    const hostile = `"ID","First Name","Last Name"\r\n"1000000014","x\\",\\"=cmd|' /C calc'!A0","-2+3"\r\n"1000000026","+1","@SUM(1)"\r\n"1000000038","=1+1","Tab\tName"\r\n"1000000040","Ok","Name"\r\n"1000000050","Bad","Digit"\r\n`;
    const result = await (await uploadPlayers(cookie, hostile)).json() as { added: number; badCheckDigit: { count: number; csv: string | null } };
    expect(result.added).toBe(4);
    expect(result.badCheckDigit.count).toBe(1);
    expect(result.badCheckDigit.csv).toContain("1000000050");
    const rows = (await (await api("players/export", cookie)).text()).split("\r\n").filter(Boolean).slice(1);
    expect(rows).toHaveLength(4);
    // An RFC 4180 reader: only "" escapes a quote; every row must give exactly three cells.
    const rfc = (line: string) => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m => m[1]!.replaceAll('""', '"'));
    for (const row of rows) {
      const cells = rfc(row);
      expect(cells).toHaveLength(3);
      for (const cell of cells) expect(cell).not.toMatch(/^[=+\-@\t\r]/);
    }
    // Broken or hostile XML is a 422, not a server error.
    expect((await openFile(cookie, `<Tournament>${"<a>".repeat(5000)}${"</a>".repeat(5000)}</Tournament>`)).status).toBe(422);
    expect((await openFile(cookie, "<Tournament><__proto__>x</__proto__></Tournament>")).status).toBe(422);
  });
  it("keeps teams, members and a team match through Open Tournament", async () => {
    const cookie = await login();
    seedKnownAccounts(2, 3, 4);
    const code = await create(cookie, { playerStructure: 2 });
    const people = deskSchema.parse(await (await command(code, cookie, 1, { type: "AddPlayers", players: [1, 2, 3, 4].map(userId => ({ userId, name: "Account" })) })).json());
    await command(code, cookie, 2, { type: "AddTeams", teams: [{ name: "Left", memberIds: people.state.players.slice(0, 2).map(p => p.id) }, { name: "Right", memberIds: people.state.players.slice(2).map(p => p.id) }] });
    await command(code, cookie, 3, { type: "PairNextRound" });
    const xml = await (await api(`events/${code}/export/tournament`, cookie)).text();
    const copyCookie = await login(5);
    const copy = z.object({ code: z.string() }).parse(await (await openFile(copyCookie, xml)).json()).code;
    const mine = await (await api(`events/${code}/desk`, cookie)).json() as { state: { teams: { name: string; memberIds: string[]; status: string }[]; settings: { playerStructure: number }; rounds: unknown[] } };
    const next = await (await api(`events/${copy}/desk`, copyCookie)).json() as typeof mine;
    expect(next.state.settings.playerStructure).toBe(2);
    expect(next.state.teams.map(t => [t.name, t.memberIds.length, t.status])).toEqual(mine.state.teams.map(t => [t.name, t.memberIds.length, t.status]));
    expect(next.state.rounds).toHaveLength(1);
  });
});

describe("team file interchange", () => {
  it("expands CSV by member with tag cross-pairs and enrolls a team file roster into an individual event", async () => {
    const cookie = await login();
    seedKnownAccounts(2, 3, 4);
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
    seedKnownAccounts(2);
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

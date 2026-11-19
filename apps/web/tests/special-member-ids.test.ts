import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { expect, it, vi } from "vitest";
import { handleApi } from "../lib/api";
import { handleAuth } from "../lib/auth";
import { fakeUsers, mockAssertion } from "../lib/bridge";
import { database } from "../lib/db";

it("accepts listed member IDs across imports and staff validation", async () => {
  const cache = resolve("../../.cache");
  mkdirSync(cache, { recursive: true });
  const directory = mkdtempSync(resolve(cache, "special-member-ids-"));
  const path = resolve(directory, "ids.bin.gz");
  const listed = "2468135790";
  const unlisted = "2468135791";
  const fixture = Buffer.alloc(16);
  fixture.writeBigInt64LE(9876543210n, 0);
  fixture.writeBigInt64LE(BigInt(listed), 8);
  writeFileSync(path, gzipSync(fixture));
  vi.stubEnv("SPECIAL_MEMBER_IDS_PATH", path);
  vi.stubEnv("DATABASE_PATH", resolve(directory, "test.sqlite"));
  vi.stubEnv("DD_APP_URL", "mock");
  vi.stubEnv("DD_BRIDGE_SECRET", "test-bridge-secret-for-member-ids");
  vi.stubEnv("SESSION_SECRET", "test-session-secret-for-member-ids");
  vi.stubEnv("CREATE_CODE", "");

  try {
    const origin = "http://localhost:3000";
    const token = mockAssertion(fakeUsers[0]!, "/");
    const login = await handleAuth(new Request(`${origin}/auth/callback?assertion=${token}`), "callback");
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const api = (path: string, body?: object, method = "POST") => {
      const url = new URL(`/api/${path}`, origin);
      const headers = { cookie, ...(body instanceof FormData || !body ? {} : { "Content-Type": "application/json" }) };
      return handleApi(new Request(url, { method, headers, body: body instanceof FormData ? body : body && JSON.stringify(body) }), url.pathname.slice(5).split("/"));
    };
    const csv = new FormData();
    csv.set("file", new File([`ID,First Name,Last Name\n${listed},Avery,Example\n${unlisted},Harper,Example\n`], "players.csv"));
    expect(await (await api("players/import", csv)).json()).toMatchObject({ added: 1, badCheckDigit: { count: 1, csv: expect.stringContaining(unlisted) } });
    rmSync(path);

    const { code } = await (await api("events", { name: "Example event", createCode: "" })).json();
    const xml = new FormData();
    xml.set("kind", "players");
    xml.set("file", new File([`<PlayerList><Player><ID>${listed}</ID><FirstName>Avery</FirstName><LastName>Example</LastName></Player><Player><ID>${unlisted}</ID><FirstName>Harper</FirstName><LastName>Example</LastName></Player></PlayerList>`], "players.xml"));
    expect(await (await api(`events/${code}/import`, xml)).json()).toMatchObject({ imported: 2,
      desk: { integrity: { memberIdWarnings: [{ memberId: unlisted, problem: "check_digit" }] } } });
    const savedEvent = await (await api(`events/${code}/export/tournament`, undefined, "GET")).text();
    const tournament = new FormData();
    tournament.set("file", new File([savedEvent.replace(/<ID>X99-\d{6}<\/ID>/, "<ID>X99-000000</ID>")], "event.Tournament"));
    const opened = await (await api("events/import", tournament)).json() as { warnings: string[] };
    expect(opened.warnings.filter(warning => warning.includes("check_digit"))).toEqual([expect.stringContaining(unlisted)]);
    expect(await (await api(`events/${code}/member-id-check`, { memberIds: [listed, unlisted, "2468135798"] })).json()).toEqual({ invalidMemberIds: [unlisted] });
    const memberEndpoint = `accounts/1/member-id?event=${code}`;
    expect(await (await api(memberEndpoint, { memberId: listed }, "PUT")).json()).toEqual({ memberId: listed, checkDigitOk: true });

    vi.stubEnv("DD_APP_URL", "https://bridge.example");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ memberId: listed, checkDigitOk: false }))
      .mockResolvedValueOnce(Response.json({ users: [{ ...fakeUsers[0], memberId: listed }], missing: [] }));
    expect(await (await api(memberEndpoint, { memberId: listed }, "PUT")).json()).toEqual({ memberId: listed, checkDigitOk: true });
  } finally {
    database().close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  }
});

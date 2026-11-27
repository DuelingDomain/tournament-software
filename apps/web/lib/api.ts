import { timingSafeEqual, createHash } from "node:crypto";
import { competitors, publicView, printData, suggestRounds } from "@dd-tournament/engine";
import { z } from "zod";
import { currentUser, signedIn } from "./auth";
import { lookupAccounts, searchOrganizerAccounts, setMemberId } from "./bridge";
import { isAdminUser } from "./config";
import { cachedUser, database, eventRecord, eventRecords } from "./db";
import { MEMBER_ID_CHECK_BATCH_SIZE } from "./desk-view";
import { deskView, importEvent, joinEvent, newEvent, openTournamentAsNewEvent, playerCommand, playerResponse, resolveCommand, runCommand, runDummyData } from "./events";
import { csvDownload, exportEvent } from "./exports";
import { globalPlayers, globalPlayersCsv, importGlobalPlayers } from "./global-players";
import { boundary, bodyJson, checkOrigin, HttpError, json, readBody } from "./http";
import { inviteTokenPattern, joinOrganizer, organizerInvite } from "./organizer-invites";
import { requireCommand, requireDummyData, requireImport, requireStaff, viewerRole } from "./permissions";
import { memberIdAccepted } from "./special-member-ids";
import { commandSchema, dummyDataSchema, partialSettings, result, userId, staffSchema, locationFields } from "./validation";

import { locations, createLocation, changeLocation } from "./locations";

function requireCreateCode(value: unknown) {
  const configured = process.env.CREATE_CODE ?? "";
  const digest = (text: string) => createHash("sha256").update(text).digest();
  if (configured && !timingSafeEqual(digest(configured), digest(typeof value === "string" ? value : ""))) throw new HttpError(403, "invalid_create_code");
}
/** A small in-memory limit per account on file opens, which cost account lookups. */
const openTimes = new Map<number, number[]>();
function limitOpens(userId: number) {
  const now = Date.now();
  const recent = (openTimes.get(userId) ?? []).filter(time => now - time < 60_000);
  if (recent.length >= 10) throw new HttpError(429, "rate_limited");
  openTimes.set(userId, [...recent, now]);
  if (openTimes.size > 1000) for (const [id, times] of openTimes) if (times.every(time => now - time >= 60_000)) openTimes.delete(id);
}
/** Per-account budget of member IDs checked per minute, so the private ID list cannot be probed in bulk.
 *  20,000 covers a full global player list; random probing of the 10-digit space stays useless. */
const checkTimes = new Map<number, { at: number; count: number }[]>();
function limitMemberIdChecks(userId: number, count: number) {
  const now = Date.now();
  const recent = (checkTimes.get(userId) ?? []).filter(entry => now - entry.at < 60_000);
  if (recent.reduce((sum, entry) => sum + entry.count, 0) + count > 20_000) throw new HttpError(429, "rate_limited");
  checkTimes.set(userId, [...recent, { at: now, count }]);
  if (checkTimes.size > 1000) for (const [id, entries] of checkTimes) if (entries.every(entry => now - entry.at >= 60_000)) checkTimes.delete(id);
}
/** Reads one uploaded file from a multipart request; legacy files may be UTF-16. */
async function uploadedFile(request: Request) {
  const bytes = await readBody(request, 1024 * 1024);
  let form: FormData;
  try { form = await new Response(Buffer.from(bytes), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData(); }
  catch { throw new HttpError(400, "invalid_body"); }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "invalid_file");
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const encoding = fileBytes[0] === 255 && fileBytes[1] === 254 ? "utf-16le" : fileBytes[0] === 254 && fileBytes[1] === 255 ? "utf-16be" : "utf-8";
  return { form, text: new TextDecoder(encoding).decode(fileBytes) };
}
async function body<T>(request: Request, schema: z.ZodType<T>) {
  return schema.parse(await bodyJson(request));
}
function staff(request: Request, code: string) {
  const user = signedIn(request);
  const event = eventRecord(code);
  return { user, event, role: requireStaff(event, user.id) };
}
const discordSchema = z.strictObject({ webhookUrl: z.string().url().max(500).nullable().refine(value => {
  if (value === null) return true;
  const url = new URL(value);
  return url.protocol === "https:" && ["discord.com", "discordapp.com"].includes(url.hostname)
    && !url.port && !url.username && !url.password && !url.search && !url.hash && /^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname);
}), postPairings: z.boolean(), postStandings: z.boolean() });
export function handleApi(request: Request, path: string[]) {
  return boundary(async () => {
    checkOrigin(request);
    const url = new URL(request.url);
    const method = request.method;
    if (path.length === 1 && path[0] === "me" && method === "GET") {
      const user = currentUser(request);
      return json({ user, canCreate: user !== null, createCodeRequired: user !== null && Boolean(process.env.CREATE_CODE) });
    }
    if (path[0] === "locations") {
      const user = signedIn(request);
      if (path.length === 1 && method === "GET") {
        const eventCode = url.searchParams.get("event");
        const ownerId = eventCode ? staff(request, eventCode).event.ownerUserId : user.id;
        return json({ locations: locations(ownerId), canEdit: ownerId === user.id });
      }
      if (path.length === 1 && method === "POST") return json(createLocation(user, await body(request, locationFields)), 201);
      if (path.length === 2 && path[1] && method === "PUT") return json(changeLocation(user.id, path[1], await body(request, locationFields)));
      if (path.length === 2 && path[1] && method === "DELETE") return json(changeLocation(user.id, path[1]));
      throw new HttpError(404, "not_found");
    }
    if (path[0] === "players") {
      const user = signedIn(request);
      if (path.length === 2 && path[1] === "invite" && (method === "GET" || method === "PUT")) {
        const code = url.searchParams.get("event");
        if (!code) throw new HttpError(400, "invalid_event");
        if (eventRecord(code).ownerUserId !== user.id) throw new HttpError(403, "forbidden_role");
        return json({ path: organizerInvite(user.id, method === "PUT") });
      }
      if (path.length === 2 && path[1] === "join" && method === "POST") {
        const { token } = await body(request, z.strictObject({ token: z.string().regex(inviteTokenPattern) }));
        return json({ organizerName: joinOrganizer(token, user.id) });
      }
      if (path.length === 1 && method === "GET") return json({ players: globalPlayers(user.id) });
      if (path.length === 2 && path[1] === "export" && method === "GET") return csvDownload(globalPlayersCsv(globalPlayers(user.id)), "AllPlayers.csv");
      if (path.length === 2 && path[1] === "import" && method === "POST") return json(importGlobalPlayers(user.id, (await uploadedFile(request)).text));
      throw new HttpError(404, "not_found");
    }
    if (path.length === 2 && path[0] === "events" && path[1] === "import" && method === "POST") {
      const user = signedIn(request);
      limitOpens(user.id);
      const { form, text } = await uploadedFile(request);
      requireCreateCode(form.get("createCode"));
      return json(await openTournamentAsNewEvent(user, text), 201);
    }
    if (path.length === 1 && path[0] === "events") {
      const user = signedIn(request);
      if (method === "GET") return json({ events: eventRecords().flatMap(event => {
        const role = viewerRole(event, user.id);
        const joined = event.state.players.some(p => p.userId === user.id);
        if (!role && !joined) return [];
        const { settings, rounds, players, teams, activityLog } = event.state;
        const first = rounds[0];
        // The listing needs no standings or match data: round progress and counts come straight from the stored state.
        return [{
          code: event.code, name: settings.name, phase: event.state.phase, role, joined, startsAt: settings.startsAt,
          createdAt: event.state.createdAt,
          // When play began: the first round's timer, else its pairing time, else the first pairing in the activity log (older events).
          firstRoundAt: first ? first.startedAt ?? first.pairedAt ?? activityLog?.find(a => a.action === "PairNextRound")?.at ?? null : null,
          format: settings.format, playerStructure: settings.playerStructure,
          playerCount: players.length, teamCount: teams.length, round: rounds.at(-1)?.number ?? null,
          plannedRounds: settings.plannedRounds ?? suggestRounds(competitors(event.state).length),
        }];
      }) });
      if (method === "POST") {
        const data = await body(request, z.strictObject({ name: z.string().trim().min(1).max(200), createCode: z.string(), settings: partialSettings.optional(), staff: z.array(staffSchema).max(100).optional() }));
        requireCreateCode(data.createCode);
        const staffCommand = await resolveCommand({ type: "UpdateSettings", settings: {}, staff: data.staff ?? [] });
        return json({ code: newEvent(user, data.name, { ...data.settings, name: data.name }, staffCommand.type === "UpdateSettings" ? staffCommand.staff : []) }, 201);
      }
    }
    if (path[0] === "accounts") {
      // Searching while creating a tournament has no event yet; any signed-in organizer may look accounts up then.
      if (path.length === 2 && path[1] === "search" && method === "GET") {
        const code = url.searchParams.get("event");
        if (code === "") throw new HttpError(400, "invalid_event");
        const access = code === null ? null : staff(request, code);
        const viewer = access?.user ?? signedIn(request);
        const ownerId = access?.event.ownerUserId ?? viewer.id;
        const query = z.string().max(200).parse(url.searchParams.get("q") ?? "");
        const users = await searchOrganizerAccounts(ownerId, query, { admin: isAdminUser(viewer.id), exact: url.searchParams.get("exact") === "1" });
        return json({ users: users.map(({ id, ...user }) => ({ userId: id, ...user })) });
      }
      if (path.length === 3 && path[2] === "member-id" && method === "PUT") {
        const code = url.searchParams.get("event");
        if (!code) throw new HttpError(400, "invalid_event");
        const access = staff(request, code);
        // Editing the global account profile follows the event's player-edit permission.
        requireCommand(access.event, access.user.id, { type: "UpdatePlayer", playerId: "profile" });
        const id = userId.parse(Number(path[1]));
        const data = await body(request, z.strictObject({ memberId: z.string().nullable() }));
        return json(await setMemberId(id, data.memberId));
      }
    }
    if (path[0] !== "events" || !path[1]) throw new HttpError(404, "not_found");
    const code = path[1];
    if (path.length === 2 && method === "GET") {
      const event = eventRecord(code);
      return json(url.searchParams.get("since") === String(event.version) ? { unchanged: true, version: event.version } : publicView(event.state, event.version));
    }
    const action = path[2];
    if (path.length === 3 && action === "desk" && method === "GET") {
      const { event, role } = staff(request, code);
      await lookupAccounts([...event.state.players.flatMap(p => p.userId === null ? [] : [p.userId]), ...event.state.staff.map(s => s.userId)]);
      return json(deskView(event, role));
    }
    if (path.length === 3 && action === "member-id-check" && method === "POST") {
      const { user } = staff(request, code);
      const { memberIds } = await body(request, z.strictObject({ memberIds: z.array(z.string().regex(/^\d{1,10}$/)).max(MEMBER_ID_CHECK_BATCH_SIZE) }));
      limitMemberIdChecks(user.id, memberIds.length);
      return json({ invalidMemberIds: memberIds.filter(id => !memberIdAccepted(id)) });
    }
    if (path.length === 3 && action === "activity" && method === "GET") {
      const { event } = staff(request, code);
      return json({ activity: [...(event.state.activityLog ?? [])].reverse(), version: event.version });
    }
    if (path.length === 3 && action === "print-data" && method === "GET") return json(printData(staff(request, code).event.state));
    if (path.length === 3 && action === "commands" && method === "POST") {
      const { user, event } = staff(request, code);
      const data = await body(request, z.strictObject({ expectedVersion: z.number().int().positive().safe(), command: commandSchema }));
      requireCommand(event, user.id, data.command);
      if (data.expectedVersion !== event.version) throw new HttpError(409, "version_conflict", { desk: deskView(event, requireStaff(event, user.id)) });
      return json(runCommand(code, user, data.expectedVersion, await resolveCommand(data.command)));
    }
    if (path.length === 3 && action === "dummy-data" && method === "POST") {
      const { user, event } = staff(request, code);
      requireDummyData(event, user.id);
      return json(runDummyData(code, user, await body(request, dummyDataSchema)));
    }
    if (path.length === 3 && ["me", "join", "report", "drop"].includes(action ?? "")) {
      let user = signedIn(request);
      const event = eventRecord(code);
      if (action === "me" && method === "GET") return json(playerResponse(event, user));
      if (action === "join" && method === "POST") {
        const data = await body(request, z.strictObject({ memberId: z.string().optional() }));
        if (data.memberId !== undefined) {
          await setMemberId(user.id, data.memberId);
          user = cachedUser(user.id) ?? user;
        }
        return json(joinEvent(code, user));
      }
      if (action === "report" && method === "POST") {
        const data = await body(request, z.strictObject({ matchId: z.string().min(1).max(128), result }));
        return json(playerCommand(code, user, player => ({ type: "ReportResult", playerId: player.id, ...data })));
      }
      if (action === "drop" && method === "POST") return json(playerCommand(code, user, player => ({ type: "DropPlayer", playerId: player.id })));
    }
    if (path.length === 3 && action === "import" && method === "POST") {
      const { user, event } = staff(request, code);
      requireImport(event, user.id);
      const { form, text } = await uploadedFile(request);
      const kind = z.enum(["tournament", "players", "team-players"]).parse(form.get("kind"));
      return json(await importEvent(code, user, kind, text));
    }
    if (path.length === 4 && action === "export" && path[3] && method === "GET") {
      return exportEvent(staff(request, code).event, path[3]);
    }
    if (path.length === 3 && action === "discord") {
      const { role } = staff(request, code);
      if (method === "GET") {
        const row = database().prepare<[string], { configured: number; postPairings: number; postStandings: number }>("SELECT webhook_url IS NOT NULL AS configured, post_pairings AS postPairings, post_standings AS postStandings FROM discord_settings WHERE event_code=?").get(code);
        return json({ configured: Boolean(row?.configured), postPairings: Boolean(row?.postPairings), postStandings: Boolean(row?.postStandings) });
      }
      if (method === "PUT") {
        if (role !== "organizer") throw new HttpError(403, "forbidden_role");
        const data = await body(request, discordSchema);
        database().prepare("INSERT INTO discord_settings(event_code,webhook_url,post_pairings,post_standings) VALUES (?,?,?,?) ON CONFLICT(event_code) DO UPDATE SET webhook_url=excluded.webhook_url, post_pairings=excluded.post_pairings, post_standings=excluded.post_standings")
          .run(code, data.webhookUrl, Number(data.postPairings), Number(data.postStandings));
        return json({ ok: true });
      }
    }
    throw new HttpError(404, "not_found");
  });
}

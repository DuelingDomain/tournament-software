import { timingSafeEqual, createHash } from "node:crypto";
import { publicView } from "@dd-tournament/engine";
import { z } from "zod";
import { currentUser, signedIn } from "./auth";
import { lookupAccounts, searchAccounts, setMemberId } from "./bridge";
import { cachedUser, database, eventRecord, eventRecords } from "./db";
import { deskView, importEvent, joinEvent, newEvent, playerCommand, playerResponse, resolveCommand, runCommand, runDummyData } from "./events";
import { exportEvent } from "./exports";
import { boundary, bodyJson, checkOrigin, HttpError, json, readBody } from "./http";
import { requireCommand, requireDummyData, requireImport, requireStaff, viewerRole } from "./permissions";
import { commandSchema, dummyDataSchema, partialSettings, result, userId, staffSchema, locationFields } from "./validation";

import { locations, createLocation, changeLocation } from "./locations";

async function body<T>(request: Request, schema: z.ZodType<T>) {
  return schema.parse(await bodyJson(request));
}
function staff(request: Request, code: string) {
  const user = signedIn(request);
  const event = eventRecord(code);
  return { user, event, role: requireStaff(event, user.id) };
}
function codeForAccounts(request: Request) {
  const code = new URL(request.url).searchParams.get("event");
  if (!code) throw new HttpError(400, "invalid_event");
  return staff(request, code);
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
      return json({ user, canCreate: user !== null });
    }
    if (path[0] === "locations") {
      const user = signedIn(request);
      if (path.length === 1 && method === "GET") {
        const eventCode = url.searchParams.get("event");
        const ownerId = eventCode ? staff(request, eventCode).event.ownerUserId : user.id;
        return json({ locations: locations(ownerId) });
      }
      if (path.length === 1 && method === "POST") return json(createLocation(user, await body(request, locationFields)), 201);
      if (path.length === 2 && path[1] && method === "PUT") return json(changeLocation(user.id, path[1], await body(request, locationFields)));
      if (path.length === 2 && path[1] && method === "DELETE") return json(changeLocation(user.id, path[1]));
      throw new HttpError(404, "not_found");
    }
    if (path.length === 1 && path[0] === "events") {
      const user = signedIn(request);
      if (method === "GET") return json({ events: eventRecords().flatMap(event => {
        const role = viewerRole(event, user.id);
        const joined = event.state.players.some(p => p.userId === user.id);
        return role || joined ? [{ code: event.code, name: event.state.settings.name, phase: event.state.phase, role, joined, startsAt: event.state.settings.startsAt }] : [];
      }) });
      if (method === "POST") {
        const data = await body(request, z.strictObject({ name: z.string().trim().min(1).max(200), createCode: z.string(), settings: partialSettings.optional(), staff: z.array(staffSchema).max(100).optional() }));
        const configured = process.env.CREATE_CODE ?? "";
        const digest = (value: string) => createHash("sha256").update(value).digest();
        if (configured && !timingSafeEqual(digest(configured), digest(data.createCode))) throw new HttpError(403, "invalid_create_code");
        const staffCommand = await resolveCommand({ type: "UpdateSettings", settings: {}, staff: data.staff ?? [] });
        return json({ code: newEvent(user, data.name, { ...data.settings, name: data.name }, staffCommand.type === "UpdateSettings" ? staffCommand.staff : []) }, 201);
      }
    }
    if (path[0] === "accounts") {
      const access = codeForAccounts(request);
      if (path.length === 2 && path[1] === "search" && method === "GET") {
        const query = z.string().max(200).parse(url.searchParams.get("q") ?? "");
        const users = await searchAccounts(query);
        return json({ users: users.map(({ id, ...user }) => ({ userId: id, ...user })) });
      }
      if (path.length === 3 && path[2] === "member-id" && method === "PUT") {
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
      const bytes = await readBody(request, 1024 * 1024);
      let form: FormData;
      try { form = await new Response(Buffer.from(bytes), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData(); }
      catch { throw new HttpError(400, "invalid_body"); }
      const file = form.get("file");
      const kind = z.enum(["tournament", "players"]).parse(form.get("kind"));
      if (!(file instanceof File)) throw new HttpError(400, "invalid_file");
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const encoding = fileBytes[0] === 255 && fileBytes[1] === 254 ? "utf-16le" : fileBytes[0] === 254 && fileBytes[1] === 255 ? "utf-16be" : "utf-8";
      return json(await importEvent(code, user, kind, new TextDecoder(encoding).decode(fileBytes)));
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

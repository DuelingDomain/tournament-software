import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { appUrl, mockEnabled, secret } from "./config";
import { fakeUsers, mockAssertion, validReturn, verifyAssertion } from "./bridge";
import { cacheUser, cachedUser, database } from "./db";
import { boundary, checkOrigin, HttpError, readBody, redirect } from "./http";

const COOKIE = "dd_t_session";
const LIFETIME = 30 * 24 * 60 * 60;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function signature(value: string) { return createHmac("sha256", secret("SESSION_SECRET")).update(value).digest("hex"); }
function sessionCookie(value: string, maxAge: number) {
  const secure = process.env.PUBLIC_URL?.startsWith("https://") || process.env.NODE_ENV === "production";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
type SessionRequest = { headers: Pick<Headers, "get"> };
function sessionToken(request: SessionRequest): string | null {
  const cookie = request.headers.get("cookie")?.split(";").map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const match = /^([a-f0-9]{64})\.([a-f0-9]{64})$/.exec(cookie ?? "");
  if (!match) return null;
  return timingSafeEqual(Buffer.from(signature(match[1]!), "hex"), Buffer.from(match[2]!, "hex")) ? match[1]! : null;
}
export function currentUser(request: SessionRequest) {
  const token = sessionToken(request);
  if (!token) return null;
  const row = database().prepare<[string, number], { user_id: number }>("SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?").get(hash(token), Math.floor(Date.now() / 1000));
  return row ? cachedUser(row.user_id) : null;
}
export function signedIn(request: Request) {
  const user = currentUser(request);
  if (!user) throw new HttpError(401, "unauthorized");
  return user;
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
export function handleAuth(request: Request, action: string) {
  return boundary(async () => {
    checkOrigin(request);
    const url = new URL(request.url);
    if (action === "start" && request.method === "GET") {
      const returnTo = url.searchParams.get("return") ?? "/";
      if (!validReturn(returnTo)) throw new HttpError(400, "invalid_return");
      const target = mockEnabled() ? new URL("/auth/mock", request.url) : new URL("/api/tournament-bridge/start", appUrl());
      target.searchParams.set("return", returnTo);
      return redirect(target.toString());
    }
    if (action === "callback" && request.method === "GET") {
      const assertion = verifyAssertion(url.searchParams.get("assertion") ?? "");
      const token = randomBytes(32).toString("hex");
      const cookie = sessionCookie(`${token}.${signature(token)}`, LIFETIME);
      const db = database();
      db.transaction(() => {
        const now = Math.floor(Date.now() / 1000);
        db.prepare("DELETE FROM nonces WHERE expires_at<=?").run(now);
        db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now);
        if (!db.prepare("INSERT OR IGNORE INTO nonces(nonce,expires_at) VALUES (?,?)").run(assertion.nonce, assertion.exp).changes)
          throw new HttpError(401, "replayed_assertion");
        cacheUser(assertion.user);
        db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)").run(hash(token), assertion.user.id, now + LIFETIME);
      }).immediate();
      return redirect(assertion.return, { "Set-Cookie": cookie });
    }
    if (action === "sign-out" && request.method === "POST") {
      const token = sessionToken(request);
      if (token) database().prepare("DELETE FROM sessions WHERE token_hash=?").run(hash(token));
      return new Response(null, { status: 204, headers: { "Set-Cookie": sessionCookie("", 0), "Cache-Control": "no-store" } });
    }
    if (action === "mock" && mockEnabled()) {
      const returnTo = url.searchParams.get("return") ?? "/";
      if (!validReturn(returnTo)) throw new HttpError(400, "invalid_return");
      if (request.method === "GET") {
        const options = fakeUsers.map(user => `<option value="${user.id}">${escapeHtml(user.displayName)}</option>`).join("");
        return new Response(`<!doctype html><html><head><title>Development sign in</title></head><body><h1>Fake accounts (development only)</h1><form method="post" action="/auth/mock?${escapeHtml(new URLSearchParams({ return: returnTo }).toString())}"><label>Account <select name="userId">${options}</select></label><button>Sign in</button></form></body></html>`,
          { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
      }
      if (request.method === "POST") {
        const form = new URLSearchParams(new TextDecoder().decode(await readBody(request)));
        const userId = z.coerce.number().int().positive().parse(form.get("userId"));
        const user = fakeUsers.find(user => user.id === userId);
        if (!user) throw new HttpError(400, "invalid_user");
        return redirect(`/auth/callback?${new URLSearchParams({ assertion: mockAssertion(user, returnTo) })}`);
      }
    }
    throw new HttpError(404, "not_found");
  });
}

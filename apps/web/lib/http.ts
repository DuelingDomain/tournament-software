import { CommandError } from "@dd-tournament/engine";
import { z } from "zod";

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, readonly extra: object = {}) { super(code); }
}
export function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", ...headers } });
}
export function redirect(location: string, headers: HeadersInit = {}) {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", ...headers } });
}
export async function boundary(run: () => Promise<Response> | Response): Promise<Response> {
  try { return await run(); }
  catch (error) {
    if (error instanceof HttpError) return json({ error: error.code, ...error.extra }, error.status);
    if (error instanceof CommandError) return json({ error: error.code, message: error.message }, 422);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "invalid_body" }, 400);
    console.error({ event: "request_failed", errorType: error instanceof Error ? error.name : "unknown" });
    return json({ error: "internal_error" }, 500);
  }
}
export async function readBody(request: Request, limit = 64 * 1024): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > limit) throw new HttpError(413, "body_too_large");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > limit) { await reader.cancel(); throw new HttpError(413, "body_too_large"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}
export async function bodyJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new HttpError(400, "invalid_body");
  return JSON.parse(Buffer.from(await readBody(request)).toString("utf8"));
}
export function checkOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  // Browsers send "Origin: null" on form POSTs under our no-referrer policy;
  // accept that only when the browser also says the request is same-origin.
  const nullSameOrigin = origin === "null" && fetchSite === "same-origin";
  if ((origin && !nullSameOrigin && origin !== new URL(process.env.PUBLIC_URL || request.url).origin)
      || fetchSite === "cross-site") throw new HttpError(403, "forbidden_origin");
}

import { handleAuth } from "../../../lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ action: string }> };
async function handle(request: Request, context: Context) {
  const response = await handleAuth(request, (await context.params).action);
  // A browser navigation that fails a sign-in step lands on the sign-in page with a message, not a raw JSON error.
  // Non-browser clients (no text/html in Accept) keep the JSON error and status.
  if (request.method === "GET" && request.headers.get("accept")?.includes("text/html") && response.status >= 400 && response.headers.get("content-type")?.includes("application/json")) {
    const body = (await response.clone().json().catch(() => ({}))) as { error?: string };
    return new Response(null, { status: 303, headers: { Location: `/?signin=${encodeURIComponent(body.error ?? "failed")}`, "Cache-Control": "no-store" } });
  }
  return response;
}
export { handle as GET, handle as POST };

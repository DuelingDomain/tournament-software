import { handleAuth } from "../../../lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ action: string }> };
async function handle(request: Request, context: Context) { return handleAuth(request, (await context.params).action); }
export { handle as GET, handle as POST };

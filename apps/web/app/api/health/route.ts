import { json, boundary } from "../../../lib/http";
import { database } from "../../../lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() { return boundary(() => { database().prepare("SELECT 1").get(); return json({ ok: true }); }); }

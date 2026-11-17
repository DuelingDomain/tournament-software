import type { DeskView } from "@dd-tournament/engine";

type Body = { action: "players"; count: number } | { action: "results" };
export type DummyResult = { ok: true; desk: DeskView; count: number } | { ok: false; message: string; desk?: DeskView };

/** Practice-data generator (organizer and head judge only). Tolerates the endpoint being absent. */
export async function postDummy(code: string, desk: DeskView, body: Body): Promise<DummyResult> {
  try {
    const response = await fetch(`/api/events/${encodeURIComponent(code)}/dummy-data`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, expectedVersion: desk.version }),
    });
    const data = (await response.json().catch(() => ({}))) as { desk?: DeskView; added?: number; entered?: number; error?: string; message?: string };
    if (response.status === 404) return { ok: false, message: "Dummy data is not available on this server." };
    if (response.status === 409 && data.desk) return { ok: false, desk: data.desk, message: "Another staff member changed the tournament. The desk was refreshed, try again." };
    if (response.status === 403) return { ok: false, message: "Only the organizer or head judge can generate dummy data." };
    if (!response.ok || !data.desk) return { ok: false, message: data.error === "REGISTRATION_ONLY" ? "Test players can only be added during registration." : data.error === "NO_ROUND" ? "Pair a round first." : data.error === "EVENT_COMPLETE" ? "The tournament is finished." : data.message ?? `Request failed (${response.status}).` };
    return { ok: true, desk: data.desk, count: data.added ?? data.entered ?? 0 };
  } catch { return { ok: false, message: "Could not reach the server." }; }
}

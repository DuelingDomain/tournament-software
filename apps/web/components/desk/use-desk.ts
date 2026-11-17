"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Command, DeskView } from "@dd-tournament/engine";
import type { DeskCommandResult } from "./helpers";

export type LoadState = "loading" | "ready" | "signed_out" | "forbidden" | "missing" | "error";
export type SendInput = Command | ((desk: DeskView) => Command | null);
export type SendFn = (input: SendInput, opts?: { retry?: boolean }) => Promise<DeskCommandResult>;

const POLL_MS = 3000;
export const MESSAGES: Record<string, string> = {
  forbidden_role: "Your role cannot do that.",
  version_conflict: "Another staff member changed the event. The desk was refreshed, try again.",
  account_not_found: "That Dueling Domain account was not found.",
  member_id_taken: "Another account already has that COSSY ID.",
  invalid_member_id: "A COSSY ID is one to ten digits.",
  bridge_unavailable: "Dueling Domain accounts are unreachable right now. Try again in a moment.",
  internal_error: "Something went wrong on the server.",
  invalid_body: "The server could not read that request.",
  forbidden_origin: "The request was blocked. Reload the page and try again.",
};

/** Loads the desk, keeps it fresh (poll every 3s), and serialises every command so
 *  fast keying never races the version check. */
export function useDesk(code: string) {
  const base = `/api/events/${encodeURIComponent(code)}`;
  const [desk, setDesk] = useState<DeskView | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [saving, setSaving] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const deskRef = useRef<DeskView | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const epoch = useRef(0);

  const adopt = useCallback((next: DeskView) => {
    if (deskRef.current && next.version < deskRef.current.version) return;
    deskRef.current = next; setDesk(next); setState("ready");
  }, []);

  const refetch = useCallback(async () => {
    try {
      const response = await fetch(`${base}/desk`, { cache: "no-store" });
      if (response.status === 401) return setState("signed_out");
      if (response.status === 403) return setState("forbidden");
      if (response.status === 404) return setState("missing");
      if (!response.ok) return setState(s => (s === "ready" ? s : "error"));
      adopt((await response.json()) as DeskView);
    } catch { setState(s => (s === "ready" ? s : "error")); }
  }, [base, adopt]);

  useEffect(() => { void refetch(); }, [refetch]);

  useEffect(() => {
    if (state !== "ready") return;
    let stop = false;
    const tick = async () => {
      if (stop || document.hidden || !deskRef.current) return;
      const started = epoch.current;
      try {
        const response = await fetch(`${base}?since=${deskRef.current.version}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { version: number; unchanged?: boolean };
        if (stop || body.unchanged || !deskRef.current || body.version === deskRef.current.version) return;
        await refetch();
        if (started === epoch.current && !stop) setNote("Updated by another staff member");
      } catch { /* the next tick retries */ }
    };
    const id = window.setInterval(() => void tick(), POLL_MS);
    const onVisible = () => { if (!document.hidden) void tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stop = true; window.clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [state, base, refetch]);

  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 6000);
    return () => window.clearTimeout(id);
  }, [note]);

  const send = useCallback<SendFn>((input, opts) => {
    const run = async (): Promise<DeskCommandResult> => {
      setSaving(n => n + 1);
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const before = deskRef.current;
          if (!before) return { ok: false, code: "not_loaded", message: "The desk has not loaded yet." };
          const command = typeof input === "function" ? input(before) : input;
          if (!command) return { ok: false, code: "noop", message: "Nothing to do." };
          epoch.current++;
          let response: Response;
          try {
            response = await fetch(`${base}/commands`, { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ expectedVersion: before.version, command }) });
          } catch { return { ok: false, code: "network", message: "Could not reach the server. Your change was not saved." }; }
          const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string; desk?: DeskView } & Partial<DeskView>;
          if (response.ok) { const desk = body as DeskView; adopt(desk); return { ok: true, before, desk }; }
          if (response.status === 401) { setState("signed_out"); return { ok: false, code: "signed_out", message: "You were signed out." }; }
          if (response.status === 409 && body.desk) {
            deskRef.current = body.desk; setDesk(body.desk);
            setNote("Updated by another staff member");
            if (opts?.retry && attempt === 0) continue;
            return { ok: false, code: "version_conflict", message: MESSAGES.version_conflict! };
          }
          const code = body.error ?? "error";
          return { ok: false, code, message: body.message ?? MESSAGES[code] ?? `Request failed (${response.status}).` };
        }
        return { ok: false, code: "version_conflict", message: MESSAGES.version_conflict! };
      } finally { setSaving(n => n - 1); }
    };
    const next = queue.current.then(run, run);
    queue.current = next.catch(() => undefined);
    return next;
  }, [base, adopt]);

  const replaceDesk = useCallback((next: DeskView) => { deskRef.current = next; setDesk(next); setState("ready"); }, []);
  return { desk, state, saving, note, send, refetch, replaceDesk, dismissNote: () => setNote(null) };
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MESSAGES } from "./use-desk";

export interface Account { userId: number; username: string; displayName: string; discordUserId: string | null; discordUsername: string | null; memberId: string | null }

/** Account search for one event (staff only); `null` searches before an event exists (any signed-in organizer). Typing searches after a short pause; run("") is "Show All". */
export function useAccountSearch(code: string | null) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Account[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const run = useCallback(async (q: string) => {
    const id = ++seq.current;
    setState("loading"); setError(null);
    try {
      const response = await fetch(`/api/accounts/search?${code === null ? "" : `event=${encodeURIComponent(code)}&`}q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as { users?: Account[]; error?: string };
      if (id !== seq.current) return;
      if (!response.ok) { setState("error"); setError(MESSAGES[body.error ?? ""] ?? "Search failed."); return; }
      setResults(body.users ?? []); setState("idle");
    } catch { if (id === seq.current) { setState("error"); setError("Could not reach the server."); } }
  }, [code]);

  useEffect(() => {
    if (query.trim() === "") return;
    const id = window.setTimeout(() => void run(query.trim()), 250);
    return () => window.clearTimeout(id);
  }, [query, run]);

  return { query, setQuery, results, state, error, run, clear: () => { seq.current++; setResults(null); setState("idle"); } };
}

export async function saveMemberId(code: string, userId: number, memberId: string | null): Promise<{ ok: true; memberId: string | null; checkDigitOk: boolean } | { ok: false; message: string }> {
  try {
    const response = await fetch(`/api/accounts/${userId}/member-id?event=${encodeURIComponent(code)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId }) });
    const body = (await response.json().catch(() => ({}))) as { memberId?: string | null; checkDigitOk?: boolean; error?: string };
    if (!response.ok) return { ok: false, message: MESSAGES[body.error ?? ""] ?? "Could not save the COSSY ID." };
    return { ok: true, memberId: body.memberId ?? null, checkDigitOk: body.checkDigitOk ?? true };
  } catch { return { ok: false, message: "Could not reach the server." }; }
}

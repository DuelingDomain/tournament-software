"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MESSAGES } from "./use-desk";

export interface Account { userId: number; username: string; displayName: string; discordUserId: string | null; discordUsername: string | null; memberId: string | null }
export const ACCOUNT_SEARCH_HINT = "To find a new account, submit its full username, Discord username, COSSY ID or email.";

/** Typing filters the known list. Submitting the search also checks for a complete identifier. */
export function useAccountSearch(code: string | null) {
  const [query, setQueryText] = useState("");
  const [results, setResults] = useState<Account[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const timer = useRef<number>(undefined);

  const run = useCallback(async (q: string, exact = true) => {
    window.clearTimeout(timer.current);
    const id = ++seq.current;
    setState("loading"); setError(null);
    try {
      const response = await fetch(accountSearchUrl(code, q, exact), { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as { users?: Account[]; error?: string };
      if (id !== seq.current) return;
      if (!response.ok) { setState("error"); setError(MESSAGES[body.error ?? ""] ?? "Search failed."); return; }
      setResults(body.users ?? []); setState("idle");
    } catch { if (id === seq.current) { setState("error"); setError("Could not reach the server."); } }
  }, [code]);

  const setQuery = useCallback((q: string) => {
    setQueryText(q);
    seq.current++;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void run(q.trim(), false), 250);
  }, [run]);

  useEffect(() => () => { seq.current++; window.clearTimeout(timer.current); }, [run]);

  function showResults(q: string, users: Account[]) {
    seq.current++;
    window.clearTimeout(timer.current);
    setQueryText(q);
    setResults(users);
    setError(null);
    setState("idle");
  }

  return { query, setQuery, results, state, error, run, showResults, clear: () => {
    seq.current++;
    window.clearTimeout(timer.current);
    setResults(null);
    setState("idle");
  } };
}

function accountSearchUrl(code: string | null, q: string, exact: boolean) {
  const query = new URLSearchParams({ q });
  if (code !== null) query.set("event", code);
  if (exact && q) query.set("exact", "1");
  return `/api/accounts/search?${query}`;
}

export async function saveMemberId(code: string, userId: number, memberId: string | null): Promise<{ ok: true; memberId: string | null; checkDigitOk: boolean } | { ok: false; message: string }> {
  try {
    const response = await fetch(`/api/accounts/${userId}/member-id?event=${encodeURIComponent(code)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId }) });
    const body = (await response.json().catch(() => ({}))) as { memberId?: string | null; checkDigitOk?: boolean; error?: string };
    if (!response.ok) return { ok: false, message: MESSAGES[body.error ?? ""] ?? "Could not save the COSSY ID." };
    return { ok: true, memberId: body.memberId ?? null, checkDigitOk: body.checkDigitOk ?? true };
  } catch { return { ok: false, message: "Could not reach the server." }; }
}

/** One-shot account lookup for an event (no state), used where several inputs each look up on Enter. */
export async function findAccounts(code: string, q: string, exact: boolean): Promise<{ ok: true; users: Account[] } | { ok: false; message: string }> {
  try {
    const response = await fetch(accountSearchUrl(code, q, exact), { cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as { users?: Account[]; error?: string };
    if (!response.ok) return { ok: false, message: MESSAGES[body.error ?? ""] ?? "Search failed." };
    return { ok: true, users: body.users ?? [] };
  } catch { return { ok: false, message: "Could not reach the server." }; }
}

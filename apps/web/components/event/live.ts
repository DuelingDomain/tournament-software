"use client";
import { useEffect, useState } from "react";
import type { PublicView } from "@dd-tournament/engine";

export type LiveState = { view: PublicView | null; status: "loading" | "ok" | "missing" | "error"; stale: boolean };

/** Loads the public view, then polls every 3 seconds with ?since=version so unchanged polls are tiny. */
export function usePublicEvent(code: string): LiveState {
  const [state, setState] = useState<LiveState>({ view: null, status: "loading", stale: false });
  useEffect(() => {
    let alive = true;
    let version = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      try {
        const response = await fetch(`/api/events/${encodeURIComponent(code)}${version ? `?since=${version}` : ""}`, { cache: "no-store" });
        if (!alive) return;
        if (response.status === 404) { setState({ view: null, status: "missing", stale: false }); return; }
        const data = await response.json() as PublicView | { unchanged: true; version: number };
        if (!response.ok) throw new Error("bad_response");
        if ("unchanged" in data) setState(s => (s.stale ? { ...s, stale: false } : s));
        else { version = data.version; setState({ view: data, status: "ok", stale: false }); }
      } catch {
        if (alive) setState(s => ({ ...s, status: s.view ? "ok" : "error", stale: true }));
      }
      if (alive) timer = setTimeout(tick, 3000);
    }
    void tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [code]);
  return state;
}

/** Re-renders every `ms` while `active`. Returns epoch millis. */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

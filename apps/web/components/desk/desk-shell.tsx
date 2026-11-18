"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DeskNav } from "./chrome";
import { Desk } from "./desk";
import { cachedDesk, closeTab, hydrateTabs, loadDesk, openTab, syncTab, tabCodes, useTabs } from "./desk-tabs";

const IDLE_SYNC_MS = 20_000;
const SWITCH_WAIT_MS = 1500;
const codeOfPath = (path: string) => /^\/e\/([^/]+)\/desk\/?$/.exec(path)?.[1] ?? null;
const pathOf = (code: string) => `/e/${encodeURIComponent(code)}/desk`;

/** Holds the open tournaments and shows one at a time. Switching tabs changes the address with the History API,
 *  so the page never reloads: the desk of the other tournament comes from memory and refreshes in the background. */
export function DeskShell({ initialCode }: { initialCode: string }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [pending, setPending] = useState<string | null>(null);
  const codeRef = useRef(code);
  codeRef.current = code;
  const wanted = useRef<string | null>(null);

  const show = useCallback((next: string, how: "push" | "replace" | "none") => {
    openTab(next);
    if (how !== "none") window.history[how === "push" ? "pushState" : "replaceState"](null, "", pathOf(next));
    setCode(next); setPending(null); wanted.current = null;
  }, []);

  // The tab of the tournament this page was opened on, then the saved list for this user.
  useEffect(() => {
    openTab(initialCode);
    let off = false;
    void fetch("/api/me", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then((me: { user?: { id?: number } | null } | null) => {
      if (!off) hydrateTabs(me?.user?.id !== undefined ? String(me.user.id) : "anonymous", codeRef.current);
    }).catch(() => undefined);
    return () => { off = true; };
  }, [initialCode]);

  // Back and forward move between tabs the same way.
  useEffect(() => {
    const onPop = () => { const next = codeOfPath(window.location.pathname); if (next && next !== codeRef.current) show(next, "none"); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [show]);

  const select = useCallback((next: string) => {
    if (next === codeRef.current) { wanted.current = null; setPending(null); return; }
    if (cachedDesk(next)) { show(next, "push"); return; }
    // Not loaded yet: stay on this tab until the other one is ready, so the screen never blanks.
    wanted.current = next; setPending(next);
    void Promise.race([loadDesk(next), new Promise(r => window.setTimeout(r, SWITCH_WAIT_MS))]).then(() => { if (wanted.current === next) show(next, "push"); });
  }, [show]);

  const close = useCallback((target: string) => {
    const next = closeTab(target);
    if (target !== codeRef.current) return;
    if (next) show(next, "replace"); else router.push("/");
  }, [show, router]);

  // Keep the other tabs' round chip and live mark current without loading each one in full every few seconds.
  const openCodes = useTabs().map(t => t.code).join("|");
  useEffect(() => {
    let stop = false;
    const sweep = async () => {
      if (document.hidden) return;
      for (const c of tabCodes()) {
        if (stop) return;
        if (c === codeRef.current) continue;
        if (await syncTab(c) === "gone") closeTab(c);
      }
    };
    void sweep();
    const id = window.setInterval(() => void sweep(), IDLE_SYNC_MS);
    return () => { stop = true; window.clearInterval(id); };
  }, [openCodes]);

  const nav: DeskNav = { select, close, pending };
  return <Desk key={code} code={code} nav={nav} />;
}

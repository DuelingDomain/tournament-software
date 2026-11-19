"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DeskNav } from "./chrome";
import { Desk } from "./desk";
import { cachedDesk, closeTab, hydrateTabs, loadDesk, openTab, saveFailures, savesInFlight, syncTab, tabCodes, useTabs, whenSavesDone, tabName } from "./desk-tabs";

const IDLE_SYNC_MS = 20_000;
const SWITCH_WAIT_MS = 1500;
const SAVE_WAIT_MS = 15_000;
const codeOfPath = (path: string) => { const m = /^\/e\/([^/]+)\/desk\/?$/.exec(path)?.[1]; try { return m ? decodeURIComponent(m) : null; } catch { return null; } };
const pathOf = (code: string) => `/e/${encodeURIComponent(code)}/desk`;
const sleep = (ms: number) => new Promise<void>(r => window.setTimeout(r, ms));

/** Holds the open tournaments and shows one at a time. Switching tabs changes the address with the History API,
 *  so the page never reloads: the desk of the other tournament comes from memory and refreshes in the background. */
export function DeskShell({ initialCode }: { initialCode: string }) {
  // The address is the truth after a history move that kept this page alive.
  const [code, setCode] = useState(() => (typeof window === "undefined" ? null : codeOfPath(window.location.pathname)) ?? initialCode);
  const [pending, setPending] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const codeRef = useRef(code);
  codeRef.current = code;
  const wanted = useRef<string | null>(null);
  const refocus = useRef(false);

  const tell = useCallback((text: string) => setNote(text), []);
  useEffect(() => { if (!note) return; const id = window.setTimeout(() => setNote(null), 6000); return () => window.clearTimeout(id); }, [note]);

  const cancel = useCallback(() => { wanted.current = null; setPending(null); }, []);
  const show = useCallback((next: string, how: "push" | "replace" | "none") => {
    openTab(next);
    if (how !== "none") window.history[how === "push" ? "pushState" : "replaceState"](null, "", pathOf(next));
    setCode(next); setPending(null); wanted.current = null;
  }, []);

  // The tab of the tournament on screen, then the saved list for this user. With no signed-in user there is no list to load or save.
  useEffect(() => {
    openTab(codeRef.current);
    let off = false;
    void fetch("/api/me", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then((me: { user?: { id?: number } | null } | null) => {
      if (!off && typeof me?.user?.id === "number") hydrateTabs(String(me.user.id), codeRef.current);
    }).catch(() => undefined);
    // A page restored from the back/forward cache keeps its old state; make sure its tournament has a tab again.
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) openTab(codeOfPath(window.location.pathname) ?? codeRef.current); };
    window.addEventListener("pageshow", onShow);
    return () => { off = true; window.removeEventListener("pageshow", onShow); };
  }, []);

  // Back and forward move between tabs the same way.
  useEffect(() => {
    const onPop = () => { const next = codeOfPath(window.location.pathname); if (next && next !== codeRef.current) show(next, "none"); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [show]);

  // A switch that is still waiting is dropped by the first key pressed in the desk you are on.
  useEffect(() => {
    if (!pending) return;
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [pending, cancel]);

  /** Wait for commands still being saved. False when one of them failed: stay, so the error stays on screen. */
  const settle = useCallback(async (token: string) => {
    if (savesInFlight() === 0) return true;
    const failed = saveFailures();
    await Promise.race([whenSavesDone(), sleep(SAVE_WAIT_MS)]);
    return wanted.current === token && saveFailures() === failed;
  }, []);

  const select = useCallback((next: string) => {
    if (next === codeRef.current) { cancel(); return; }
    if (savesInFlight() === 0 && cachedDesk(next)) { show(next, "push"); return; }
    wanted.current = next; setPending(next);
    void (async () => {
      if (!(await settle(next))) { if (wanted.current === next) cancel(); return; }
      if (!cachedDesk(next)) {
        // Not loaded yet: stay on this tab until the other one is ready, so the screen never blanks.
        const loaded = await Promise.race([loadDesk(next), sleep(SWITCH_WAIT_MS).then(() => "slow" as const)]);
        if (wanted.current !== next) return;
        if (loaded === "gone") { const name = tabName(next); closeTab(next); cancel(); tell(`${name} was closed: it no longer exists, or you no longer have access to it.`); return; }
      }
      if (wanted.current === next) show(next, "push");
    })();
  }, [show, cancel, settle, tell]);

  const close = useCallback((target: string) => {
    const finish = () => {
      const next = closeTab(target);
      if (target !== codeRef.current) return;
      refocus.current = true;
      if (next) show(next, "replace"); else window.location.assign("/");
    };
    if (target === codeRef.current && savesInFlight() > 0) {
      wanted.current = target; setPending(target);
      void settle(target).then(ok => { if (ok) finish(); else if (wanted.current === target) cancel(); });
    } else finish();
  }, [show, cancel, settle]);

  // After a tab closes, keyboard focus moves to the tab now on screen.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    let tries = 0;
    const id = window.setInterval(() => {
      const link = document.querySelector<HTMLElement>('.dk-binder .dk-tab-link[aria-current="page"]') ?? document.querySelector<HTMLElement>(".dk-binder .dk-tab-link");
      if (link) { link.focus(); window.clearInterval(id); } else if (++tries > 20) window.clearInterval(id);
    }, 50);
    return () => window.clearInterval(id);
  });

  // Keep the other tabs' round chip and live mark current from the public page data, never the full desk.
  const openCodes = useTabs().map(t => t.code).join("|");
  useEffect(() => {
    let stop = false;
    const sweep = async () => {
      if (document.hidden) return;
      for (const c of tabCodes()) {
        if (stop) return;
        if (c === codeRef.current) continue;
        if (await syncTab(c, () => stop || c === codeRef.current) === "gone" && !stop && c !== codeRef.current) {
          const name = tabName(c); closeTab(c);
          tell(`${name} was closed: that tournament no longer exists.`);
        }
      }
    };
    void sweep();
    const id = window.setInterval(() => void sweep(), IDLE_SYNC_MS);
    return () => { stop = true; window.clearInterval(id); };
  }, [openCodes, tell]);

  const nav: DeskNav = { select, close, pending };
  return <>
    <Desk key={code} code={code} nav={nav} />
    {note && <p className="dk-shell-note" role="status">{note}</p>}
  </>;
}

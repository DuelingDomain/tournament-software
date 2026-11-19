"use client";
import { useSyncExternalStore } from "react";
import type { DeskView } from "../../lib/desk-view";

/** The tournaments this browser has open on the desk, in the order they were opened, and the last desk view of each.
 *  It lives outside React so switching tabs shows the cached view at once and refreshes it in the background. */
export interface TabMeta { code: string; name: string; round: string | null; live: boolean }
export type DeskSide = "all" | "event";

const MAX_TABS = 20;
const KEY = "dk:open-tabs:v1";
let tabs: TabMeta[] = [];
let owner: string | null = null;
const listeners = new Set<() => void>();
const desks = new Map<string, DeskView>();
const sides = new Map<string, DeskSide>();

const emit = () => { for (const l of listeners) l(); };
const keyFor = (user: string) => `${KEY}:${user}`;

function persist() {
  if (owner === null) return;
  try { localStorage.setItem(keyFor(owner), JSON.stringify(tabs.map(t => ({ code: t.code, name: t.name })))); } catch { /* storage unavailable */ }
}

function readStored(user: string): { code: string; name: string }[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(keyFor(user)) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.flatMap(r => r && typeof r === "object" && typeof (r as { code?: unknown }).code === "string" && typeof (r as { name?: unknown }).name === "string"
      ? [{ code: (r as { code: string }).code, name: (r as { name: string }).name }] : []).slice(0, MAX_TABS);
  } catch { return []; }
}

export function metaOf(desk: DeskView): Omit<TabMeta, "code"> {
  const round = desk.state.rounds.at(-1);
  return {
    name: desk.state.settings.name,
    round: round ? `${round.stage === "playoff" ? "P" : "R"}${round.number}` : null,
    live: desk.state.phase === "swiss" || desk.state.phase === "playoff",
  };
}

/** Add a tab at the end. The tab being opened is never the one dropped when the list is full. */
export function openTab(code: string, name?: string) {
  if (tabs.some(t => t.code === code)) return;
  const next = [...tabs, { code, name: name ?? code, round: null, live: false }];
  while (next.length > MAX_TABS) { const i = next.findIndex(t => t.code !== code); const [gone] = next.splice(i, 1); if (gone) forget(gone.code); }
  tabs = next; persist(); emit();
}

/** Remove a tab. Returns the tab to show next (the one that took its place, else the one before), or null when none is left. */
export function closeTab(code: string): string | null {
  const i = tabs.findIndex(t => t.code === code);
  if (i < 0) return tabs[0]?.code ?? null;
  tabs = tabs.filter(t => t.code !== code);
  forget(code); persist(); emit();
  return (tabs[i] ?? tabs[i - 1])?.code ?? null;
}

/** Read the saved list for this user and make sure the tournament being shown has a tab. */
export function hydrateTabs(user: string, current: string) {
  owner = user;
  const known = new Map(tabs.map(t => [t.code, t] as const));
  const merged = readStored(user).map(s => known.get(s.code) ?? { ...s, round: null, live: false });
  for (const t of tabs) if (!merged.some(m => m.code === t.code)) merged.push(t);
  tabs = merged; persist();
  openTab(current); emit();
}

export function setTabMeta(code: string, meta: Omit<TabMeta, "code">) {
  const i = tabs.findIndex(t => t.code === code);
  const old = tabs[i];
  if (!old || (old.name === meta.name && old.round === meta.round && old.live === meta.live)) return;
  tabs = tabs.map((t, j) => (j === i ? { code, ...meta } : t));
  if (old.name !== meta.name) persist();
  emit();
}

export const tabName = (code: string) => tabs.find(t => t.code === code)?.name ?? code;
export const tabCodes = () => tabs.map(t => t.code);
export const cachedDesk = (code: string) => desks.get(code) ?? null;
export function cacheDesk(code: string, desk: DeskView) {
  const old = desks.get(code);
  if (old && desk.version < old.version) return;
  desks.set(code, desk);
  setTabMeta(code, metaOf(desk));
}
export const sideOf = (code: string): DeskSide => sides.get(code) ?? "event";
export const rememberSide = (code: string, side: DeskSide) => { sides.set(code, side); };
function forget(code: string) { desks.delete(code); sides.delete(code); seen.delete(code); }

export type Loaded = "ok" | "gone" | "error";
/** Fetch one tournament's full desk into the cache. Only used when a tab is opened. "gone" means it no longer exists or this user no longer staffs it. */
export async function loadDesk(code: string): Promise<Loaded> {
  try {
    const response = await fetch(`/api/events/${encodeURIComponent(code)}/desk`, { cache: "no-store" });
    if (response.status === 403 || response.status === 404) return "gone";
    if (!response.ok) return "error";
    cacheDesk(code, (await response.json()) as DeskView);
    return "ok";
  } catch { return "error"; }
}

/** The public page data is enough for a tab's name, round and live mark. It is not the full desk and is never cached as one.
 *  `skip` is checked after the request: if that tab became the one on screen meanwhile, its own desk owns the label. */
interface PublicTab { name: string; phase: string; version: number; currentRound: { number: number; stage: string } | null }
const seen = new Map<string, number>();
export async function syncTab(code: string, skip: () => boolean): Promise<Loaded> {
  try {
    const known = seen.get(code);
    const response = await fetch(`/api/events/${encodeURIComponent(code)}${known === undefined ? "" : `?since=${known}`}`, { cache: "no-store" });
    if (skip()) return "ok";
    if (response.status === 404) return "gone";
    if (!response.ok) return "error";
    const body = (await response.json()) as Partial<PublicTab> & { unchanged?: boolean; version: number };
    if (skip()) return "ok";
    seen.set(code, body.version);
    if (!body.unchanged && typeof body.name === "string") {
      const round = body.currentRound;
      setTabMeta(code, { name: body.name, round: round ? `${round.stage === "playoff" ? "P" : "R"}${round.number}` : null, live: body.phase === "swiss" || body.phase === "playoff" });
    }
    return "ok";
  } catch { return "error"; }
}

/** Commands in flight on the desk on screen. A tab switch waits for them, so a failed save is still shown where it was made. */
let inFlight = 0, failures = 0;
let idleWaiters: (() => void)[] = [];
export const savesInFlight = () => inFlight;
export const saveFailures = () => failures;
export function saveStarted() { inFlight++; }
export function saveEnded(ok: boolean) {
  inFlight--; if (!ok) failures++;
  if (inFlight === 0) { const w = idleWaiters; idleWaiters = []; for (const f of w) f(); }
}
export const whenSavesDone = () => new Promise<void>(resolve => { if (inFlight === 0) resolve(); else idleWaiters.push(resolve); });

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const none: TabMeta[] = [];
export const useTabs = () => useSyncExternalStore(subscribe, () => tabs, () => none);

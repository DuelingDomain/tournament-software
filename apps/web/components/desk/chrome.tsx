"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { DeskView } from "@dd-tournament/engine";
import { useTabs } from "./desk-tabs";
import { Keycap, LogoMark } from "../ui";
import { MENUS, type Action, type MenuName, type Panel } from "./actions";
import { CheckIcon } from "./icons";
import { competitors, formatLabel, isTeamEvent, roundStats } from "./helpers";

/* ---------- Menu bar ---------- */
export function MenuBar({ actions, onPalette, brandHref }: { actions: Action[]; onPalette: () => void; brandHref: string }) {
  const [open, setOpen] = useState<MenuName | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(null); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  useEffect(() => {
    if (open) root.current?.querySelector<HTMLElement>(`[data-menu="${open}"] [role="menuitem"]`)?.focus();
  }, [open]);

  function onMenuKey(e: KeyboardEvent, name: MenuName) {
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>(`[data-menu="${name}"] [role="menuitem"]`) ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const idx = MENUS.indexOf(name);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); items.at(-1)?.focus(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); setOpen(MENUS[(idx + 1) % MENUS.length]!); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setOpen(MENUS[(idx - 1 + MENUS.length) % MENUS.length]!); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(null); root.current?.querySelector<HTMLElement>(`[data-btn="${name}"]`)?.focus(); }
    else if (e.key === "Tab") setOpen(null);
  }

  return <header className="dk-spine">
    <a className="dk-brand" href={brandHref} aria-label="DD Tournaments, my events"><LogoMark size={20} fill="var(--bg-surface)" /><span className="dd-display" style={{ fontSize: 14 }}>DD Tournaments</span></a>
    <nav ref={root} className="dk-menus" aria-label="Menu bar">
      {MENUS.map(name => {
        const items = actions.filter(a => a.menu === name);
        return <div key={name} className="dk-menu-wrap">
          <button type="button" className="dk-mbtn" data-btn={name} aria-haspopup="menu" aria-expanded={open === name}
            onClick={() => setOpen(open === name ? null : name)}
            onMouseEnter={() => { if (open && open !== name) setOpen(name); }}
            onKeyDown={e => { if (e.key === "ArrowDown") { e.preventDefault(); setOpen(name); } }}>{name}</button>
          {open === name && <div className="dk-menu" role="menu" aria-label={name} data-menu={name} onKeyDown={e => onMenuKey(e, name)}>
            {items.map((a, i) => <div key={a.id} style={{ display: "contents" }}>
              {a.separatorBefore && <div className="dk-msep" role="separator" />}
              {a.group && a.group !== items[i - 1]?.group && <div className="dk-mgroup" role="presentation">{a.group}</div>}
              <button type="button" role="menuitem" className="dk-mitem" aria-disabled={!a.enabled || undefined} title={!a.enabled ? a.reason : undefined}
                onClick={() => { if (!a.enabled) return; setOpen(null); a.run(); }}>
                <span>{a.group ? a.label.replace(`${a.group}: `, "") : a.label}</span>{a.keys && <Keycap>{a.keys}</Keycap>}
              </button>
            </div>)}
          </div>}
        </div>;
      })}
    </nav>
    <button type="button" className="dk-palette-hint" onClick={onPalette} aria-label="Open the command palette">Commands <Keycap>{mac ? "Cmd+." : "Ctrl+."}</Keycap></button>
  </header>;
}

/* ---------- Shortcuts tray ---------- */
type Tile = { action: string; label: string; key?: string; tone?: "rose" | "rose-outline" };
const GROUPS: { name: string; tiles: Tile[] }[] = [
  { name: "View", tiles: [{ action: "go-players", label: "Players", key: "F1" }, { action: "go-pairings", label: "Pairings", key: "F2" }, { action: "go-standings", label: "Standings", key: "F3" }] },
  { name: "Print", tiles: [{ action: "print-players", label: "Players", key: "F4" }, { action: "print-pairings", label: "Pairings", key: "F5" }, { action: "print-brackets", label: "Brackets", key: "F6" }, { action: "print-slips", label: "Result Slips", key: "F7" }, { action: "print-standings", label: "Standings", key: "F8" }] },
  { name: "Pair", tiles: [{ action: "pair", label: "Pair Round", key: "F9", tone: "rose" }, { action: "repair", label: "Re-pair Round", key: "F10" }, { action: "cut", label: "Pair Playoffs", key: "F11" }, { action: "cancel", label: "Cancel Round", key: "F12", tone: "rose-outline" }] },
  { name: "Wizards", tiles: [{ action: "print-batch", label: "Batch Print", key: "Ctrl+P" }, { action: "undrop", label: "Undrop Player" }, { action: "change", label: "Change Result" }] },
];
export function Tray({ actions, panel, team }: { actions: Action[]; panel: Panel; team?: boolean }) {
  const byId = new Map(actions.map(a => [a.id, a] as const));
  const viewOf: Record<string, Panel> = { "go-players": "players", "go-pairings": "pairings", "go-standings": "standings" };
  return <div className="dk-tray" role="toolbar" aria-label="Shortcuts">
    {GROUPS.map(g => <div key={g.name} className="dk-tray-col">
      <span className="dd-caps">{g.name}</span>
      <div className="dk-tray-grp" role="group" aria-label={g.name}>
        {g.tiles.map(t => {
          const a = byId.get(t.action);
          if (!a) return null;
          const label = team && t.action === "undrop" ? "Undrop Team" : t.label;
          return <button key={t.action} type="button" className={`dk-tile${t.tone ? ` dk-tile--${t.tone}` : ""}`} aria-disabled={!a.enabled || undefined}
            aria-pressed={viewOf[t.action] ? viewOf[t.action] === panel : undefined} title={!a.enabled ? a.reason : t.action === "pair" ? a.label : undefined}
            aria-keyshortcuts={t.key} onClick={() => { if (a.enabled) a.run(); }}>
            <span>{label}</span>{t.key ? <Keycap>{t.key}</Keycap> : <Keycap className="dk-nokey">·</Keycap>}
          </button>;
        })}
      </div>
    </div>)}
  </div>;
}

/* ---------- Binder tabs: All Players, then every tournament opened here, in the order opened ---------- */
export interface DeskNav { select: (code: string) => void; close: (code: string) => void; pending: string | null }
export function Binder({ code, view, setView, nav }: { code: string; view: "all" | "event"; setView: (v: "all" | "event") => void; nav: DeskNav }) {
  const tabs = useTabs();
  const strip = useRef<HTMLElement>(null);
  // Keep the chosen tab inside the strip when many tournaments are open.
  useEffect(() => {
    const el = strip.current, cur = el?.querySelector<HTMLElement>('[aria-current="page"]')?.closest<HTMLElement>(".dk-tab");
    if (!el || !cur) return;
    if (cur.offsetLeft < el.scrollLeft) el.scrollLeft = cur.offsetLeft - 8;
    else if (cur.offsetLeft + cur.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = cur.offsetLeft + cur.offsetWidth - el.clientWidth + 8;
  }, [code, view, tabs.length]);
  return <nav className="dk-binder dd-tabs" aria-label="Tournaments" ref={strip}>
    <button type="button" className="dd-tab dd-tab--narrow" aria-current={view === "all" ? "page" : undefined} onClick={() => setView("all")}>All Players</button>
    {tabs.map(t => {
      const here = t.code === code;
      return <div key={t.code} className="dd-tab dk-tab" data-code={t.code} data-current={here && view === "event" ? "" : undefined}
        onAuxClick={e => { if (e.button === 1) { e.preventDefault(); nav.close(t.code); } }}>
        <a className="dk-tab-link" href={`/e/${encodeURIComponent(t.code)}/desk`} aria-current={here && view === "event" ? "page" : undefined} aria-busy={nav.pending === t.code || undefined}
          onClick={e => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            if (here) setView("event"); else nav.select(t.code);
          }}>
          {t.live && <span className="dd-pip" aria-hidden="true" />}
          <span className="dk-tab-name">{t.name}</span>
          {t.round && <span className="dd-chip dd-chip--muted">{t.round}<span className="dk-visually-hidden">{t.live ? ", running" : ""}</span></span>}
        </a>
        <button type="button" className="dk-tab-x" aria-label={`Close ${t.name}`} title="Close tournament" onClick={() => nav.close(t.code)}>×</button>
      </div>;
    })}
  </nav>;
}

/* ---------- Sticky status bar ---------- */
/** `confirmation` is the last success message ("Tournament settings updated."); it shows here so the panel above never shifts. */
export function StatusBar({ desk, saving, note, onDismiss, confirmation = null }: { desk: DeskView; saving: number; note: string | null; onDismiss: () => void; confirmation?: string | null }) {
  const { state } = desk;
  const round = state.rounds.at(-1);
  const stats = roundStats(state, round);
  const all = competitors(state);
  const active = all.filter(p => p.status === "active").length;
  return <footer className="dk-status-bar" role="status" aria-live="polite">
    <span><b>{active}</b> Active of <b>{all.length}</b> Total {isTeamEvent(state) ? "Teams" : "Players"}</span><i className="dk-sq" aria-hidden="true" />
    {round ? <><span>Round <b>{round.number}</b>{round.stage === "playoff" ? " Playoffs" : ""}</span><i className="dk-sq" aria-hidden="true" />
      <span><b>{stats.unreported}</b> Unreported Matches (<b>{stats.reported}</b> Reported)</span><i className="dk-sq" aria-hidden="true" /></>
      : <><span>Tournament Not Started</span><i className="dk-sq" aria-hidden="true" /></>}
    <span>{formatLabel(state)}</span>
    {state.phase === "complete" && <><i className="dk-sq" aria-hidden="true" /><span>Finalized</span></>}
    <span className="dk-saved">
      {confirmation && <span className="dk-note-quiet">{confirmation}</span>}
      {note && <span className="dk-note-quiet">{note} <button type="button" className="dd-btn dd-btn--link dd-btn--sm" onClick={onDismiss}>Dismiss</button></span>}
      <span>{saving > 0 ? "Saving…" : <><CheckIcon size={13} color="var(--success)" /> Saved</>}</span>
    </span>
  </footer>;
}

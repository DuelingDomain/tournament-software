"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ButtonLink, ConfirmDialog, Dialog, Tabs, type TabItem } from "../ui";
import "./desk.css";
import { actionForKey, buildActions, pairInfo, type ConfirmKind, type DialogKind, type ExportKind, type Panel, type PrintKind } from "./actions";
import { AllPlayersPanel } from "./all-players-panel";
import { Binder, MenuBar, StatusBar, Tray } from "./chrome";
import {
  AddTestPlayersDialog, BatchPrintDialog, ChangeResultDialog, CutDialog, DropPlayerDialog, ReEnrollDialog, SeatsDialog, HistoryDialog, ImportDialog, IntegrityDialog, KeyboardDialog, LogDialog, ManualPairingsDialog, PlayerNotesDialog, TimerDialog, UndropDialog,
} from "./dialogs";
import { postDummy } from "./dummy";
import { isTemporaryMemberId } from "@dd-tournament/engine";
import { JudgingPanel } from "./judging-panel";
import { Palette } from "./palette";
import { PairingsPanel } from "./pairings-panel";
import { PlayersPanel } from "./players-panel";
import { TeamsPanel } from "./teams-panel";
import { SharingSections } from "./settings-panel";
import { TournamentDialog } from "./tournament-dialog";
import { StandingsPanel } from "./standings-panel";
import { isTeamEvent, roundStats } from "./helpers";
import { can } from "./roles";
import { useDesk } from "./use-desk";

/** Fetch the file first, so a failed export shows an error here and never saves the error text as a file. */
async function downloadExport(code: string, kind: ExportKind, notify: (text: string, bad?: boolean) => void) {
  try {
    const res = await fetch(`/api/events/${encodeURIComponent(code)}/export/${kind}`, { cache: "no-store" });
    if (!res.ok) { notify(res.status === 403 || res.status === 401 ? "You do not have access to this export." : "The export failed. Nothing was saved. Try again.", true); return; }
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `${code}-${kind}`;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch { notify("The export failed. Check your connection. Nothing was saved.", true); }
}
const modalOpen = () => !!document.querySelector("dialog[open]");

function Centered({ title, children }: { title: string; children?: React.ReactNode }) {
  return <main className="dk dk-center"><h1 className="dk-h2">{title}</h1>{children}</main>;
}

export function Desk({ code }: { code: string }) {
  const { desk, state, saving, note, send, replaceDesk, dismissNote } = useDesk(code);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [view, setView] = useState<"all" | "event">("event");
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [importKind, setImportKind] = useState<"tournament" | "players" | "team-players" | null>(null);
  const [palette, setPalette] = useState(false);
  const [includeDropped, setIncludeDropped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ text: string; bad: boolean } | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((text: string, bad = false) => {
    setFlash({ text, bad });
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 6000);
  }, []);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const role = desk?.viewerRole ?? "staff";
  const active: Panel = panel ?? (desk && (role === "staff" || desk.state.rounds.length === 0) ? "players" : "pairings");
  const panelKey = `dk:panel:${code}`;
  useEffect(() => { try { const v = localStorage.getItem(panelKey); if (v === "players" || v === "pairings" || v === "standings") setPanel(v); } catch { /* storage unavailable */ } }, [panelKey]);
  const go = useCallback((p: Panel) => { setPanel(p); setView("event"); try { localStorage.setItem(panelKey, p); } catch { /* storage unavailable */ } }, [panelKey]);

  const doPair = useCallback(async () => {
    const r = await send({ type: "PairNextRound" });
    if (!r.ok) { notify(r.message, true); return; }
    const n = r.desk.state.rounds.at(-1);
    notify(n ? `Round ${n.number} paired. ${n.matches.length} matches.` : "Paired.");
    go("pairings");
    window.setTimeout(() => window.dispatchEvent(new Event("dk:focus-slot")), 30);
  }, [send, notify, go]);

  const actions = useMemo(() => desk ? buildActions(desk, role, {
    go, open: setDialog, confirm: setConfirm,
    print: (k: PrintKind) => { window.open(`/e/${encodeURIComponent(code)}/print/${k === "pairings-by-player" ? "pairings?by=player" : k}`, "_blank", "noopener"); },
    download: (k: ExportKind) => { void downloadExport(code, k, notify); },
    importFile: setImportKind, pair: () => void doPair(), palette: () => setPalette(true), home: () => { window.location.assign("/"); },
    dummyResults: () => { void (async () => {
      const r = await postDummy(code, desk, { action: "results" });
      if (!r.ok) { if (r.desk) replaceDesk(r.desk); notify(r.message, true); return; }
      replaceDesk(r.desk); notify(`Random results entered for ${r.count} ${r.count === 1 ? "match" : "matches"}.`);
    })(); },
  }) : [], [desk, role, code, go, doPair, replaceDesk, notify]);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // Desk-wide keys. Capture phase so the browser's own F-key and Ctrl+F handling never wins.
  useEffect(() => {
    if (state !== "ready") return;
    const onKey = (e: KeyboardEvent) => {
      const id = actionForKey(e);
      if (!id) return;
      if (modalOpen()) { if (!(e.key.startsWith("F") && e.key.length > 1)) return; e.preventDefault(); return; }
      e.preventDefault(); e.stopPropagation();
      const a = actionsRef.current.find(x => x.id === id);
      if (!a) return;
      if (a.enabled) a.run(); else if (a.reason) notify(`${a.label}: ${a.reason}`, true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [state, notify]);

  useEffect(() => { if (desk) document.title = `${desk.state.settings.name} · Desk`; }, [desk?.state.settings.name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === "loading") return <Centered title="Loading the desk"><div className="dk-spin" role="status" aria-label="Loading" /></Centered>;
  if (state === "signed_out") return <Centered title="Sign in to open the desk"><p className="dd-meta">The desk is for the people running this tournament.</p>
    <ButtonLink variant="rose" size="lg" href={`/auth/start?return=${encodeURIComponent(`/e/${code}/desk`)}`}>Sign in with Dueling Domain</ButtonLink></Centered>;
  if (state === "forbidden") return <Centered title="You are not staff for this tournament"><p className="dd-meta">Ask the organizer to add you under Settings, Staff and roles.</p>
    <ButtonLink href={`/e/${encodeURIComponent(code)}/me`}>Open my player page</ButtonLink></Centered>;
  if (state === "missing") return <Centered title="No tournament with that code"><ButtonLink href="/">My tournaments</ButtonLink></Centered>;
  if (state === "error" || !desk) return <Centered title="The desk could not load"><p className="dd-meta">Check your connection, then try again.</p><Button variant="violet" onClick={() => window.location.reload()}>Reload</Button></Centered>;

  const pair = pairInfo(desk, role, () => void doPair());
  const sendCmd = async (cmd: Parameters<typeof send>[0], ok: string) => {
    setBusy(true); const r = await send(cmd); setBusy(false); setConfirm(null);
    notify(r.ok ? ok : r.message, !r.ok);
  };
  const close = () => setDialog(null);
  const done = (t: string) => notify(t);
  const tempIds = desk.state.players.filter(p => p.memberId !== null && isTemporaryMemberId(p.memberId)).length;
  const lastRound = desk.state.rounds.at(-1);
  const afterSwissCut = !!lastRound && desk.state.swissCuts.some(c => c.afterRound === lastRound.number - 1 && c.roundPairedAfter);
  const firstPlayoff = desk.state.rounds.at(-1)?.stage === "playoff" && desk.state.rounds.filter(r => r.stage === "playoff").length === 1;

  const tabs: TabItem[] = [
    { id: "players", label: "Players", keyHint: "F1", panelId: "dk-panel" },
    { id: "pairings", label: "Pairings", keyHint: "F2", panelId: "dk-panel" },
    { id: "standings", label: "Standings", keyHint: "F3", panelId: "dk-panel" },
  ];
  const stats = roundStats(desk.state, desk.state.rounds.at(-1));

  return <div className="dk">
    <MenuBar actions={actions} onPalette={() => setPalette(true)} brandHref="/" />
    <Tray actions={actions} panel={active} />
    <Binder code={code} desk={desk} view={view} setView={setView} />
    <main className="dk-main" id="main">
      <div className="dk-sheet">
        {view === "event" && <Tabs className="dk-panel-tabs" variant="index" label="Desk sections" items={tabs} value={active} onChange={id => go(id as Panel)} />}
        {flash && <p role={flash.bad ? "alert" : "status"} className={`dk-note ${flash.bad ? "dk-note--bad" : ""}`}>{flash.text}</p>}
        <div id="dk-panel" role="tabpanel" aria-label={view === "all" ? "All Players" : tabs.find(t => t.id === active)?.label as string} className="dk-sec">
          {view === "all" ? <AllPlayersPanel code={code} desk={desk} role={role} send={send} notify={notify} />
            : active === "players" ? (isTeamEvent(desk.state) ? <TeamsPanel code={code} desk={desk} role={role} send={send} notify={notify} /> : <PlayersPanel code={code} desk={desk} role={role} send={send} notify={notify} />)
            : active === "pairings" ? <PairingsPanel desk={desk} role={role} send={send} pair={pair} onRepair={() => setConfirm("repair")} onTimer={() => setDialog("timer")} onManual={() => setDialog("manual")} notify={notify} />
            : active === "standings" ? <StandingsPanel desk={desk} role={role} send={send} notify={notify} includeDropped={includeDropped} setIncludeDropped={setIncludeDropped} />
            : null}
        </div>
      </div>
    </main>
    <StatusBar desk={desk} saving={saving} note={note} onDismiss={dismissNote} />

    {palette && <Palette actions={actions} onClose={() => setPalette(false)} />}
    {dialog === "timer" && <TimerDialog desk={desk} role={role} send={send} onClose={close} />}
    {dialog === "cut" && <CutDialog desk={desk} send={send} onClose={close} onDone={t => { done(t); go("pairings"); }} />}
    {dialog === "undrop" && <UndropDialog desk={desk} send={send} onClose={close} onDone={done} />}
    {dialog === "change" && <ChangeResultDialog desk={desk} send={send} onClose={close} onDone={done} />}
    {dialog === "manual" && <ManualPairingsDialog desk={desk} send={send} onClose={close} />}
    {dialog === "print" && <BatchPrintDialog code={code} onClose={close} />}
    {dialog === "keys" && <KeyboardDialog onClose={close} />}
    {dialog === "integrity" && <IntegrityDialog desk={desk} onClose={close} />}
    {dialog === "notes" && <PlayerNotesDialog desk={desk} role={role} send={send} onClose={close} />}
    {dialog === "dummy-players" && <AddTestPlayersDialog code={code} desk={desk} replaceDesk={replaceDesk} onClose={close} onDone={t => notify(t)} />}
    {dialog === "settings" && <TournamentDialog mode="update" desk={desk} role={role} send={send} onClose={close} onDone={done}
      extra={<SharingSections code={code} desk={desk} role={role} onNote={(t, bad) => notify(t, bad)} />} />}
    {dialog === "judging" && <Dialog open onClose={close} title="Judging: Penalties" actions={<Button onClick={close}>Close</Button>}><span className="dk-dlg-wide" hidden />
      <JudgingPanel desk={desk} role={role} send={send} /></Dialog>}
    {dialog === "drop" && <DropPlayerDialog desk={desk} send={send} onClose={close} onDone={done} />}
    {dialog === "reenroll" && <ReEnrollDialog desk={desk} send={send} onClose={close} onDone={done} />}
    {dialog === "seats" && <SeatsDialog desk={desk} send={send} onClose={close} />}
    {dialog === "log" && <LogDialog code={code} state={desk.state} onClose={close} />}
    {dialog === "history" && <HistoryDialog state={desk.state} onClose={close} />}
    {importKind && <ImportDialog code={code} kind={importKind} onClose={() => setImportKind(null)} onDone={done} replaceDesk={replaceDesk} />}

    <ConfirmDialog open={confirm === "repair"} title="Re-pair this round?" confirmLabel="Re-pair round" busy={busy} onCancel={() => setConfirm(null)}
      message={<>Round pairings and tables are thrown away and drawn again.{stats.reported > 0 ? <b style={{ color: "var(--rose-2)", fontWeight: 600 }}> {stats.reported} entered {stats.reported === 1 ? "result" : "results"} in this round will be deleted.</b> : null}</>}
      onConfirm={() => void sendCmd({ type: "RepairRound", round: desk.state.rounds.at(-1)?.number }, "Round re-paired.")} />
    <ConfirmDialog open={confirm === "cancel"} title="Cancel the current round?" confirmLabel="Cancel round" busy={busy} onCancel={() => setConfirm(null)}
      message={<>Round {desk.state.rounds.at(-1)?.number} and its {stats.reported} reported {stats.reported === 1 ? "result" : "results"} are deleted.{firstPlayoff ? " Cancelling the first playoff round also undoes the cut." : ""}{afterSwissCut ? " Players cut before this round return." : ""} This cannot be undone.</>}
      onConfirm={() => void sendCmd({ type: "CancelRound" }, "Round cancelled.")} />
    <ConfirmDialog open={confirm === "finish"} title="Finalize the tournament?" confirmLabel="Finalize tournament" busy={busy} onCancel={() => setConfirm(null)} confirmVariant="violet"
      message={<>{tempIds > 0 ? <b style={{ color: "var(--rose-2)", fontWeight: 600 }}>{tempIds} {tempIds === 1 ? "player has" : "players have"} a temporary ID. </b> : null}Standings lock and players see the final results. You can reopen the tournament afterwards.</>}
      onConfirm={() => void sendCmd({ type: "CompleteEvent" }, "Tournament finalized.")} />
    <ConfirmDialog open={confirm === "reopen"} title="Reopen the tournament?" confirmLabel="Reopen tournament" busy={busy} onCancel={() => setConfirm(null)} confirmVariant="violet"
      message="Staff can enter results and pair rounds again."
      onConfirm={() => void sendCmd({ type: "ReopenEvent" }, "Tournament reopened.")} />
  </div>;
}

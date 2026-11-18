"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeskView, Match, MatchResult, Player, StaffRole, Team } from "@dd-tournament/engine";
import { BigKeycap, Button, Checkbox, ConfirmDialog, EmptyStamp, Field, Keycap, Select, Stamp, type StampKind } from "../ui";
import { CheckIcon, WarnIcon } from "./icons";
import {
  KEY_OF, RESULT_KEY, STAMP_TEXT, byName, clockLabel, competitors, describeResult, dropCommand, formatClock, hasEnteredResult,
  isTeamEvent, pendingReport, playerById, recordsBefore, roundTitle, undropCommand, winnerText, type Entry,
} from "./helpers";
import { can } from "./roles";
import type { SendFn } from "./use-desk";

export interface PairInfo { label: string; enabled: boolean; note: string; run: () => void }
interface Props {
  desk: DeskView; role: StaffRole; send: SendFn; pair: PairInfo;
  onRepair: () => void; onTimer: () => void; onManual: () => void; notify: (message: string) => void;
}
interface Echo { kind: "info" | "ok" | "error"; text: string }
interface UndoEntry { matchId: string; table: number | null; prev: MatchResult | null; dropped: string[] }
type Competitor = Player | Team;
type Row = { match: Match; left: Competitor; right: Competitor | null; flipped: boolean };
const span = (tables: number[]) => (tables.length > 1 ? `${tables[0]}–${tables.at(-1)}` : String(tables[0] ?? "—"));

const KEYS: { kind: Exclude<Entry, null> | "clear"; key: string }[] = [
  { kind: "p1", key: "-" }, { kind: "p2", key: "+" }, { kind: "draw", key: "*" }, { kind: "double_loss", key: "/" }, { kind: "clear", key: "$" },
];
const flip = (r: MatchResult | null): MatchResult | null => (r === "p1" ? "p2" : r === "p2" ? "p1" : r);
const stampKind = (r: MatchResult): StampKind => (r === "bye_win" || r === "bye_loss" ? "bye" : r);

const MemberLine = ({ names }: { names: string[] }) => (names.length ? <span className="dk-members">{names.join(" · ")}</span> : null);

export function PairingsPanel({ desk, role, send, pair, onRepair, onTimer, onManual, notify }: Props) {
  const { state } = desk;
  const rounds = state.rounds;
  const current = rounds.at(-1);
  const [viewRound, setViewRound] = useState(current?.number ?? 0);
  const [slot, setSlot] = useState("");
  const [hideDone, setHideDone] = useState(false);
  const [byPlayer, setByPlayer] = useState(false);
  const [echo, setEcho] = useState<Echo | null>(null);
  const [stack, setStack] = useState<UndoEntry[]>([]);
  const [pressed, setPressed] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState<{ kind: Entry; withDrop: boolean; match: Match; was: MatchResult; table: number | null; round: number } | null>(null);
  const [history, setHistory] = useState<Record<string, string>>({});
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const slotRef = useRef<HTMLInputElement>(null);
  const pressTimer = useRef<number | undefined>(undefined);
  const canEnter = can(role, "EnterResult");
  const finished = state.phase === "complete";

  useEffect(() => { setViewRound(current?.number ?? 0); setStack([]); }, [current?.number]);
  useEffect(() => { if (!current?.endsAt) return; const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, [current?.endsAt]);
  useEffect(() => () => window.clearTimeout(pressTimer.current), []);

  const reselect = useCallback(() => { window.setTimeout(() => { slotRef.current?.focus(); slotRef.current?.select(); }, 0); }, []);
  useEffect(() => { reselect(); const on = () => reselect(); window.addEventListener("dk:focus-slot", on); return () => window.removeEventListener("dk:focus-slot", on); }, [reselect]);

  const team = isTeamEvent(state);
  const byId = useMemo(() => playerById(state), [state]);
  // Team matches hold several tables and list each side's members; the server already worked those out for printing.
  const printById = useMemo(() => new Map(desk.printData.matches.map(m => [m.id, m] as const)), [desk.printData.matches]);
  const tablesOf = (m: Match) => { const t = printById.get(m.id)?.tables; return t && t.length ? t : m.table === null ? [] : [m.table]; };
  const membersFor = (m: Match, id: string) => { const pm = printById.get(m.id); return (pm?.p1.id === id ? pm.p1 : pm?.p2?.id === id ? pm.p2 : null)?.members.map(x => x.name) ?? []; };
  const name = useCallback((id: string) => byId.get(id)?.name ?? "Unknown", [byId]);
  const round = rounds.find(r => r.number === viewRound);
  const records = useMemo(() => recordsBefore(state, viewRound), [state, viewRound]);
  const isCurrent = round?.number === current?.number;

  const matchByTable = useMemo(() => new Map((round?.matches ?? []).flatMap(m => (m.table === null ? [] : (printById.get(m.id)?.tables?.length ? printById.get(m.id)!.tables : [m.table]).map(t => [t, m] as const)))), [round, printById]);
  const slotNumber = slot === "" ? null : Number.parseInt(slot, 10);
  const selected = slotNumber === null ? null : matchByTable.get(slotNumber) ?? null;

  const rows = useMemo<Row[]>(() => {
    const matches = (round?.matches ?? []).filter(m => !(hideDone && m.result !== null));
    const withPlayers = matches.flatMap(m => {
      const p1 = byId.get(m.p1); const p2 = m.p2 === null ? null : byId.get(m.p2) ?? null;
      return p1 ? [{ match: m, left: p1, right: p2, flipped: false } satisfies Row] : [];
    });
    if (!byPlayer) return withPlayers.sort((a, b) => (a.match.table ?? 1e9) - (b.match.table ?? 1e9));
    const both = withPlayers.flatMap(r => r.right ? [r, { match: r.match, left: r.right, right: r.left, flipped: true } satisfies Row] : [r]);
    return both.sort((a, b) => byName(a.left, b.left));
  }, [round, hideDone, byPlayer, byId]);

  const stats = useMemo(() => {
    const matches = round?.matches ?? [];
    const unreported = matches.filter(m => m.result === null);
    return { total: matches.length, reported: matches.length - unreported.length, open: unreported.filter(m => m.table !== null).map(m => m.table!).sort((a, b) => a - b) };
  }, [round]);

  const alerts = useMemo(() => {
    if (!current || viewRound !== current.number) return [] as { key: string; text: string; table: string | null; repair: boolean }[];
    const out: { key: string; text: string; table: string | null; repair: boolean }[] = [];
    for (const r of desk.integrity.repeatMatches) {
      if (!r.rounds.includes(current.number)) continue;
      const match = current.matches.find(m => (m.p1 === r.a && m.p2 === r.b) || (m.p1 === r.b && m.p2 === r.a));
      out.push({ key: `repeat:${r.a}:${r.b}`, text: `${name(r.a)} and ${name(r.b)} have played ${r.rounds.length === 2 ? "twice" : `${r.rounds.length} times`} (rounds ${r.rounds.join(", ")})`, table: match?.table != null ? `Table ${match.table}` : null, repair: true });
    }
    for (const t of desk.integrity.pairedTwiceInRound.filter(p => p.round === current.number)) out.push({ key: `twice:${t.playerId}`, text: `${name(t.playerId)} is paired more than once in round ${t.round}`, table: null, repair: true });
    if (desk.integrity.unpairedActive.length) out.push({ key: `unpaired:${desk.integrity.unpairedActive.join(",")}`, text: `${desk.integrity.unpairedActive.length === 1 ? "1 active player is" : `${desk.integrity.unpairedActive.length} active players are`} not paired: ${desk.integrity.unpairedActive.map(name).join(", ")}`, table: null, repair: false });
    return out.filter(a => !dismissed.includes(a.key));
  }, [desk.integrity, current, viewRound, dismissed, name]);

  const commit = useCallback(async (kind: Entry, withDrop: boolean, target?: Match, confirmed = false) => {
    reselect();
    if (!canEnter) { setEcho({ kind: "error", text: "Your role cannot enter results." }); return; }
    const match = target ?? (slotNumber === null ? undefined : matchByTable.get(slotNumber));
    if (!match) { setEcho({ kind: "error", text: `No table ${slot || "?"} in round ${viewRound}` }); return; }
    if (match.p2 === null) { setEcho({ kind: "error", text: "A bye is scored automatically." }); return; }
    if (round?.stage === "playoff" && (kind === "draw" || kind === "double_loss")) { setEcho({ kind: "error", text: "Playoff matches cannot be a draw or a double loss." }); return; }
    // Changing a result in an earlier round is rare and easy to do by accident: ask once.
    if (!confirmed && round && round.number !== current?.number && match.result !== null && match.result !== kind) {
      setOverwrite({ kind, withDrop, match, was: match.result, table: match.table, round: round.number }); return;
    }
    const drop = withDrop ? (kind === "p1" || kind === "p2" ? "loser" : kind === "double_loss" ? "both" : "none") : "none";
    setEcho({ kind: "info", text: `Saving Table ${match.table}…` });
    setPressed(kind ?? "clear"); window.clearTimeout(pressTimer.current); pressTimer.current = window.setTimeout(() => setPressed(null), 120);
    const res = await send(d => {
      const live = d.state.rounds.flatMap(r => r.matches).find(m => m.id === match.id);
      return live ? { type: "EnterResult", matchId: live.id, result: kind, drop } : null;
    }, { retry: true });
    if (!res.ok) { setEcho({ kind: "error", text: res.code === "noop" ? `Table ${match.table} changed. Check the pairings and try again.` : res.message }); return; }
    const was = res.before.state.rounds.flatMap(r => r.matches).find(m => m.id === match.id);
    const names = playerById(res.desk.state);
    const p1 = names.get(match.p1)?.name ?? "Player 1", p2 = names.get(match.p2)?.name ?? "Player 2";
    const dropped = competitors(res.desk.state).filter(p => p.status === "dropped" && competitors(res.before.state).find(b => b.id === p.id)?.status === "active").map(p => p.id);
    let text = describeResult(match.table, kind, p1, p2);
    if (dropped.length) text += ` ${dropped.map(id => names.get(id)?.name ?? "").join(" and ")} drop${dropped.length === 1 ? "s" : ""}.`;
    if (was?.result && was.result !== kind) text += ` Replaces: ${winnerText(was, p1, p2)}.`;
    setEcho({ kind: "ok", text });
    setStack(s => [...s.slice(-19), { matchId: match.id, table: match.table, prev: was?.result ?? null, dropped }]);
    setHistory(h => ({ ...h, [match.id]: `${new Date().toTimeString().slice(0, 5)} entered at desk ( ${withDrop && kind ? "Ctrl + " : ""}${kind ? KEY_OF[kind] : "$"} )` }));
  }, [canEnter, matchByTable, reselect, send, slot, slotNumber, viewRound, round, current?.number]);

  const undo = useCallback(async () => {
    const entry = stack.at(-1);
    if (!entry) { notify("Nothing to undo."); return; }
    setStack(s => s.slice(0, -1));
    const res = await send(d => d.state.rounds.some(r => r.matches.some(m => m.id === entry.matchId))
      ? { type: "EnterResult", matchId: entry.matchId, result: entry.prev, drop: "none" } : null, { retry: true });
    if (!res.ok) { setEcho({ kind: "error", text: res.code === "noop" ? "That match was re-paired, so it cannot be undone." : res.message }); return; }
    for (const id of entry.dropped) await send(d => playerById(d.state).get(id)?.status === "dropped" ? undropCommand(isTeamEvent(d.state), id, "next_round") : null);
    setSlot(entry.table === null ? "" : String(entry.table)); reselect();
    setEcho({ kind: "info", text: `Undone · Table ${entry.table} is back to ${entry.prev ? STAMP_TEXT[entry.prev] : "Unreported"}` });
  }, [stack, send, notify, reselect]);

  // Result keys work anywhere on the desk while this panel shows (not inside other fields or dialogs).
  const live = useRef({ commit, undo });
  live.current = { commit, undo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("[role='menu']")) return;
      const inField = !!target && target !== slotRef.current && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
      if (inField) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.altKey) return;
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); void live.current.undo(); return; }
      if (Object.hasOwn(RESULT_KEY, e.key)) { e.preventDefault(); void live.current.commit(RESULT_KEY[e.key] ?? null, ctrl); return; }
      if (!ctrl && /^[0-9]$/.test(e.key) && target !== slotRef.current) {
        e.preventDefault(); setSlot(e.key); slotRef.current?.focus();
      }
      if (e.key === "Escape" && target === slotRef.current) setSlot("");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const toggleDrop = (p: Competitor) => {
    void send(p.status === "dropped" ? undropCommand(team, p.id, "next_round") : dropCommand(team, p.id)).then(r => !r.ok && setEcho({ kind: "error", text: r.message }));
  };
  const dropRight = (p: Competitor) => can(role, p.status === "dropped" ? (team ? "UndropTeam" : "UndropPlayer") : (team ? "DropTeam" : "DropPlayer"));

  const remaining = current?.endsAt ? Date.parse(current.endsAt) - now : null;
  const total = current?.endsAt && current.startedAt ? Date.parse(current.endsAt) - Date.parse(current.startedAt) : null;
  const s1 = selected && byId.get(selected.p1);
  const s2 = selected?.p2 ? byId.get(selected.p2) : null;
  const selNote = selected ? [history[selected.id], ...selected.reports.map(r => `${new Date(r.at).toTimeString().slice(0, 5)} ${name(r.by)} reported ${s1 && s2 ? winnerText({ ...selected, result: r.result }, s1.name, s2.name) : r.result} in player app`),
    selected.extensionMinutes > 0 ? `+${selected.extensionMinutes} min extension` : ""].filter(Boolean) : [];

  return <div className="dk-cols" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
    <div className="dk-slip dk-entry">
      <div className="dk-entry-row">
        <label className="dk-slot-label dd-caps" htmlFor="table-slot">Table
          <input id="table-slot" ref={slotRef} className="dd-input dd-input--slot" type="text" inputMode="numeric" autoComplete="off" value={slot}
            aria-describedby="key-help echo"
            onChange={e => setSlot(e.target.value.replace(/\D/g, "").slice(0, 6))} />
        </label>
        <div role="group" aria-label="Result keys" className="dk-keys">
          {KEYS.map(k => <BigKeycap key={k.kind} keyLabel={k.key} down={pressed === k.kind}
            caption={k.kind === "p1" ? `${s1?.name ?? "P1"} wins` : k.kind === "p2" ? `${s2?.name ?? "P2"} wins` : k.kind === "draw" ? "Draw" : k.kind === "double_loss" ? "Dbl loss" : "Unreported"}
            aria-label={`${k.kind === "p1" ? "Player 1 wins" : k.kind === "p2" ? "Player 2 wins" : k.kind === "draw" ? "Draw" : k.kind === "double_loss" ? "Double loss" : "Unreported"} (${k.key})`}
            disabled={!canEnter || finished || (round?.stage === "playoff" && (k.kind === "draw" || k.kind === "double_loss"))} onClick={() => void commit(k.kind === "clear" ? null : k.kind, false)} />)}
        </div>
        <div className="dk-vr" aria-hidden="true" />
        <Field label="Round">
          <Select compact value={viewRound} onChange={e => { const n = Number(e.target.value); setViewRound(n); setSlot(""); if (n !== current?.number) setHideDone(false); }} aria-label="Round">
            {rounds.map(r => <option key={r.number} value={r.number}>{roundTitle(r)}</option>)}
            {rounds.length === 0 && <option value={0}>No rounds yet</option>}
          </Select>
        </Field>
        <div className="dk-checks">
          <Checkbox label="Hide Completed Matches" checked={hideDone} onChange={e => setHideDone(e.target.checked)} />
          <Checkbox label={team ? "View by Team" : "View by Player"} checked={byPlayer} onChange={e => setByPlayer(e.target.checked)} />
        </div>
        {isCurrent && current && (remaining === null
          ? <button type="button" className="dk-timer dk-timer--idle" onClick={onTimer} disabled={!can(role, "StartTimer")}>Start round timer</button>
          : <button type="button" className={`dk-timer${remaining < 0 ? " dk-timer--over" : ""}`} onClick={onTimer} role="timer" aria-label={`Round timer, ${clockLabel(remaining)}`}>
            <span className="dd-pip" aria-hidden="true" style={remaining < 0 ? { background: "var(--rose-2)" } : undefined} />
            {remaining < 0 ? "-" : ""}{formatClock(remaining)}{remaining < 0 && <span> over</span>}{total !== null && <small>/ {formatClock(total)}</small>}
          </button>)}
      </div>
      <div className="dk-echo-row">
        <p id="echo" role="status" className={`dk-echo${echo?.kind === "error" ? " dk-echo--error" : ""}`}>
          {echo?.kind === "ok" && <CheckIcon size={16} color="var(--success)" />}
          {echo?.kind === "error" && <WarnIcon size={16} />}
          {echo?.kind === "ok" && <b style={{ fontWeight: 600 }}>Just committed:</b>}
          <span>{echo?.text ?? (selected && s1 ? `Table ${selected.table}: ${s1.name}${s2 ? ` vs ${s2.name}` : ""} · ${selected.result ? STAMP_TEXT[selected.result] : "Unreported"}` : isCurrent ? "Type a table number, then a result key." : "")}</span>
          {stack.length > 0 && echo?.kind === "ok" && <button type="button" className="dk-undo" onClick={() => void undo()}>Undo<Keycap>Ctrl+Z</Keycap></button>}
        </p>
        <p id="key-help" className="dk-help">Type a table, then a key · <Keycap>Ctrl</Keycap> + key also drops the loser (both on <Keycap>/</Keycap>) · <Keycap>+</Keycap> or <Keycap>=</Keycap> for P2</p>
      </div>
    </div>

    <div className="dk-cols">
      <div className="dk-col-main">
        {alerts.map(a => <div key={a.key} role="alert" className="dk-warn">
          <WarnIcon /><span className="dd-caps">Integrity</span><span className="dk-warn-text">{a.text}</span>
          {a.table && <span className="dd-meta">{a.table}</span>}
          {a.repair && can(role, "RepairRound") && !hasEnteredResult(current) && <Button size="sm" onClick={onRepair} keyHint="F10">Re-pair Round</Button>}
          {can(role, "SwapPlayers") && <Button size="sm" onClick={onManual}>Manual Pairings</Button>}
          <Button size="sm" onClick={() => setDismissed(d => [...d, a.key])}>Keep pairing</Button>
        </div>)}
        <div className="dd-scroll-x"><div className="dk-grid">
          <div aria-hidden="true" className="dk-gh dd-caps"><span>Table</span><span>{team ? "Team 1" : "Player 1"}</span><span>{team ? "Team 2" : "Player 2"}</span><span>Result</span></div>
          {rows.length === 0 && <p className="dk-empty">{rounds.length === 0 ? "No round has been paired yet. Press F9 to pair round 1." : hideDone ? "Every match is reported." : "No matches."}</p>}
          <ol aria-label={round ? `${roundTitle(round)} matches` : "Matches"} className="dk-list">
            {rows.map(({ match: m, left, right, flipped }) => {
              const bye = m.p2 === null;
              const shown = flipped ? flip(m.result) : m.result;
              const pend = pendingReport(m, name);
              const sel = !bye && m.id === selected?.id;
              const leftWin = shown === "p1" || shown === "bye_win", rightWin = shown === "p2";
              const content = <>
                <span className="dk-tnum" data-multi={tablesOf(m).length > 1}>{m.table === null ? "—" : span(tablesOf(m))}</span>
                <span className="dk-pname"><b data-win={leftWin}>{left.name}</b><span className="dk-rec">{records.get(left.id)}</span>{left.status === "dropped" && <span className="dk-tag">Drop</span>}{team && <MemberLine names={membersFor(m, left.id)} />}</span>
                <span className="dk-pname">{right ? <><b data-win={rightWin}>{right.name}</b><span className="dk-rec">{records.get(right.id)}</span>{right.status === "dropped" && <span className="dk-tag">Drop</span>}{team && <MemberLine names={membersFor(m, right.id)} />}</> : <span className="dk-rec">Bye</span>}</span>
                <span className="dk-res">
                  {shown !== null ? <Stamp kind={stampKind(shown)} size="sm" key={`${m.id}:${shown}`}>{shown === "bye_win" ? "Bye" : shown === "bye_loss" ? "Bye (loss)" : STAMP_TEXT[shown]}</Stamp>
                    : <><EmptyStamp /><span style={{ whiteSpace: "nowrap" }}>Unreported</span>{bye && canEnter && !finished
                      && <Button size="sm" onClick={async () => {
                        const result = await send({ type: "EnterResult", matchId: m.id, result: "bye_win" });
                        if (!result.ok) notify(result.message);
                      }}>Award bye</Button>}{pend && <span className="dk-res-note" data-bad={pend.disagree}>{pend.disagree && "⚠ "}· {pend.text}</span>}</>}
                </span>
              </>;
              const label = `Table ${m.table === null ? "bye" : span(tablesOf(m))}, ${left.name} versus ${right?.name ?? "bye"}, ${shown ? STAMP_TEXT[shown] : "unreported"}`;
              return <li key={`${m.id}:${flipped ? "b" : "a"}`}>
                {bye ? <div className="dk-mrow dk-mrow--bye" aria-label={label}>{content}</div>
                  : <button type="button" className="dk-mrow" aria-pressed={sel} aria-label={label} onClick={() => { setSlot(String(m.table)); reselect(); }}>{content}</button>}
              </li>;
            })}
          </ol>
        </div></div>
      </div>

      <aside className="dk-col-side" aria-label={`${round ? roundTitle(round) : "Round"} slips and selected table`}>
        <section className="dk-slips"><div className="dk-slip dk-slips-card">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <h2 className="dk-h2" style={{ fontSize: 18 }}>{round ? `Round ${round.number} slips` : "No round yet"}</h2>
            <span style={{ font: "600 15px/1 var(--font-body)" }}>{stats.reported} of {stats.total} reported</span>
          </div>
          <div role="img" aria-label={`${stats.reported} of ${stats.total} result slips reported`} className="dk-ticks" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(stats.total, 24))}, minmax(0, 1fr))` }}>
            {(round?.matches ?? []).slice(0, 24).sort((a, b) => (a.table ?? 1e9) - (b.table ?? 1e9)).map(m => <span key={m.id} className="dk-tick" data-done={m.result !== null} />)}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }} className="dd-meta">
            <span>Open: tables {stats.open.length ? (stats.open.length > 12 ? `${stats.open.slice(0, 12).join(", ")}…` : stats.open.join(", ")) : "none"}</span>
            <span>{state.settings.format === "swiss" ? "Swiss" : "Single elimination"}{state.settings.plannedRounds ? ` · ${state.settings.plannedRounds} rounds` : ""}{state.settings.topCut ? ` · top ${state.settings.topCut}` : ""}</span>
          </div>
        </div></section>

        <section aria-label="Selected table" className="dk-sel">
          {selected && s1 ? <>
            <div className="dk-sel-head">
              <span className="dk-sel-t"><span className="dd-caps">Table</span>{selected.table}</span>
              <span className="dk-sel-names">
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><b style={{ fontWeight: 600 }}>{s1.name}</b> <span className="dd-meta">{records.get(s1.id)}</span></span>
                {s2 && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span className="dd-meta">vs</span> <b style={{ fontWeight: 600 }}>{s2.name}</b> <span className="dd-meta">{records.get(s2.id)}</span></span>}
              </span>
            </div>
            <fieldset className="dk-results" disabled={!canEnter || finished || !s2}>
              <legend className="dd-caps">Match Results</legend>
              {([["p1", `${s1.name} Wins ( - )`, "-"], ["p2", `${s2?.name ?? "Player 2"} Wins ( + )`, "+"], ["draw", "Draw ( * )", "*"], ["double_loss", "Double Loss ( / )", "/"], [null, "Unreported ( $ )", "$"]] as const).map(([kind, label, key]) =>
                <label key={key} className="dk-opt"><input type="radio" className="dd-rad" name="match-result" checked={selected.result === kind} disabled={round?.stage === "playoff" && (kind === "draw" || kind === "double_loss")} onChange={() => void commit(kind, false, selected)} /><span className="dk-grow">{label}</span><Keycap>{key}</Keycap></label>)}
              <div className="dk-drops">
                <Checkbox label={`${s1.name} Drops`} checked={s1.status === "dropped"} disabled={!dropRight(s1) || finished} onChange={() => toggleDrop(s1)} />
                {s2 && <Checkbox label={`${s2.name} Drops`} checked={s2.status === "dropped"} disabled={!dropRight(s2) || finished} onChange={() => toggleDrop(s2)} />}
              </div>
              <div className="dk-perf" aria-hidden="true" />
              <p className="dk-hist">History: {selNote.length ? selNote.join(" · ") : "no reports yet"}</p>
            </fieldset>
            {isCurrent && can(role, "ExtendMatch") && s2 && <div className="dk-btn-row">
              <Button size="sm" onClick={() => void send({ type: "ExtendMatch", matchId: selected.id, minutes: 5 }).then(r => !r.ok && setEcho({ kind: "error", text: r.message }))}>Extend this match +5 min</Button>
            </div>}
          </> : <p className="dd-meta" style={{ margin: 0 }}>{round ? "Type a table number or pick a row to see its slip." : "Pair a round to start."}</p>}
        </section>

        <div className="dk-pairside">
          <Button variant="rose" block disabled={!pair.enabled} onClick={pair.run} keyHint="F9">{pair.label}</Button>
          <span className="dk-pairnote">{pair.note}</span>
        </div>
      </aside>
    </div>
    <ConfirmDialog open={overwrite !== null} title="Change a result from an earlier round?" confirmLabel="Change result" confirmVariant="violet" onCancel={() => { setOverwrite(null); reselect(); }}
      message={overwrite ? <>Round {overwrite.round}, table {overwrite.table ?? "?"} is already reported ({STAMP_TEXT[overwrite.was]}). Replace it with {overwrite.kind ? STAMP_TEXT[overwrite.kind] : "Unreported"}? Standings and later pairings are not redone.</> : null}
      onConfirm={() => { const o = overwrite; setOverwrite(null); if (o) void commit(o.kind, o.withDrop, o.match, true); }} />
  </div>;
}

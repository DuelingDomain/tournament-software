"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { DeskView, EventState, Match, MatchPlayerChange, Player, StaffRole, UndropOption } from "@dd-tournament/engine";
import { CommandError, cutoffTies, previewCommand } from "@dd-tournament/engine";
import { Button, ButtonLink, Checkbox, Dialog, Field, FilePicker, Input, Keycap, Radio, Select, Textarea, matchesAccept } from "../ui";
import { STAMP_TEXT, byName, clockLabel, competitors, competitorLabel, dropCommand, formatClock, isTeamEvent, playerById, reEnrollCommand, removeCommand, roundTitle, undropCommand } from "./helpers";
import { can } from "./roles";
import { MESSAGES, type SendFn } from "./use-desk";
import { WarnIcon } from "./icons";
import { postDummy } from "./dummy";
import { PENALTY_LABEL as PEN } from "./helpers";

const Err = ({ text }: { text: string | null }) => (text ? <p className="dd-error" role="alert"><WarnIcon size={14} />{text}</p> : null);
const Wide = () => <span className="dk-dlg-wide" hidden />;
type Close = { onClose: () => void };
type Base = Close & { desk: DeskView; send: SendFn; role?: StaffRole };

/* ---------- Round timer ---------- */
export function TimerDialog({ desk, role, send, onClose }: Base & { role: StaffRole }) {
  const round = desk.state.rounds.at(-1);
  const [minutes, setMinutes] = useState(String(desk.state.settings.roundMinutes));
  const [err, setErr] = useState<string | null>(null);
  const writable = can(role, "StartTimer");
  const remaining = round?.endsAt ? Date.parse(round.endsAt) - Date.now() : null;
  const run = async (command: Parameters<SendFn>[0]) => { const r = await send(command); setErr(r.ok ? null : r.message); };
  return <Dialog open onClose={onClose} title="Round timer" actions={<Button onClick={onClose} autoFocus>Close</Button>}>
    {!round ? <p className="dd-meta">Pair a round first.</p> : <>
      <p style={{ margin: 0 }}>{round.stage === "playoff" ? `Round ${round.number} (Playoffs)` : `Round ${round.number}`}: {remaining === null ? "timer not started." : <b style={{ fontWeight: 600 }}>{remaining < 0 ? `${formatClock(remaining)} over time` : `${clockLabel(remaining)}`}</b>}</p>
      {writable && <>
        <div className="dk-dlg-row"><Field label="Minutes"><Input type="number" min={1} max={1440} value={minutes} onChange={e => setMinutes(e.target.value)} /></Field>
          <Button variant="violet" onClick={() => void run({ type: "StartTimer", minutes: Number(minutes) || desk.state.settings.roundMinutes })}>{remaining === null ? "Start timer" : "Restart timer"}</Button></div>
        {remaining !== null && <div className="dk-btn-row" role="group" aria-label="Adjust the timer">
          {[-5, -1, 1, 5].map(d => <Button key={d} onClick={() => void run({ type: "AdjustTimer", deltaMinutes: d })}>{d > 0 ? `+${d}` : d} min</Button>)}</div>}
      </>}
      <Err text={err} />
    </>}
  </Dialog>;
}

/* ---------- Cut to playoffs / Day-2 cut ---------- */
export function CutDialog({ desk, send, onClose, onDone }: Base & { onDone: (text: string) => void }) {
  const { state } = desk;
  const rows = desk.standings.filter(s => s.status === "active");
  const maxPlayoffSize = Math.min(64, rows.length);
  const [mode, setMode] = useState<"playoff" | "top" | "min_points">("playoff");
  const [size, setSize] = useState(state.settings.topCut >= 2 && state.settings.topCut <= maxPlayoffSize
    ? state.settings.topCut : Math.max(2, Math.min(8, maxPlayoffSize)));
  const [top, setTop] = useState(Math.max(2, Math.min(rows.length, 8)));
  const [points, setPoints] = useState(9);
  const n = mode === "playoff" ? size : top;
  const ties = mode === "min_points" ? null : cutoffTies(rows, n);
  const tied = ties ? rows.slice(ties.start, ties.end) : [];
  const [selection, setSelection] = useState<string[] | null>(null);
  const selected = selection?.every(id => tied.some(row => row.playerId === id)) ? selection : [];
  const required = ties ? n - ties.start : 0;
  const validSelection = tied.length === 0 || (mode === "playoff" ? selected.length === required : selected.length >= required);
  const validSize = mode === "min_points" ? Number.isInteger(points) && points >= 0
    : Number.isInteger(n) && n >= 2 && n <= (mode === "playoff" ? maxPlayoffSize : rows.length);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastCut = state.swissCuts.at(-1);
  const names = playerById(state);
  const tieOrder = tied.length ? selected : undefined;

  async function apply() {
    setBusy(true); setErr(null);
    const res = await send(mode === "playoff" ? { type: "CutToPlayoff", size, ...(tieOrder ? { tieOrder } : {}) }
      : mode === "top" ? { type: "SwissCut", mode: "top", value: top, pairNext: true, ...(tieOrder ? { tieOrder } : {}) } : { type: "SwissCut", mode: "min_points", value: points, pairNext: true });
    setBusy(false);
    if (!res.ok) { setErr(res.message); return; }
    onDone(mode === "playoff" ? `Cut to the top ${size}. Playoff round paired.` : `Day-2 cut applied. Round ${state.rounds.length + 1} paired with the remaining players.`);
    onClose();
  }
  return <Dialog open onClose={onClose} title="Cut to Playoffs" actions={<>
    <Button onClick={onClose}>Cancel</Button>
    <Button variant="rose" disabled={busy || rows.length < 2 || !validSize || !validSelection} onClick={() => void apply()}>{mode === "playoff" ? "Cut and pair playoffs" : "Apply Day-2 cut and pair"}</Button>
  </>}>
    <Wide />
    <div role="radiogroup" aria-label="Cut type">
      <Radio name="cut-mode" label="Single-elimination playoffs: the top players play a bracket" checked={mode === "playoff"} onChange={() => { setMode("playoff"); setSelection(null); }} />
      <Radio name="cut-mode" label="Day-2 cut by rank: keep the top players, Swiss continues" checked={mode === "top"} onChange={() => { setMode("top"); setSelection(null); }} />
      <Radio name="cut-mode" label="Day-2 cut by points: drop players under a point total, Swiss continues" checked={mode === "min_points"} onChange={() => { setMode("min_points"); setSelection(null); }} />
    </div>
    <div className="dk-dlg-row">
      {mode === "playoff" && <Field label="Players in the bracket"><Input type="number" min={2} max={maxPlayoffSize} value={size} onChange={e => { setSize(Number(e.target.value)); setSelection(null); }} /></Field>}
      {mode === "top" && <Field label="Players to keep"><Input type="number" min={2} max={rows.length} value={top} onChange={e => { setTop(Number(e.target.value)); setSelection(null); }} /></Field>}
      {mode === "min_points" && <Field label="Minimum match points to stay"><Input type="number" min={0} value={points} onChange={e => setPoints(Number(e.target.value))} /></Field>}
    </div>
    {tied.length > 0 && <div role="group" aria-label="Tied competitors" className="dk-slip" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <b style={{ fontWeight: 600 }}>{tied.length} players are tied at the cut</b>
      <span className="dd-meta">{mode === "playoff" ? `Select exactly ${required} to advance.` : `Select at least ${required} to advance.`}</span>
      {tied.map(row => <Checkbox key={row.playerId} label={names.get(row.playerId)?.name ?? row.name}
        checked={selected.includes(row.playerId)} onChange={e => setSelection(e.target.checked
          ? [...selected, row.playerId] : selected.filter(id => id !== row.playerId))} />)}
    </div>}
    {lastCut && !lastCut.roundPairedAfter && state.phase !== "playoff" && <div className="dk-dlg-row" style={{ alignItems: "center" }}>
      <span className="dd-meta" style={{ flex: "1 1 auto" }}>A Day-2 cut after round {lastCut.afterRound} is in place ({lastCut.cutPlayers.length} players cut).</span>
      <Button size="sm" onClick={async () => { const r = await send({ type: "UndoSwissCut" }); if (r.ok) { onDone("Day-2 cut undone."); onClose(); } else setErr(r.message); }}>Undo that cut</Button></div>}
    <Err text={err} />
  </Dialog>;
}

/* ---------- Undrop wizard ---------- */
const sideText = (m: Match, names: ReturnType<typeof playerById>) =>
  <span>{m.table !== null ? `Table ${m.table}: ` : ""}{names.get(m.p1)?.name ?? "?"} vs {m.p2 ? names.get(m.p2)?.name ?? "?" : "Bye"}</span>;
const UNDROP_OPTIONS: UndropOption[] = ["swap_previous_opponent", "take_bye", "bye_win", "bye_loss", "repair", "next_round"];
export function UndropDialog({ code, desk, send, onClose, onDone }: Base & { code: string; onDone: (t: string) => void }) {
  const { state } = desk;
  const round = state.rounds.at(-1);
  const team = isTeamEvent(state);
  const dropped = useMemo(() => competitors(state).filter(p => p.status === "dropped").sort(byName), [state]);
  const [playerId, setPlayerId] = useState(dropped[0]?.id ?? "");
  const [option, setOption] = useState<UndropOption>("bye_loss");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [printNew, setPrintNew] = useState(false);
  const names = playerById(state);
  const player = names.get(playerId);
  const paired = !!round && round.matches.some(m => m.p1 === playerId || m.p2 === playerId);
  // The returning player's match in the previous round, and the opponent who is still active.
  const prev = round ? state.rounds.find(r => r.number === round.number - 1)?.matches.find(m => m.p1 === playerId || m.p2 === playerId) : undefined;
  const prevOpp = prev ? names.get(prev.p1 === playerId ? prev.p2 ?? "" : prev.p1) : undefined;
  const oppSeat = prevOpp && prevOpp.status === "active" ? round?.matches.find(m => m.p1 === prevOpp.id || m.p2 === prevOpp.id) : undefined;
  const byeMatch = round?.matches.find(m => m.p2 === null && m.result === "bye_win");
  const live = !!round && state.phase === "swiss";
  const why: Record<UndropOption, string | null> = {
    swap_previous_opponent: !live ? "Needs a paired round." : paired ? "Already paired this round." : !oppSeat ? "Last round's opponent has no open seat in this round." : null,
    swap_with_dropped: "Use the swap option above.",
    take_bye: !live ? "Needs a paired round." : paired ? "Already paired this round." : !byeMatch ? "Nobody has a bye this round." : null,
    bye_win: !live ? "Needs a paired round." : null,
    bye_loss: !live ? "Needs a paired round." : null,
    repair: !live ? "Needs a paired round." : paired ? "Already paired this round." : null,
    next_round: null,
  };
  const effective: UndropOption = why[option] === null ? option : "next_round";
  const labels: Record<UndropOption, string> = {
    swap_previous_opponent: "Drop other player and pair with that person's opponent", swap_with_dropped: "Drop other player and pair with that person's opponent",
    take_bye: byeMatch ? `Pair vs. Bye Player: ${names.get(byeMatch.p1)?.name ?? ""}` : "Pair vs. Bye Player",
    bye_win: "Bye Opponent - Win", bye_loss: "Bye Opponent - Loss", repair: "Re-Pair as necessary",
    next_round: "Re-enter next round (no match this round)",
  };
  // The paired round's seed keeps the same table choices in the preview and on save.
  const preview = useMemo<{ changes: MatchPlayerChange[] } | { error: string } | null>(() => {
    if (effective !== "repair" || !playerId || state.phase === "playoff") return null;
    try { return { changes: previewCommand(state, undropCommand(team, playerId, "repair"), { now: new Date().toISOString(), seed: 1, actor: "preview" }) }; }
    catch (e) { return { error: e instanceof CommandError ? e.message : "The new pairings could not be previewed." }; }
  }, [effective, playerId, state, team]);
  const changes = preview && "changes" in preview ? preview.changes : [];
  /** Tables whose pairing is new, for the "Print new result slips" option. */
  const newTables = [...new Set(changes.flatMap(c => (c.after && c.after.p2 !== null && c.after.table !== null ? [c.after.table] : [])))].sort((a, b) => a - b);
  async function run() {
    setBusy(true); setErr(null);
    // Open the slips tab now (inside the click) so the browser does not block it after the command returns.
    const slips = printNew && newTables.length ? window.open("about:blank", "_blank") : null;
    if (slips) slips.opener = null;
    const res = await send(undropCommand(team, playerId, effective));
    if (!res.ok) { slips?.close(); setBusy(false); setErr(res.message); return; }
    if (slips) {
      const previous = new Map(res.before.state.rounds.at(-1)?.matches.map(m => [m.id, m]));
      const tables = res.desk.state.rounds.at(-1)?.matches.flatMap(m => {
        const before = previous.get(m.id);
        return m.p2 !== null && m.table !== null && (m.p1 !== before?.p1 || m.p2 !== before.p2) ? [m.table] : [];
      }) ?? [];
      if (tables.length) slips.location.href = `/e/${encodeURIComponent(code)}/print/slips?tables=${tables.join(",")}`;
      else slips.close();
    }
    setBusy(false);
    onDone(`${player?.name ?? competitorLabel(state)} is back in the tournament.`); onClose();
  }
  const done = (m: Match) => `${names.get(m.p1)?.name ?? "?"} vs ${m.p2 ? names.get(m.p2)?.name ?? "?" : "Bye"}`;
  return <Dialog open onClose={onClose} title={`Undrop ${competitorLabel(state)} Wizard`} actions={<><Button onClick={onClose}>Cancel</Button><Button variant="violet" disabled={!playerId || busy || state.phase === "playoff"} onClick={() => void run()}>Apply changes</Button></>}>
    <Wide />
    {dropped.length === 0 ? <p className="dd-meta">Nobody has dropped.</p> : <>
      {state.phase === "playoff" && <p className="dd-error"><WarnIcon size={14} />Dropped players cannot re-enter the playoff bracket.</p>}
      <Field label={`Dropped ${competitorLabel(state)}s`}><Select value={playerId} onChange={e => setPlayerId(e.target.value)}>{dropped.map(p => <option key={p.id} value={p.id}>{p.name} (R{p.droppedAfterRound ?? 0})</option>)}</Select></Field>
      <section className="dk-slip dk-sec" style={{ gap: 4 }} aria-label="Last round">
        <span className="dd-caps">Last Round</span>
        {prev ? <span>{done(prev)}{prev.result ? <span className="dd-meta"> · {STAMP_TEXT[prev.result]}</span> : null}</span> : <span className="dd-meta">{player?.name ?? "This player"} was not paired in the previous round.</span>}
        {prevOpp && <span className="dd-meta">{prevOpp.name} is {prevOpp.status === "active" ? "still in the tournament" : "also out"}.</span>}
      </section>
      <div role="radiogroup" aria-label="How the player re-enters" className="dk-sec" style={{ gap: 2 }}>
        {UNDROP_OPTIONS.map(o =>
          <Radio key={o} name="undrop" label={labels[o]} checked={effective === o} disabled={why[o] !== null} onChange={() => setOption(o)} hint={why[o] ? `(${why[o]})` : undefined} />)}
      </div>
      {effective === "swap_previous_opponent" && prevOpp && oppSeat && <p className="dd-meta" style={{ margin: 0 }}>{prevOpp.name} drops. {player?.name} takes their seat at table {oppSeat.table ?? "?"}.</p>}
      {preview && "error" in preview && <Err text={preview.error} />}
      {preview && "changes" in preview && <section className="dk-slip dk-sec" style={{ gap: 6 }} aria-label="Pairings that change">
        <span className="dd-caps">Current vs New pairings</span>
        {changes.length === 0 ? <span className="dd-meta">No other pairing changes.</span> : <ul className="dk-dlg-list">{changes.map(c => <li key={c.matchId} className="dk-undrop-change">
          <span className="dk-undrop-side">
            <span className="dd-caps">Current</span>
            {c.before ? sideText(c.before, names) : <span className="dd-meta">No match</span>}
            {c.before?.result && c.after?.result == null && <span className="dd-meta">{c.before.result === "bye_win" ? "Bye win" : STAMP_TEXT[c.before.result]} will be cleared</span>}
          </span>
          <span aria-hidden="true">&rarr;</span>
          <span className="dk-undrop-side"><span className="dd-caps">New</span>{c.after ? sideText(c.after, names) : <span className="dd-meta">Removed</span>}</span>
        </li>)}</ul>}
        {newTables.length > 0 && <Checkbox label="Print new result slips" checked={printNew} onChange={e => setPrintNew(e.target.checked)} hint={`Table${newTables.length > 1 ? "s" : ""} ${newTables.join(", ")}`} />}
      </section>}
      <Err text={err} />
    </>}
  </Dialog>;
}

/* ---------- Drop / Re-enroll pick lists ---------- */
export function DropPlayerDialog({ desk, send, onClose, onDone }: Base & { onDone: (t: string) => void }) {
  const { state } = desk;
  const team = isTeamEvent(state);
  const who = competitorLabel(state);
  const active = useMemo(() => competitors(state).filter(p => p.status === "active").sort(byName), [state]);
  const [playerId, setPlayerId] = useState(active[0]?.id ?? "");
  const [err, setErr] = useState<string | null>(null);
  const registration = state.phase === "registration";
  async function run() {
    const res = await send(registration ? removeCommand(team, playerId) : dropCommand(team, playerId));
    if (!res.ok) { setErr(res.message); return; }
    onDone(`${competitors(state).find(p => p.id === playerId)?.name} ${registration ? "was removed" : "dropped"}.`); onClose();
  }
  return <Dialog open onClose={onClose} title={`Drop ${who}`} actions={<><Button onClick={onClose}>Cancel</Button><Button variant="rose" disabled={!playerId} onClick={() => void run()}>{registration ? `Remove ${who.toLowerCase()}` : `Drop ${who.toLowerCase()}`}</Button></>}>
    <p className="dd-meta" style={{ margin: 0 }}>{registration ? `The tournament has not started, so the ${who.toLowerCase()} is removed from the list.` : `The ${who.toLowerCase()} stays in standings and is no longer paired. Their current match is not changed; enter its result as usual.`}</p>
    <Field label={who}><Select value={playerId} onChange={e => setPlayerId(e.target.value)} autoFocus>{active.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
    <Err text={err} />
  </Dialog>;
}

export function ReEnrollDialog({ desk, send, onClose, onDone }: Base & { onDone: (t: string) => void }) {
  const { state } = desk;
  const team = isTeamEvent(state);
  const who = competitorLabel(state);
  const dropped = useMemo(() => competitors(state).filter(p => p.status === "dropped").sort(byName), [state]);
  const [playerId, setPlayerId] = useState(dropped[0]?.id ?? "");
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    const res = await send(reEnrollCommand(team, playerId));
    if (!res.ok) { setErr(res.message); return; }
    onDone(`${competitors(state).find(p => p.id === playerId)?.name} is enrolled again.`); onClose();
  }
  return <Dialog open onClose={onClose} title={`Re-Enroll ${who}`} actions={<><Button onClick={onClose}>Cancel</Button><Button variant="violet" disabled={!playerId} onClick={() => void run()}>Re-enroll {who.toLowerCase()}</Button></>}>
    <p className="dd-meta" style={{ margin: 0 }}>The {who.toLowerCase()} returns with a loss for every round they missed, including this one. Use the Undrop wizard to choose a different way back.</p>
    <Field label={`Dropped ${who.toLowerCase()}`}><Select value={playerId} onChange={e => setPlayerId(e.target.value)} autoFocus>{dropped.map(p => <option key={p.id} value={p.id}>{p.name} (R{p.droppedAfterRound ?? 0})</option>)}</Select></Field>
    <Err text={err} />
  </Dialog>;
}

/* ---------- Assigned seats ---------- */
export function SeatsDialog({ desk, send, onClose }: Base) {
  const { state } = desk;
  const team = isTeamEvent(state);
  const players = useMemo(() => [...competitors(state)].sort(byName), [state]);
  const seated = players.filter(p => p.fixedTable !== null).sort((a, b) => (a.fixedTable ?? 0) - (b.fixedTable ?? 0));
  const [playerId, setPlayerId] = useState("");
  const [table, setTable] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const n = Number(table);
  const valid = playerId !== "" && Number.isInteger(n) && n >= 1 && n <= 100000;
  const set = async (id: string, value: number | null) => {
    const res = await send(team ? { type: "UpdateTeam", teamId: id, fixedTable: value } : { type: "UpdatePlayer", playerId: id, fixedTable: value });
    if (!res.ok) { setErr(res.message); return false; }
    setErr(null); return true;
  };
  return <Dialog open onClose={onClose} title="Assigned Seats" actions={<Button onClick={onClose}>Close</Button>}>
    <Wide />
    <p className="dd-meta" style={{ margin: 0 }}>A player with an assigned seat is paired at that table every round, for accessibility. Pair or re-pair a round for it to take effect.</p>
    <div className="dk-dlg-row">
      <Field label="Player"><Select value={playerId} onChange={e => setPlayerId(e.target.value)} autoFocus><option value="">Choose a player</option>{players.map(p => <option key={p.id} value={p.id}>{p.name}{p.fixedTable !== null ? ` (table ${p.fixedTable})` : ""}</option>)}</Select></Field>
      <Field label="Table"><Input inputMode="numeric" value={table} onChange={e => setTable(e.target.value.replace(/\D/g, "").slice(0, 6))} /></Field>
      <Button variant="violet" disabled={!valid} onClick={async () => { if (await set(playerId, n)) { setTable(""); setPlayerId(""); } }}>Assign seat</Button>
    </div>
    <b style={{ fontWeight: 600 }}>Current assignments ({seated.length})</b>
    {seated.length === 0 ? <span className="dd-meta">No assigned seats.</span> : <ul className="dk-dlg-list">{seated.map(p => <li key={p.id}>
      <span className="dk-num" style={{ width: 70 }}>Table {p.fixedTable}</span><span style={{ flex: 1 }}>{p.name}</span>
      <Button size="sm" aria-label={`Clear ${p.name}'s seat`} onClick={() => void set(p.id, null)}>Clear</Button></li>)}</ul>}
    <Err text={err} />
  </Dialog>;
}

/* ---------- Change Result wizard ---------- */
export function ChangeResultDialog({ desk, role, send, onClose, onDone }: Base & { role: StaffRole; onDone: (t: string) => void }) {
  const { state } = desk;
  const [round, setRound] = useState(state.rounds.at(-1)?.number ?? 1);
  const [table, setTable] = useState("");
  const [byeId, setByeId] = useState("");
  const [result, setResult] = useState<"p1" | "p2" | "draw" | "double_loss" | "clear">("p1");
  const [drop, setDrop] = useState<"none" | "loser" | "both">("none");
  const [swapPlayers, setSwapPlayers] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const names = playerById(state);
  const selectedRound = state.rounds.find(r => r.number === round);
  const match = selectedRound?.matches.find(m => byeId ? m.id === byeId : (m.table ?? m.byeTable) === Number(table));
  const byes = selectedRound?.matches.filter(m => m.p2 === null) ?? [];
  const bye = !!match && match.p2 === null;
  const canDraw = selectedRound?.stage !== "playoff" && !bye;
  const canAwardP2 = !bye || selectedRound?.stage !== "playoff";
  const p1 = match && names.get(match.p1)?.name, p2 = match?.p2 ? names.get(match.p2)?.name : null;
  const currentMatches = state.rounds.at(-1)?.matches ?? [];
  const first = currentMatches.find(m => match && (m.p1 === match.p1 || m.p2 === match.p1));
  const second = currentMatches.find(m => match?.p2 && (m.p1 === match.p2 || m.p2 === match.p2));
  const canSwap = can(role, "SwapPlayers") && !!first && !!second && first !== second;
  async function run() {
    if (!match) { setErr(`No table ${table || "?"} in round ${round}.`); return; }
    const corrected = result === "clear" ? null : bye ? (result === "p1" ? "bye_win" : "bye_loss") : result;
    const res = await send({ type: "EnterResult", matchId: match.id, result: corrected, drop: result === "clear" ? "none" : drop, swapPlayers: canSwap && swapPlayers });
    if (!res.ok) { setErr(res.message); return; }
    onDone(bye ? `Round ${round} bye updated.` : `Round ${round}, table ${table} updated.`); onClose();
  }
  return <Dialog open onClose={onClose} title="Change Match Result" actions={<><Button onClick={onClose}>Cancel</Button><Button variant="violet" disabled={!match || (!canDraw && (result === "draw" || result === "double_loss")) || (!canAwardP2 && result === "p2")} onClick={() => void run()}>Change result</Button></>}>
    <div className="dk-dlg-row">
      <Field label="Round"><Select value={round} onChange={e => { setRound(Number(e.target.value)); setByeId(""); setResult("p1"); setSwapPlayers(false); }}>{state.rounds.map(r => <option key={r.number} value={r.number}>{roundTitle(r)}</option>)}</Select></Field>
      <Field label="Table"><Input inputMode="numeric" value={table} onChange={e => { setTable(e.target.value.replace(/\D/g, "")); setByeId(""); setResult("p1"); setSwapPlayers(false); }} autoFocus /></Field>
    </div>
    {byes.length > 0 && <Field label="Bye"><Select value={byeId} onChange={e => {
      setByeId(e.target.value); setTable(""); setResult("p1"); setSwapPlayers(false);
    }}><option value="">Choose a bye</option>{byes.map(m => <option key={m.id} value={m.id}>{names.get(m.p1)?.name ?? m.p1}</option>)}</Select></Field>}
    {match ? <p style={{ margin: 0 }}><b style={{ fontWeight: 600 }}>{p1}</b> vs <b style={{ fontWeight: 600 }}>{p2 ?? "Bye"}</b> · now {match.result ? STAMP_TEXT[match.result] : "Unreported"}</p> : <p className="dd-meta" style={{ margin: 0 }}>Enter a table to load the match.</p>}
    <div role="radiogroup" aria-label="New result">
      <Radio name="cr" label={`${p1 ?? "Player 1"} Wins ( - )`} checked={result === "p1"} onChange={() => setResult("p1")} />
      {canAwardP2 && <Radio name="cr" label={`${p2 ?? (bye ? "Bye" : "Player 2")} Wins ( + )`} checked={result === "p2"} onChange={() => setResult("p2")} />}
      {canDraw && <Radio name="cr" label="Draw ( * )" checked={result === "draw"} onChange={() => setResult("draw")} />}
      {canDraw && <Radio name="cr" label="Double Loss ( / )" checked={result === "double_loss"} onChange={() => setResult("double_loss")} />}
      <Radio name="cr" label="Unreported ( $ )" checked={result === "clear"} onChange={() => setResult("clear")} />
    </div>
    {canSwap && <Checkbox checked={swapPlayers} onChange={e => setSwapPlayers(e.target.checked)} label="Swap players’ current opponents" />}
    <Field label="Also drop"><Select value={drop} onChange={e => setDrop(e.target.value as typeof drop)} disabled={result === "clear"}><option value="none">Nobody</option><option value="loser">The loser</option><option value="both">Both players</option></Select></Field>
    <Err text={err} />
  </Dialog>;
}

/* ---------- Manual pairings ---------- */
export function ManualPairingsDialog({ desk, send, onClose }: Base) {
  const { state } = desk;
  const round = state.rounds.at(-1);
  const names = playerById(state);
  const nm = (id: string) => names.get(id)?.name ?? "Unknown";
  const paired = (round?.matches ?? []).filter(m => m.result === null || m.p2 === null);
  const inRound = (round?.matches ?? []).flatMap(m => (m.p2 === null ? [m.p1] : [m.p1, m.p2])).filter(id => names.get(id)?.status === "active");
  const unpaired = desk.integrity.unpairedActive;
  const [a, setA] = useState(""), [b, setB] = useState(""), [split, setSplit] = useState("");
  const [c1, setC1] = useState(""), [c2, setC2] = useState(""), [ct, setCt] = useState(""), [bye, setBye] = useState(""), [byeKind, setByeKind] = useState<"bye_win" | "bye_loss">("bye_win");
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const tableOf = (id: string) => round?.matches.find(m => m.p1 === id || m.p2 === id)?.table ?? null;
  const run = async (command: Parameters<SendFn>[0], ok: string) => { const r = await send(command); setMsg(r.ok ? { bad: false, text: ok } : { bad: true, text: r.message }); };
  const unreportedMatches = (round?.matches ?? []).filter((m): m is Match & { table: number } => m.result === null && m.table !== null);
  if (!round) return <Dialog open onClose={onClose} title="Manual Pairings" actions={<Button onClick={onClose}>Close</Button>}><p className="dd-meta">Pair a round first.</p></Dialog>;
  const opts = (ids: string[]) => ids.map(id => <option key={id} value={id}>{nm(id)}{tableOf(id) !== null ? ` (table ${tableOf(id)})` : ""}</option>);
  return <Dialog open onClose={onClose} title={`Manual Pairings, Round ${round.number}`} actions={<Button onClick={onClose} autoFocus>Done</Button>}>
    <Wide />
    <p className="dd-meta" style={{ margin: 0 }}>Only matches without a result can change. Clear a result first to edit its pairing.</p>
    <section className="dk-slip dk-sec" style={{ gap: 8 }} aria-label="Swap two players">
      <b style={{ fontWeight: 600 }}>Swap two players</b>
      <div className="dk-dlg-row"><Field label="Player"><Select value={a} onChange={e => setA(e.target.value)}><option value="">Choose</option>{opts(inRound)}</Select></Field>
        <Field label="Swaps with"><Select value={b} onChange={e => setB(e.target.value)}><option value="">Choose</option>{opts(inRound.filter(i => i !== a))}</Select></Field>
        <Button disabled={!a || !b} onClick={() => void run({ type: "SwapPlayers", a, b }, `${nm(a)} and ${nm(b)} swapped.`)}>Swap</Button></div>
    </section>
    <section className="dk-slip dk-sec" style={{ gap: 8 }} aria-label="Split a match">
      <b style={{ fontWeight: 600 }}>Split a match</b>
      <div className="dk-dlg-row"><Field label="Match"><Select value={split} onChange={e => setSplit(e.target.value)}><option value="">Choose a table</option>
        {unreportedMatches.map(m => <option key={m.id} value={m.id}>Table {m.table}: {nm(m.p1)} vs {m.p2 ? nm(m.p2) : "bye"}</option>)}</Select></Field>
        <Button disabled={!split} onClick={() => void run({ type: "SplitMatch", matchId: split }, "Match split. Pair both players again below.")}>Split</Button></div>
    </section>
    <section className="dk-slip dk-sec" style={{ gap: 8 }} aria-label="Pair unpaired players">
      <b style={{ fontWeight: 600 }}>Unpaired players{unpaired.length ? ` (${unpaired.length})` : ""}</b>
      {unpaired.length === 0 ? <span className="dd-meta">Everyone has a match.</span> : <>
        <div className="dk-dlg-row"><Field label="Player 1"><Select value={c1} onChange={e => setC1(e.target.value)}><option value="">Choose</option>{unpaired.map(id => <option key={id} value={id}>{nm(id)}</option>)}</Select></Field>
          <Field label="Player 2"><Select value={c2} onChange={e => setC2(e.target.value)}><option value="">Choose</option>{unpaired.filter(i => i !== c1).map(id => <option key={id} value={id}>{nm(id)}</option>)}</Select></Field>
          <Field label="Table (optional)"><Input inputMode="numeric" value={ct} onChange={e => setCt(e.target.value.replace(/\D/g, ""))} /></Field>
          <Button disabled={!c1 || !c2} onClick={() => void run({ type: "CreateMatch", p1: c1, p2: c2, ...(ct ? { table: Number(ct) } : {}) }, `${nm(c1)} vs ${nm(c2)} paired.`)}>Pair</Button></div>
        <div className="dk-dlg-row"><Field label="Give a bye to"><Select value={bye} onChange={e => setBye(e.target.value)}><option value="">Choose</option>{unpaired.map(id => <option key={id} value={id}>{nm(id)}</option>)}</Select></Field>
          <Field label="Bye counts as"><Select value={byeKind} onChange={e => setByeKind(e.target.value as typeof byeKind)}><option value="bye_win">A win</option><option value="bye_loss">A loss</option></Select></Field>
          <Button disabled={!bye} onClick={() => void run({ type: "AddByeMatch", playerId: bye, result: byeKind }, `${nm(bye)} has a bye.`)}>Give bye</Button></div></>}
    </section>
    {msg && <p role="status" className={msg.bad ? "dd-error" : "dd-meta"}>{msg.text}</p>}
  </Dialog>;
}

/* ---------- Import ---------- */
const IMPORT_ACCEPT = { players: ".xml,text/xml,application/xml", "team-players": ".Tournament,.tournament" } as const;
type ImportKind = keyof typeof IMPORT_ACCEPT;
export function ImportDialog({ code, kind: initial, onClose, onDone, replaceDesk }: Close & { code: string; kind: ImportKind; onDone: (t: string) => void; replaceDesk: (d: DeskView) => void }) {
  const [kind, setKindRaw] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  // Switching the kind drops a chosen file that the new kind does not accept.
  const setKind = (next: ImportKind) => { setKindRaw(next); if (file && !matchesAccept(file.name, IMPORT_ACCEPT[next])) setFile(null); setErr(null); };
  async function run() {
    if (!file) { setErr("Choose a file."); return; }
    setBusy(true); setErr(null);
    const form = new FormData(); form.set("file", file); form.set("kind", kind);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(code)}/import`, { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { desk?: DeskView; imported?: number; unmatched?: number; error?: string; message?: string };
      if (!res.ok || !body.desk) { setErr(MESSAGES[body.error ?? ""] ?? (body.error === "REGISTRATION_ONLY" ? "Player lists import during registration only." : body.error === "INVALID_PLAYER_STRUCTURE" ? "That file is not a team tournament, or this tournament is a team event. Team player lists import into a tournament with individual players." : body.message ?? "That file could not be imported.")); setBusy(false); return; }
      replaceDesk(body.desk);
      onDone(`Imported ${body.imported ?? 0} players${body.unmatched ? `, ${body.unmatched} without a matching account (they can join later with their player ID)` : ""}.`);
      onClose();
    } catch { setErr("Could not reach the server."); setBusy(false); }
  }
  return <Dialog open onClose={onClose} title="Import" actions={<><Button onClick={onClose}>Cancel</Button><Button variant="violet" disabled={busy || !file} onClick={() => void run()}>Import</Button></>}>
    <div role="radiogroup" aria-label="What to import">
      <Radio name="imp" label="Player list (AllPlayers XML), adds players during registration" checked={kind === "players"} onChange={() => setKind("players")} />
      <Radio name="imp" label="Team player list (team .Tournament file), adds its players during registration" checked={kind === "team-players"} onChange={() => setKind("team-players")} />
    </div>
    <FilePicker label="File" accept={IMPORT_ACCEPT[kind]} file={file} onChange={f => { setFile(f); setErr(null); }}
      onReject={name => setErr(`${name} is not ${kind === "players" ? "an .xml player list" : "a .Tournament file"}.`)}
      hint={kind === "players" ? "An .xml player list." : "A .Tournament file."} />
    <Err text={err} />
  </Dialog>;
}

/* ---------- Global player list ---------- */
const GLOBAL_ACCEPT = ".csv,.xml,.Tournament,.tournament";
export function ImportGlobalDialog({ onClose, onDone }: Close & { onDone: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [bad, setBad] = useState<{ count: number; csv: string } | null>(null);
  async function run() {
    if (!file) { setErr("Choose a file."); return; }
    setBusy(true); setErr(null);
    const form = new FormData(); form.set("file", file);
    try {
      const res = await fetch("/api/players/import", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { added?: number; skipped?: number; invalid?: number; overLimit?: number; total?: number; badCheckDigit?: { count: number; csv: string | null }; error?: string; message?: string };
      if (!res.ok) { setErr(MESSAGES[body.error ?? ""] ?? body.message ?? "That file could not be imported."); setBusy(false); return; }
      onDone(`Added ${body.added ?? 0} to the global player list. ${body.skipped ?? 0} already listed${body.invalid ? `, ${body.invalid} skipped as not valid` : ""}${body.badCheckDigit?.count ? `, ${body.badCheckDigit.count} not added (invalid ID)` : ""}${body.overLimit ? `, ${body.overLimit} not added (list is full)` : ""}. ${body.total ?? 0} in total.`);
      window.dispatchEvent(new Event("dk:global-players"));
      if (body.badCheckDigit?.csv) { setBad({ count: body.badCheckDigit.count, csv: body.badCheckDigit.csv }); setBusy(false); return; }
      onClose();
    } catch { setErr("Could not reach the server."); setBusy(false); }
  }
  function saveInvalid() {
    if (!bad) return;
    const url = URL.createObjectURL(new Blob([bad.csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `Invalid IDs ${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.csv`;
    document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }
  if (bad) return <Dialog open onClose={onClose} title="Import Player List" actions={<><Button onClick={saveInvalid}>Save list of invalid IDs</Button><Button variant="violet" autoFocus onClick={onClose}>Close</Button></>}>
    <p style={{ margin: 0 }}>The other players are added. {bad.count} {bad.count === 1 ? "player has an ID that is" : "players have IDs that are"} not valid, so {bad.count === 1 ? "it was" : "they were"} not added to the list.</p>
  </Dialog>;
  return <Dialog open onClose={onClose} title="Import Player List" actions={<><Button onClick={onClose}>Cancel</Button><Button variant="violet" disabled={busy || !file} onClick={() => void run()}>Import</Button></>}>
    <p className="dd-meta" style={{ margin: 0 }}>Adds players to your global player list. A player ID that is already listed is not changed.</p>
    <FilePicker label="File" accept={GLOBAL_ACCEPT} file={file} onChange={f => { setFile(f); setErr(null); }}
      onReject={name => setErr(`${name} is not a .csv, .xml or .Tournament file.`)}
      hint="A .csv with the columns ID, First Name, Last Name; a player list .xml; or a .Tournament file." />
    <Err text={err} />
  </Dialog>;
}

/** Shown after Finalize succeeds: the original also wrote a finalized copy of the file. */
export function FinalizedDialog({ onClose, onSave }: Close & { onSave: () => void }) {
  return <Dialog open onClose={onClose} title="Tournament finalized" actions={<><Button onClick={onClose}>Close</Button><Button variant="violet" autoFocus onClick={() => { onSave(); onClose(); }}>Save Finalized Tournament</Button></>}>
    <p style={{ margin: 0 }}>The results are locked. Save the finalized tournament file now, or later from File, Save Finalized Tournament.</p>
  </Dialog>;
}

/* ---------- Print, keys, checks, history ---------- */
export function BatchPrintDialog({ code, onClose }: Close & { code: string }) {
  const docs = [["players", "Player list", "F4"], ["pairings?by=player", "Pairings by player", "F5"], ["brackets", "Brackets", "F6"], ["slips", "Result slips", "F7"], ["standings", "Standings", "F8"], ["pairings", "Pairings by table", ""]] as const;
  return <Dialog open onClose={onClose} title="Batch Printing" actions={<Button onClick={onClose} autoFocus>Close</Button>}>
    <p className="dd-meta" style={{ margin: 0 }}>Each document opens in a new tab. Use the browser print dialog there.</p>
    <ul className="dk-dlg-list">{docs.map(([path, label, key]) => <li key={path}><span style={{ flex: 1 }}>{label}</span>{key ? <Keycap>{key}</Keycap> : null}<ButtonLink size="sm" href={`/e/${encodeURIComponent(code)}/print/${path}`} target="_blank" rel="noopener">Open</ButtonLink></li>)}</ul>
  </Dialog>;
}

const KEYREF: [string, string][] = [
  ["Type a table number", "Selects that table; the Table box is always ready"],
  ["-", "Player 1 wins"], ["+  or  =", "Player 2 wins"], ["*", "Draw"], ["/", "Double loss"], ["$", "Set back to Unreported"],
  ["Ctrl + - / +", "Result, and the loser drops"], ["Ctrl + /", "Double loss, and both players drop"], ["Ctrl + Z", "Undo the last result"],
  ["F1  F2  F3", "Players, Pairings, Standings"], ["F4", "Print player list"], ["F5", "Print pairings (by player)"], ["F6", "Print brackets"],
  ["F7  F8", "Print result slips, standings"], ["F9", "Pair next round"], ["F10", "Re-pair this round"], ["F11", "Cut to playoffs"], ["F12", "Cancel the current round"],
  ["Ctrl + F", "Find a player"], ["Ctrl + K", "Player notes and penalties"], ["Ctrl + M", "Player match history"],
  ["Ctrl + P", "Batch printing"], ["Ctrl + S", "Save the .Tournament file"], ["Ctrl + O", "Open a .Tournament file"],
  ["Ctrl + .  (Cmd + . on Mac)", "Command palette"],
];
export function KeyboardDialog({ onClose }: Close) {
  return <Dialog open onClose={onClose} title="Keyboard Reference" actions={<Button onClick={onClose} autoFocus>Close</Button>}>
    <Wide /><div className="dk-kref">{KEYREF.map(([k, d]) => <span key={k} style={{ display: "contents" }}><span><Keycap>{k}</Keycap></span><span>{d}</span></span>)}</div>
  </Dialog>;
}

export function IntegrityDialog({ desk, onClose }: Close & { desk: DeskView }) {
  const nm = (id: string) => playerById(desk.state).get(id)?.name ?? "Unknown";
  const i = desk.integrity;
  const none = !i.repeatMatches.length && !i.pairedTwiceInRound.length && !i.unpairedActive.length && !i.memberIdWarnings.length;
  return <Dialog open onClose={onClose} title="Verify Pairings" actions={<Button onClick={onClose} autoFocus>Close</Button>}>
    {none ? <p style={{ margin: 0 }}>No repeat matches, double pairings, unpaired players or COSSY ID problems.</p> : <ul className="dk-dlg-list">
      {i.repeatMatches.map(r => <li key={`${r.a}${r.b}`}><WarnIcon size={14} />{nm(r.a)} and {nm(r.b)} have played {r.rounds.length} times (rounds {r.rounds.join(", ")})</li>)}
      {i.pairedTwiceInRound.map(p => <li key={`${p.round}${p.playerId}`}><WarnIcon size={14} />{nm(p.playerId)} is paired more than once in round {p.round}</li>)}
      {i.unpairedActive.map(id => <li key={id}><WarnIcon size={14} />{nm(id)} is active but not paired this round</li>)}
      {i.memberIdWarnings.map((w, k) => <li key={k}><WarnIcon size={14} />{nm(w.playerId)}: {w.problem === "duplicate" ? "another player has this COSSY ID" : "COSSY ID check digit does not match"}</li>)}
    </ul>}
  </Dialog>;
}

export function HistoryDialog({ state, onClose }: Close & { state: EventState }) {
  const players = [...competitors(state)].sort(byName);
  const [id, setId] = useState(players[0]?.id ?? "");
  const names = playerById(state);
  const rows = state.rounds.flatMap(r => r.matches.filter(m => m.p1 === id || m.p2 === id).map(m => {
    const me1 = m.p1 === id; const opp = me1 ? m.p2 : m.p1;
    const res = m.result === null ? "Unreported" : m.result === "draw" ? "Draw" : m.result === "double_loss" ? "Double loss" : m.result === "bye_win" ? "Bye (win)" : m.result === "bye_loss" ? "Bye (loss)" : (m.result === "p1") === me1 ? "Win" : "Loss";
    return { round: r.number, table: m.table, opp: opp ? names.get(opp)?.name ?? "Unknown" : "Bye", res };
  }));
  return <Dialog open onClose={onClose} title={`${competitorLabel(state)} Match History`} actions={<Button onClick={onClose} autoFocus>Close</Button>}>
    <Field label={competitorLabel(state)}><Select value={id} onChange={e => setId(e.target.value)}>{players.map((p: Player) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
    {rows.length === 0 ? <p className="dd-meta">No matches yet.</p> : <ul className="dk-dlg-list">{rows.map(r => <li key={r.round}><span className="dk-num" style={{ width: 70 }}>Round {r.round}</span><span style={{ flex: 1 }}>{r.table !== null ? `Table ${r.table} · ` : ""}vs {r.opp}</span><span className="dd-chip dd-chip--muted">{r.res}</span></li>)}</ul>}
  </Dialog>;
}

export function ConfirmBody({ children }: { children: ReactNode }) { return <>{children}</>; }

/* ---------- Player notes and penalties (Ctrl+K) ---------- */
export function PlayerNotesDialog({ desk, role, send, onClose }: Base & { role: StaffRole }) {
  const { state } = desk;
  const players = useMemo(() => [...state.players].sort(byName), [state.players]);
  const [playerId, setPlayerId] = useState("");
  const player = state.players.find(p => p.id === playerId) ?? null;
  const [notes, setNotes] = useState("");
  const [infractionId, setInfractionId] = useState(state.settings.infractions[0]?.id ?? "");
  const [penalty, setPenalty] = useState("");
  const [pnotes, setPnotes] = useState("");
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const canNotes = can(role, "UpdatePlayer") && state.phase !== "complete", canPen = can(role, "AddPenalty") && state.phase !== "complete", canRemove = can(role, "RemovePenalty");
  const mine = state.penalties.filter(p => p.playerId === playerId);
  const infLabel = (id: string) => state.settings.infractions.find(i => i.id === id)?.label ?? id;
  const pick = (id: string) => { setPlayerId(id); setNotes(state.players.find(p => p.id === id)?.notes ?? ""); setMsg(null); };
  const run = async (command: Parameters<SendFn>[0], ok: string) => { const r = await send(command); setMsg(r.ok ? { bad: false, text: ok } : { bad: true, text: r.message }); return r.ok; };
  return <Dialog open onClose={onClose} title="Player Notes and Penalties" actions={<Button onClick={onClose}>Close</Button>}>
    <Wide />
    <Field label="Player"><Select value={playerId} onChange={e => pick(e.target.value)} autoFocus><option value="">Choose a player</option>{players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
    {player && <>
      <section className="dk-sec" style={{ gap: 8 }} aria-label="Notes">
        <Field label="Notes" hint={canNotes ? "Seating, accessibility, anything the desk should remember." : "Your role can read notes but not change them."}>
          <Textarea rows={3} value={notes} disabled={!canNotes} maxLength={1000} onChange={e => setNotes(e.target.value)} />
        </Field>
        {canNotes && <div><Button variant="violet" disabled={notes === (player.notes ?? "")} onClick={() => void run({ type: "UpdatePlayer", playerId: player.id, notes: notes.trim() || null }, "Notes saved.")}>Save notes</Button></div>}
      </section>
      <section className="dk-sec" style={{ gap: 8 }} aria-label="Penalties">
        <b style={{ fontWeight: 600 }}>Penalties ({mine.length})</b>
        {mine.length === 0 ? <span className="dd-meta">None recorded.</span> : <ul className="dk-dlg-list">{mine.map(p => <li key={p.id}>
          <span className="dk-num" style={{ width: 58 }}>{p.round ? `Round ${p.round}` : "—"}</span>
          <span style={{ flex: 1 }}>{infLabel(p.infractionId)}{p.notes ? <span className="dd-meta"> · {p.notes}</span> : null}</span>
          <span className="dd-chip dd-chip--muted">{PEN[p.penalty]}</span>
          {canRemove && state.phase !== "complete" && <Button size="sm" aria-label={`Remove ${infLabel(p.infractionId)} penalty`} onClick={() => void run({ type: "RemovePenalty", penaltyId: p.id }, "Penalty removed.")}>Remove</Button>}
        </li>)}</ul>}
        {canPen && <div className="dk-dlg-row">
          <Field label="Infraction"><Select value={infractionId} onChange={e => setInfractionId(e.target.value)}>{state.settings.infractions.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}</Select></Field>
          <Field label="Penalty"><Select value={penalty} onChange={e => setPenalty(e.target.value)}><option value="">Use default</option>{(Object.keys(PEN) as (keyof typeof PEN)[]).map(k => <option key={k} value={k}>{PEN[k]}</option>)}</Select></Field>
          <Field label="Notes"><Input value={pnotes} onChange={e => setPnotes(e.target.value)} placeholder="Optional" autoComplete="off" /></Field>
          <Button variant="violet" onClick={async () => { if (await run({ type: "AddPenalty", playerId: player.id, infractionId, ...(penalty ? { penalty: penalty as keyof typeof PEN } : {}), round: state.rounds.at(-1)?.number ?? null, notes: pnotes.trim() || null }, "Penalty recorded.")) setPnotes(""); }}>Record penalty</Button>
        </div>}
      </section>
    </>}
    {msg && <p role="status" className={msg.bad ? "dd-error" : "dd-meta"}>{msg.text}</p>}
  </Dialog>;
}

/* ---------- Dummy data ---------- */
export function AddTestPlayersDialog({ code, desk, replaceDesk, onClose, onDone }: Close & { code: string; desk: DeskView; replaceDesk: (d: DeskView) => void; onDone: (t: string) => void }) {
  const [count, setCount] = useState("16");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = Number(count);
  const valid = Number.isInteger(n) && n >= 1 && n <= 256;
  async function run() {
    setBusy(true); setErr(null);
    const r = await postDummy(code, desk, { action: "players", count: n });
    setBusy(false);
    if (!r.ok) { if (r.desk) replaceDesk(r.desk); setErr(r.message); return; }
    replaceDesk(r.desk); onDone(`Added ${r.count} test players.`); onClose();
  }
  return <Dialog open onClose={onClose} title="Add Test Players" actions={<><Button onClick={onClose}>Cancel</Button><Button variant="violet" disabled={!valid || busy} onClick={() => void run()}>Add players</Button></>}>
    <p className="dd-meta" style={{ margin: 0 }}>Adds made-up players so you can practice pairing and results. Registration only.</p>
    <Field label="How many (1 to 256)" error={count !== "" && !valid ? "Enter a whole number from 1 to 256." : undefined}>
      <Input inputMode="numeric" value={count} onChange={e => setCount(e.target.value.replace(/\D/g, "").slice(0, 3))} autoFocus onKeyDown={e => { if (e.key === "Enter" && valid && !busy) { e.preventDefault(); void run(); } }} />
    </Field>
    <Err text={err} />
  </Dialog>;
}

/* ---------- Recent log entries ---------- */
type LogEntry = { actor: string; at: string; action: string };
const logWords = (action: string) => action.replace(/([a-z])([A-Z])/g, "$1 $2");
export function LogDialog({ code, state, onClose }: Close & { code: string; state: EventState }) {
  const [rows, setRows] = useState<LogEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/events/${encodeURIComponent(code)}/activity`, { cache: "no-store" });
        if (!r.ok) throw new Error("bad");
        const body = (await r.json()) as { activity: LogEntry[] };
        if (alive) setRows(body.activity.slice(0, 200));
      } catch { if (alive) setErr("Could not load the log. Close this window and try again."); }
    })();
    return () => { alive = false; };
  }, [code]);
  // The log stores the account id. Show the staff or player name when we know it.
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of state.players) if (p.userId !== null) m.set(String(p.userId), p.name);
    for (const t of state.staff) m.set(String(t.userId), t.name);
    return m;
  }, [state]);
  const who = (actor: string) => names.get(actor) ?? (/^\d+$/.test(actor) ? `Account #${actor}` : actor);
  const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" }); };
  return <Dialog open onClose={onClose} title="Recent Log Entries" actions={<Button onClick={onClose} autoFocus>Close</Button>}>
    <Wide />
    <Err text={err} />
    {!rows && !err && <p role="status" className="dd-meta" style={{ margin: 0 }}>Loading…</p>}
    {rows && rows.length === 0 && <p className="dd-meta" style={{ margin: 0 }}>Nothing has been logged yet.</p>}
    {rows && rows.length > 0 && <div className="dk-log" role="table" aria-label="Recent log entries">
      <div role="row" className="dk-log-row dk-log-head dd-caps"><span role="columnheader">Time</span><span role="columnheader">Who</span><span role="columnheader">Action</span></div>
      {rows.map((r, i) => <div role="row" key={i} className="dk-log-row"><span role="cell">{when(r.at)}</span><span role="cell">{who(r.actor)}</span><span role="cell">{logWords(r.action)}</span></div>)}
    </div>}
  </Dialog>;
}

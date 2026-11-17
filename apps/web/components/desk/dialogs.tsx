"use client";
import { useMemo, useState, type ReactNode } from "react";
import type { DeskView, EventState, Match, Player, StaffRole } from "@dd-tournament/engine";
import { Button, ButtonLink, Dialog, Field, Input, Keycap, Radio, Select } from "../ui";
import { STAMP_TEXT, byName, clockLabel, formatClock, playerById, roundTitle } from "./helpers";
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
  const sizes = [2, 4, 8, 16, 32, 64].filter(n => n <= rows.length);
  const [mode, setMode] = useState<"playoff" | "top" | "min_points">("playoff");
  const [size, setSize] = useState(sizes.includes(state.settings.topCut) ? state.settings.topCut : sizes.includes(8) ? 8 : sizes.at(-1) ?? 2);
  const [top, setTop] = useState(Math.max(2, Math.min(rows.length, 8)));
  const [points, setPoints] = useState(9);
  const n = mode === "playoff" ? size : top;
  const tied = mode !== "min_points" && rows[n] && rows[n - 1] && rows[n]!.rank === rows[n - 1]!.rank ? rows.filter(r => r.rank === rows[n - 1]!.rank) : [];
  const [order, setOrder] = useState<string[] | null>(null);
  const tieOrder = tied.length ? (order && order.length === tied.length && order.every(id => tied.some(t => t.playerId === id)) ? order : tied.map(t => t.playerId)) : undefined;
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastCut = state.swissCuts.at(-1);
  const names = playerById(state);
  const move = (i: number, d: number) => { const o = [...(tieOrder ?? [])]; const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j]!, o[i]!]; setOrder(o); };

  async function apply() {
    setBusy(true); setErr(null);
    const res = await send(mode === "playoff" ? { type: "CutToPlayoff", size, ...(tieOrder ? { tieOrder } : {}) }
      : mode === "top" ? { type: "SwissCut", mode: "top", value: top, ...(tieOrder ? { tieOrder } : {}) } : { type: "SwissCut", mode: "min_points", value: points });
    setBusy(false);
    if (!res.ok) { setErr(res.message); return; }
    onDone(mode === "playoff" ? `Cut to the top ${size}. Playoff round paired.` : "Day-2 cut applied. Swiss continues with the remaining players.");
    onClose();
  }
  return <Dialog open onClose={onClose} title="Cut to Playoffs" actions={<>
    <Button onClick={onClose}>Cancel</Button>
    <Button variant="rose" disabled={busy || rows.length < 2 || (mode === "playoff" && sizes.length === 0)} onClick={() => void apply()}>{mode === "playoff" ? "Cut and pair playoffs" : "Apply Day-2 cut"}</Button>
  </>}>
    <Wide />
    <div role="radiogroup" aria-label="Cut type">
      <Radio name="cut-mode" label="Single-elimination playoffs: the top players play a bracket" checked={mode === "playoff"} onChange={() => setMode("playoff")} />
      <Radio name="cut-mode" label="Day-2 cut by rank: keep the top players, Swiss continues" checked={mode === "top"} onChange={() => setMode("top")} />
      <Radio name="cut-mode" label="Day-2 cut by points: drop players under a point total, Swiss continues" checked={mode === "min_points"} onChange={() => setMode("min_points")} />
    </div>
    <div className="dk-dlg-row">
      {mode === "playoff" && <Field label="Players in the bracket"><Select value={size} onChange={e => { setSize(Number(e.target.value)); setOrder(null); }}>{sizes.map(s => <option key={s} value={s}>Top {s}</option>)}</Select></Field>}
      {mode === "top" && <Field label="Players to keep"><Input type="number" min={2} max={rows.length} value={top} onChange={e => { setTop(Number(e.target.value)); setOrder(null); }} /></Field>}
      {mode === "min_points" && <Field label="Minimum match points to stay"><Input type="number" min={0} value={points} onChange={e => setPoints(Number(e.target.value))} /></Field>}
    </div>
    {tied.length > 0 && <div role="group" aria-label="Seeding order at the cut" className="dk-slip" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <b style={{ fontWeight: 600 }}>{tied.length} players are tied across the cut line</b>
      <span className="dd-meta">The first {tied.filter((_, i) => (tied[0] ? rows.indexOf(tied[0]) + i : i) < n).length} in this order make the cut. Move players up or down to decide, or keep the order as it is.</span>
      <ul className="dk-dlg-list">{(tieOrder ?? []).map((id, i) => {
        const inCut = rows.indexOf(tied[0]!) + i < n;
        return <li key={id}><span style={{ flex: 1 }}>{names.get(id)?.name}</span><span className="dd-chip dd-chip--muted">{inCut ? "In" : "Out"}</span>
          <Button size="sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${names.get(id)?.name} up`}>Up</Button>
          <Button size="sm" onClick={() => move(i, 1)} disabled={i === (tieOrder?.length ?? 0) - 1} aria-label={`Move ${names.get(id)?.name} down`}>Down</Button></li>;
      })}</ul>
    </div>}
    {lastCut && !lastCut.roundPairedAfter && state.phase !== "playoff" && <div className="dk-dlg-row" style={{ alignItems: "center" }}>
      <span className="dd-meta" style={{ flex: "1 1 auto" }}>A Day-2 cut after round {lastCut.afterRound} is in place ({lastCut.cutPlayers.length} players cut).</span>
      <Button size="sm" onClick={async () => { const r = await send({ type: "UndoSwissCut" }); if (r.ok) { onDone("Day-2 cut undone."); onClose(); } else setErr(r.message); }}>Undo that cut</Button></div>}
    <Err text={err} />
  </Dialog>;
}

/* ---------- Undrop wizard ---------- */
const UNDROP = [
  ["bye_loss", "Join this round with a loss bye"], ["bye_win", "Join this round with a win bye"], ["next_round", "Re-enter from the next round (no match this round)"],
  ["swap_with_dropped", "Take another dropped player's seat in this round"], ["take_bye", "Take an active player's bye in this round"],
] as const;
export function UndropDialog({ desk, send, onClose, onDone }: Base & { onDone: (t: string) => void }) {
  const { state } = desk;
  const round = state.rounds.at(-1);
  const dropped = useMemo(() => state.players.filter(p => p.status === "dropped").sort(byName), [state.players]);
  const [playerId, setPlayerId] = useState(dropped[0]?.id ?? "");
  const [option, setOption] = useState<(typeof UNDROP)[number][0]>("next_round");
  const [swapWith, setSwapWith] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const paired = !!round && round.matches.some(m => m.p1 === playerId || m.p2 === playerId);
  const swaps = dropped.filter(p => p.id !== playerId && round?.matches.some(m => (m.p1 === p.id || m.p2 === p.id) && m.result === null));
  const hasBye = !!round?.matches.some(m => m.p2 === null && m.result === "bye_win" && state.players.find(p => p.id === m.p1)?.status === "active");
  const allowed = (o: string) => !round ? o === "next_round" : paired ? o === "next_round" : o === "swap_with_dropped" ? swaps.length > 0 : o === "take_bye" ? hasBye : true;
  const effective = allowed(option) ? option : "next_round";
  async function run() {
    const res = await send({ type: "UndropPlayer", playerId, option: effective, ...(effective === "swap_with_dropped" ? { swapWith: swapWith || swaps[0]?.id } : {}) });
    if (!res.ok) { setErr(res.message); return; }
    onDone(`${state.players.find(p => p.id === playerId)?.name} is back in the event.`); onClose();
  }
  return <Dialog open onClose={onClose} title="Undrop Player" actions={<><Button onClick={onClose}>Cancel</Button><Button variant="violet" disabled={!playerId || state.phase === "playoff"} onClick={() => void run()}>Undrop player</Button></>}>
    {dropped.length === 0 ? <p className="dd-meta">Nobody has dropped.</p> : <>
      {state.phase === "playoff" && <p className="dd-error"><WarnIcon size={14} />Dropped players cannot re-enter the playoff bracket.</p>}
      <Field label="Dropped player"><Select value={playerId} onChange={e => setPlayerId(e.target.value)}>{dropped.map(p => <option key={p.id} value={p.id}>{p.name} (R{p.droppedAfterRound ?? 0})</option>)}</Select></Field>
      <div role="radiogroup" aria-label="Where they re-enter">
        {UNDROP.map(([o, label]) => <Radio key={o} name="undrop" label={label} checked={effective === o} disabled={!allowed(o)} onChange={() => setOption(o)} hint={!allowed(o) && round ? (paired ? "(already has a match this round)" : o === "swap_with_dropped" ? "(no open dropped seat)" : "(no bye to take)") : undefined} />)}
      </div>
      {effective === "swap_with_dropped" && <Field label="Take the seat of"><Select value={swapWith || swaps[0]?.id || ""} onChange={e => setSwapWith(e.target.value)}>{swaps.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}
      <Err text={err} />
    </>}
  </Dialog>;
}

/* ---------- Change Result wizard ---------- */
export function ChangeResultDialog({ desk, send, onClose, onDone }: Base & { onDone: (t: string) => void }) {
  const { state } = desk;
  const [round, setRound] = useState(state.rounds.at(-1)?.number ?? 1);
  const [table, setTable] = useState("");
  const [result, setResult] = useState<"p1" | "p2" | "draw" | "double_loss" | "clear">("p1");
  const [drop, setDrop] = useState<"none" | "loser" | "both">("none");
  const [err, setErr] = useState<string | null>(null);
  const names = playerById(state);
  const match = state.rounds.find(r => r.number === round)?.matches.find(m => m.table === Number(table));
  const p1 = match && names.get(match.p1)?.name, p2 = match?.p2 ? names.get(match.p2)?.name : null;
  async function run() {
    if (!match) { setErr(`No table ${table || "?"} in round ${round}.`); return; }
    const res = await send({ type: "EnterResult", matchId: match.id, result: result === "clear" ? null : result, drop: result === "clear" ? "none" : drop });
    if (!res.ok) { setErr(res.message); return; }
    onDone(`Round ${round}, table ${match.table} updated.`); onClose();
  }
  return <Dialog open onClose={onClose} title="Change Match Result" actions={<><Button onClick={onClose}>Cancel</Button><Button variant="violet" disabled={!match || !p2} onClick={() => void run()}>Change result</Button></>}>
    <div className="dk-dlg-row">
      <Field label="Round"><Select value={round} onChange={e => setRound(Number(e.target.value))}>{state.rounds.map(r => <option key={r.number} value={r.number}>{roundTitle(r)}</option>)}</Select></Field>
      <Field label="Table"><Input inputMode="numeric" value={table} onChange={e => setTable(e.target.value.replace(/\D/g, ""))} autoFocus /></Field>
    </div>
    {match ? <p style={{ margin: 0 }}><b style={{ fontWeight: 600 }}>{p1}</b> vs <b style={{ fontWeight: 600 }}>{p2 ?? "Bye"}</b> · now {match.result ? STAMP_TEXT[match.result] : "Unreported"}</p> : <p className="dd-meta" style={{ margin: 0 }}>Enter a table to load the match.</p>}
    <div role="radiogroup" aria-label="New result">
      <Radio name="cr" label={`${p1 ?? "Player 1"} Wins ( - )`} checked={result === "p1"} onChange={() => setResult("p1")} />
      <Radio name="cr" label={`${p2 ?? "Player 2"} Wins ( + )`} checked={result === "p2"} onChange={() => setResult("p2")} />
      <Radio name="cr" label="Draw ( * )" checked={result === "draw"} onChange={() => setResult("draw")} />
      <Radio name="cr" label="Double Loss ( / )" checked={result === "double_loss"} onChange={() => setResult("double_loss")} />
      <Radio name="cr" label="Unreported ( $ )" checked={result === "clear"} onChange={() => setResult("clear")} />
    </div>
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
export function ImportDialog({ code, kind: initial, onClose, onDone, replaceDesk }: Close & { code: string; kind: "tournament" | "players"; onDone: (t: string) => void; replaceDesk: (d: DeskView) => void }) {
  const [kind, setKind] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  async function run() {
    if (!file) { setErr("Choose a file."); return; }
    setBusy(true); setErr(null);
    const form = new FormData(); form.set("file", file); form.set("kind", kind);
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(code)}/import`, { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { desk?: DeskView; imported?: number; unmatched?: number; error?: string; message?: string };
      if (!res.ok || !body.desk) { setErr(MESSAGES[body.error ?? ""] ?? (body.error === "REGISTRATION_ONLY" ? "Player lists import during registration only." : body.message ?? "That file could not be imported.")); setBusy(false); return; }
      replaceDesk(body.desk);
      onDone(`Imported ${body.imported ?? 0} players${body.unmatched ? `, ${body.unmatched} without a matching account (they can join later with their COSSY ID)` : ""}.`);
      onClose();
    } catch { setErr("Could not reach the server."); setBusy(false); }
  }
  return <Dialog open onClose={onClose} title="Import" actions={<><Button onClick={onClose}>Cancel</Button><Button variant="violet" disabled={busy || !file} onClick={() => void run()}>Import</Button></>}>
    <div role="radiogroup" aria-label="What to import">
      <Radio name="imp" label="Player list (AllPlayers XML), adds players during registration" checked={kind === "players"} onChange={() => setKind("players")} />
      <Radio name="imp" label="Tournament file (.Tournament), replaces players and rounds" checked={kind === "tournament"} onChange={() => setKind("tournament")} />
    </div>
    {kind === "tournament" && <p className="dd-meta" style={{ margin: 0 }}>This replaces the players and rounds in this event. Staff stay as they are.</p>}
    <Field label="File"><input className="dd-input" type="file" accept=".xml,.Tournament,.tournament,text/xml,application/xml" onChange={e => setFile(e.target.files?.[0] ?? null)} /></Field>
    <Err text={err} />
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
  const nm = (id: string) => desk.state.players.find(p => p.id === id)?.name ?? "Unknown";
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
  const players = [...state.players].sort(byName);
  const [id, setId] = useState(players[0]?.id ?? "");
  const names = playerById(state);
  const rows = state.rounds.flatMap(r => r.matches.filter(m => m.p1 === id || m.p2 === id).map(m => {
    const me1 = m.p1 === id; const opp = me1 ? m.p2 : m.p1;
    const res = m.result === null ? "Unreported" : m.result === "draw" ? "Draw" : m.result === "double_loss" ? "Double loss" : m.result === "bye_win" ? "Bye (win)" : m.result === "bye_loss" ? "Bye (loss)" : (m.result === "p1") === me1 ? "Win" : "Loss";
    return { round: r.number, table: m.table, opp: opp ? names.get(opp)?.name ?? "Unknown" : "Bye", res };
  }));
  return <Dialog open onClose={onClose} title="Player Match History" actions={<Button onClick={onClose} autoFocus>Close</Button>}>
    <Field label="Player"><Select value={id} onChange={e => setId(e.target.value)}>{players.map((p: Player) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
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
          <textarea className="dd-input" rows={3} value={notes} disabled={!canNotes} maxLength={1000} onChange={e => setNotes(e.target.value)} style={{ height: "auto", paddingBlock: 8 }} />
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

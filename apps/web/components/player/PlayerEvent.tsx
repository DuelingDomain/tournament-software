"use client";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { MatchResult, PlayerView } from "@dd-tournament/engine";
import { Button, ButtonLink, ConfirmDialog, Field, Input, LogoMark, Perforation, Slip, Stamp } from "../ui";
import { phaseLabel } from "../event/format";
import { RoundTimer } from "../event/RoundTimer";

type Response =
  | { joined: true; view: PlayerView }
  | { joined: false; canJoin: boolean; reason?: "closed" | "member_id_required" | "late_entry_closed"; memberId: string | null };
type Load = { status: "loading" } | { status: "signed_out" } | { status: "missing" } | { status: "error" } | { status: "ok"; data: Response };

const ERRORS: Record<string, string> = {
  member_id_taken: "That COSSY ID belongs to another account.", invalid_member_id: "Enter the 10 digit COSSY ID from your card.",
  RESULT_ALREADY_ENTERED: "A judge already entered this result.", CURRENT_ROUND_ONLY: "That round is over.", not_joined: "You have not joined this event.",
  REGISTRATION_CLOSED: "Registration is closed.", forbidden: "You cannot do that.",
};
const errorText = (code: string | undefined, fallback: string) => (code && ERRORS[code]) || fallback;

async function call(path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const response = await fetch(path, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

export function PlayerEvent({ code }: { code: string }) {
  const base = `/api/events/${encodeURIComponent(code)}`;
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await call(`${base}/me`);
      if (r.status === 401) setLoad({ status: "signed_out" });
      else if (r.status === 404) setLoad({ status: "missing" });
      else if (!r.ok) setLoad(l => (l.status === "ok" ? l : { status: "error" }));
      else setLoad({ status: "ok", data: r.data as unknown as Response });
    } catch { setLoad(l => (l.status === "ok" ? l : { status: "error" })); }
  }, [base]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  async function send(action: string, body: unknown, failure: string): Promise<boolean> {
    setNote("");
    try {
      const r = await call(`${base}/${action}`, body);
      if (!r.ok) { setNote(errorText(r.data.error as string | undefined, failure)); void refresh(); return false; }
      setLoad({ status: "ok", data: r.data as unknown as Response });
      return true;
    } catch { setNote(failure); return false; }
  }

  if (load.status === "loading") return <Frame><p role="status" className="dd-meta">Loading your event...</p></Frame>;
  if (load.status === "missing") return <Frame><h1 className="dd-display" style={{ margin: 0, fontSize: 28 }}>Event not found</h1><p>Check the link. The event code is <span className="dd-mono">{code}</span>.</p></Frame>;
  if (load.status === "error") return <Frame><p role="alert" className="dd-error">Could not load this event. <Button size="sm" onClick={() => void refresh()}>Try again</Button></p></Frame>;
  if (load.status === "signed_out") return <Frame>
    <h1 className="dd-display" style={{ margin: 0, fontSize: 28 }}>Join this event</h1>
    <p style={{ margin: 0 }}>Sign in with your Dueling Domain account to join, see your table and report results.</p>
    <ButtonLink variant="rose" size="lg" block href={`/auth/start?return=${encodeURIComponent(`/e/${code}/me`)}`}>Sign in with Dueling Domain</ButtonLink>
    <a href={`/e/${code}`} className="pl-link">View pairings and standings</a>
  </Frame>;

  const { data } = load;
  if (!data.joined) return <JoinForm code={code} data={data} note={note} onJoin={memberId => send("join", memberId ? { memberId } : {}, "Could not join. Try again.")} />;
  return <Joined code={code} view={data.view} note={note} send={send} />;
}

function Frame({ children, strip }: { children: ReactNode; strip?: ReactNode }) {
  return <div className="pl-page">
    <header className="pl-strip">{strip ?? <><a href="/" className="pl-brand" aria-label="DD Tournaments home"><LogoMark /></a><span className="pl-strip-name">DD Tournaments</span></>}</header>
    <main className="pl-main">{children}</main>
  </div>;
}

const JOIN_REASON: Record<string, string> = {
  closed: "Registration is closed for this event. Ask the organizer if you should be added.",
  late_entry_closed: "This event has started and late entry is closed. Ask the organizer.",
};

function JoinForm({ code, data, note, onJoin }: { code: string; data: Extract<Response, { joined: false }>; note: string; onJoin: (memberId: string) => Promise<boolean> }) {
  const [busy, setBusy] = useState(false);
  const required = data.reason === "member_id_required";
  const blocked = !data.canJoin && !required;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = String(new FormData(event.currentTarget).get("memberId") ?? "").replace(/\s/g, "");
    setBusy(true); await onJoin(id); setBusy(false);
  }
  return <Frame>
    <h1 className="dd-display" style={{ margin: 0, fontSize: 28 }}>Join this event</h1>
    {blocked ? <p role="status" style={{ margin: 0 }}>{JOIN_REASON[data.reason ?? "closed"] ?? JOIN_REASON.closed}</p> : <form onSubmit={submit} className="pl-form">
      <Field label="COSSY ID" hint={required ? "This event requires your 10 digit COSSY ID." : "Optional. Add it so the organizer can match your record."}>
        <Input name="memberId" mono inputMode="numeric" autoComplete="off" pattern="[0-9 ]*" maxLength={14} defaultValue={data.memberId ?? ""} required={required} />
      </Field>
      <Button type="submit" variant="rose" size="lg" block disabled={busy}>{busy ? "Joining..." : "Join event"}</Button>
    </form>}
    {note && <p role="alert" className="dd-error">{note}</p>}
    <a href={`/e/${code}`} className="pl-link">View pairings and standings</a>
  </Frame>;
}

type SendFn = (action: string, body: unknown, failure: string) => Promise<boolean>;

function resultText(result: MatchResult | null, mine: "p1" | "p2", opponent: string): string {
  if (result === null) return "";
  if (result === "draw") return "Draw";
  if (result === "double_loss") return "Double loss";
  if (result === "bye_win") return "Bye";
  if (result === "bye_loss") return "Bye loss";
  return result === mine ? "I won" : `${opponent} won`;
}

function Joined({ code, view, note, send }: { code: string; view: PlayerView; note: string; send: SendFn }) {
  const { event, me, currentMatch: match, history } = view;
  const round = event.currentRound;
  const [confirmDrop, setConfirmDrop] = useState(false);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = event.phase === "swiss" || event.phase === "playoff";

  const myId = me.teamId ?? me.id; // in a team event matches are between teams
  const mySide: "p1" | "p2" | null = match ? (match.p1Id === myId ? "p1" : "p2") : null;
  const teamMatch = !!match && match.tables.length > 1;
  const oppMembers = match ? (mySide === "p1" ? match.p2Members : match.p1Members) : [];
  const myMembers = match ? (mySide === "p1" ? match.p1Members : match.p2Members) : [];
  const opponent = match ? (mySide === "p1" ? match.p2 : match.p1) : null;
  const iWon: MatchResult = mySide ?? "p1";
  const oppWon: MatchResult = mySide === "p1" ? "p2" : "p1";
  const opp = opponent ?? "your opponent";
  const dropped = me.status === "dropped";
  const record = me.standing ? `${me.standing.record.wins}-${me.standing.record.losses}-${me.standing.record.draws}` : "0-0-0";

  const decided = match?.result != null;
  const bye = !!match && match.p2 === null;
  const waiting = !!match && !decided && match.myReport !== null && match.opponentReport === null;
  const mismatch = !!match && !decided && match.myReport !== null && match.opponentReport !== null && match.myReport !== match.opponentReport;
  const locked = !match || decided || bye || dropped || (match.myReport !== null && !changing && !mismatch);

  async function report(result: MatchResult) {
    if (!match) return;
    setBusy(true);
    const ok = await send("report", { matchId: match.id, result }, "Could not send your report. Try again.");
    if (ok) setChanging(false);
    setBusy(false);
  }
  async function drop() {
    setBusy(true);
    await send("drop", {}, "Could not drop. Ask a judge.");
    setConfirmDrop(false); setBusy(false);
  }

  const strip = <>
    <a href="/" className="pl-brand" aria-label="DD Tournaments home"><LogoMark /></a>
    <span className="pl-strip-name">{event.name}</span>
    {live && round && <span className="dd-chip">R{round.number}</span>}
    {live && <span className="pl-timer"><span className="dd-pip" aria-hidden="true" /><RoundTimer round={round} suffix="" /></span>}
  </>;

  let heading: ReactNode;
  let status: ReactNode = null;
  if (dropped) {
    heading = <h1 className="pl-big">Dropped</h1>;
    status = <p style={{ margin: 0 }}>You dropped from this event. Ask a judge if that was a mistake.</p>;
  } else if (!match) {
    heading = <h1 className="pl-big pl-big--sm">{event.phase === "registration" ? "You're in" : event.phase === "complete" ? "Event over" : "No match yet"}</h1>;
    status = <p style={{ margin: 0 }}>{event.phase === "registration" ? "Your table shows here when round 1 is paired." : event.phase === "complete" ? "Thanks for playing. Final standings are on the public page." : live ? "You are not paired this round. Check with a judge." : ""}</p>;
  } else {
    heading = <h1 className="pl-big">{bye ? "Bye" : `Table ${match.myTable ?? match.table ?? "?"}`}</h1>;
  }

  return <Frame strip={strip}>
    <Slip as="section" card aria-label="Your match" className="pl-card">
      <span className="dd-caps">{phaseLabel(event)}</span>
      {heading}
      {match && !bye && <div className="pl-opp"><span style={{ color: "var(--text-2)" }}>vs</span><span className="pl-opp-name">{opponent}</span></div>}
      {match && !bye && oppMembers.length > 0 && <p className="pl-members" style={{ margin: 0 }}>{oppMembers.map(m => m.name).join(", ")}</p>}
      {teamMatch && !bye && <p className="dd-meta" style={{ margin: 0 }}>Your team plays on tables {match.tables[0]}–{match.tables.at(-1)}{myMembers.length > 0 ? `: ${myMembers.map((m, i) => `${m.name} (table ${match.tables[i] ?? "?"})`).join(", ")}` : ""}.</p>}
      {bye && <p style={{ margin: 0 }}>You have a bye this round. It scores as a win.</p>}
      {(match || status) && <Perforation />}
      <div role="status" className="pl-status">
        {status}
        {match && !bye && !dropped && decided && <>
          <Stamp kind={match.result === "draw" ? "draw" : match.result === "double_loss" ? "double_loss" : "plain"} size="lg" still>{resultText(match.result, mySide ?? "p1", opp)}</Stamp>
          <span>Result confirmed.</span></>}
        {match && !bye && !dropped && waiting && <><Stamp kind="awaiting" size="lg" still />
          <span>Waiting for {opp} to confirm</span></>}
        {match && !bye && !dropped && mismatch && <><Stamp kind="double_loss" size="lg" still>Mismatch</Stamp>
          <span>You and {opp} reported different results. Fix yours, or ask a judge.</span></>}
        {match && !bye && !dropped && !decided && match.myReport === null && match.opponentReport !== null && <>
          <Stamp kind="awaiting" size="lg" still>Confirm needed</Stamp>
          <span>{opp} reported: {resultText(match.opponentReport, mySide ?? "p1", opp)}. Report yours to confirm.</span></>}
        {match && !bye && !dropped && !decided && match.myReport === null && match.opponentReport === null && <span>Play your match, then report the result.</span>}
      </div>
    </Slip>

    {match && !bye && !dropped && <section aria-labelledby="rep-h" className="pl-report">
      <h2 id="rep-h" className="dd-caps" style={{ margin: 0 }}>Report result</h2>
      <div className="pl-report-grid">
        {([[iWon, "I won"], [oppWon, `${opp} won`], ["draw", "Draw"]] as [MatchResult, string][]).map(([result, label]) => {
          const mine = match.myReport === result;
          return <button key={result} type="button" className={`pl-rep${mine ? " pl-rep--mine" : ""}`} disabled={locked || busy} aria-pressed={mine} onClick={() => void report(result)}>
            <span>{label}</span>{mine && <span className="pl-sent">{decided ? "Confirmed" : "Sent"}</span>}
          </button>;
        })}
      </div>
      {match.myReport !== null && !decided && <div className="pl-undo">
        <span>You reported: <strong>{resultText(match.myReport, mySide ?? "p1", opp)}</strong></span>
        {!changing && !mismatch && <Button size="sm" onClick={() => setChanging(true)}>Change report</Button>}
        {changing && <Button size="sm" onClick={() => setChanging(false)}>Keep it</Button>}
      </div>}
    </section>}

    <section aria-label="Your record" className="pl-record">
      <div style={{ display: "grid", gap: 6 }}>
        <span className="dd-caps">My record</span>
        <span className="dd-display" style={{ fontSize: 28, lineHeight: 1 }}>{record}</span>
      </div>
      <div style={{ display: "grid", gap: 6, justifyItems: "end", fontSize: 13, color: "var(--text-2)" }}>
        <span>{me.name}</span>
        {me.standing && <span className="dd-num">Rank {me.standing.rank} · {me.standing.matchPoints} pts</span>}
      </div>
    </section>

    {history.some(h => h.result !== null) && <section aria-labelledby="hist-h" className="pl-history">
      <h2 id="hist-h" className="dd-caps" style={{ margin: 0 }}>History</h2>
      <ol className="pub-list">
        {history.filter(h => h.result !== null).map(h => <li key={h.round} className="pl-hrow">
          <span className="dd-caps">R{h.round}</span><span>{h.opponent ?? "Bye"}</span>
          <span style={{ fontWeight: 600 }}>{h.result === null ? "Unreported" : h.result === "win" ? "Win" : h.result === "loss" ? "Loss" : h.result === "draw" ? "Draw" : h.result === "double_loss" ? "Double loss" : h.result === "bye_win" ? "Bye win" : "Bye loss"}</span>
        </li>)}
      </ol>
    </section>}

    <nav aria-label="Event pages" className="pl-nav"><ButtonLink href={`/e/${code}`}>Pairings</ButtonLink><ButtonLink href={`/e/${code}`}>Standings</ButtonLink></nav>
    {note && <p role="alert" className="dd-error">{note}</p>}
    {!dropped && event.phase !== "complete" && <button type="button" className="pl-drop" onClick={() => setConfirmDrop(true)}>Drop from event</button>}
    <ConfirmDialog open={confirmDrop} title="Drop from this event?" message="You will leave the event and will not be paired in later rounds. A judge can undo this." confirmLabel="Drop me" busy={busy} onConfirm={() => void drop()} onCancel={() => setConfirmDrop(false)} />
  </Frame>;
}

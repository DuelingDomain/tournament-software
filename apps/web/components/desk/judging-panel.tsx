"use client";
import { useEffect, useMemo, useState } from "react";
import type { DeskView, Penalty, StaffRole } from "@dd-tournament/engine";
import { Button, Field, Input, Select } from "../ui";
import { PENALTY_LABEL, byName } from "./helpers";
import { can } from "./roles";
import type { SendFn } from "./use-desk";

const PENALTIES = Object.keys(PENALTY_LABEL) as Penalty[];

export function JudgingPanel({ desk, role, send }: { desk: DeskView; role: StaffRole; send: SendFn }) {
  const { state } = desk;
  const infractions = state.settings.infractions;
  const players = useMemo(() => [...state.players].sort(byName), [state.players]);
  const [playerId, setPlayerId] = useState("");
  const [infractionId, setInfractionId] = useState(infractions[0]?.id ?? "");
  const [penalty, setPenalty] = useState<Penalty | "">("");
  const [round, setRound] = useState<string>(String(state.rounds.at(-1)?.number ?? ""));
  const [judge, setJudge] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<{ bad: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const focusPlayer = () => document.getElementById("pen-player")?.focus();
  const writable = can(role, "AddPenalty") && state.phase !== "complete";

  useEffect(() => { const on = () => document.getElementById("pen-player")?.focus(); window.addEventListener("dk:focus-penalty", on); on(); return () => window.removeEventListener("dk:focus-penalty", on); }, []);
  const infraction = infractions.find(i => i.id === infractionId);
  const nameOf = (id: string) => state.players.find(p => p.id === id)?.name ?? "Unknown";
  const infLabel = (id: string) => infractions.find(i => i.id === id)?.label ?? id;

  async function add() {
    if (!playerId) { setMessage({ bad: true, text: "Choose a player." }); return; }
    setBusy(true); setMessage(null);
    const res = await send({ type: "AddPenalty", playerId, infractionId, ...(penalty ? { penalty } : {}), round: round === "" ? null : Number(round), judge: judge.trim() || null, notes: notes.trim() || null });
    setBusy(false);
    if (!res.ok) { setMessage({ bad: true, text: res.message }); return; }
    setMessage({ bad: false, text: `${PENALTY_LABEL[penalty || infraction?.defaultPenalty || "warning"]} recorded for ${nameOf(playerId)}.` });
    setNotes(""); focusPlayer();
  }

  return <div className="dk-sec">
    <h2 className="dk-h2">All penalties</h2>
    {writable ? <form className="dk-slip dk-sec" style={{ gap: 12 }} aria-label="Record a penalty" onSubmit={e => { e.preventDefault(); void add(); }}>
      <div className="dk-form-grid">
        <Field label="Player"><Select id="pen-player" value={playerId} onChange={e => setPlayerId(e.target.value)}>
          <option value="">Choose a player</option>{players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select></Field>
        <Field label="Infraction"><Select value={infractionId} onChange={e => { setInfractionId(e.target.value); setPenalty(""); }}>
          {infractions.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
        </Select></Field>
        <Field label="Penalty" hint={infraction ? `Default: ${PENALTY_LABEL[infraction.defaultPenalty]}` : undefined}><Select value={penalty} onChange={e => setPenalty(e.target.value as Penalty | "")}>
          <option value="">Use default</option>{PENALTIES.map(p => <option key={p} value={p}>{PENALTY_LABEL[p]}</option>)}
        </Select></Field>
        <Field label="Round"><Select value={round} onChange={e => setRound(e.target.value)}>
          <option value="">Not tied to a round</option>{state.rounds.map(r => <option key={r.number} value={r.number}>Round {r.number}</option>)}
        </Select></Field>
        <Field label="Judge"><Input value={judge} onChange={e => setJudge(e.target.value)} placeholder="Judge name (optional)" autoComplete="off" /></Field>
        <Field label="Notes"><Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="What happened (optional)" autoComplete="off" /></Field>
      </div>
      <div className="dk-btn-row" style={{ alignItems: "center" }}>
        <Button type="submit" variant="violet" disabled={busy}>Record penalty</Button>
        <span role="status" className={message?.bad ? "dd-error" : "dd-meta"}>{message?.text}</span>
      </div>
      <p className="dd-meta" style={{ margin: 0 }}>A game loss or match loss is recorded here only. Enter the result for that match on the Pairings panel.</p>
    </form> : <p className="dd-meta">Your role can read penalties but not record them.</p>}

    <div className="dd-scroll-x"><div className="dk-table" style={{ "--w": "760px" } as React.CSSProperties}>
      <div aria-hidden="true" className="dk-th dd-caps" style={{ gridTemplateColumns: "56px minmax(0,1.2fr) minmax(0,1.2fr) 140px 120px minmax(0,1fr) 96px" }}><span>Round</span><span>Player</span><span>Infraction</span><span>Penalty</span><span>Judge</span><span>Notes</span><span /></div>
      {state.penalties.length === 0 && <p className="dk-empty">No penalties recorded.</p>}
      <ul className="dk-list">{[...state.penalties].reverse().map(p => <li key={p.id} className="dk-trow" style={{ gridTemplateColumns: "56px minmax(0,1.2fr) minmax(0,1.2fr) 140px 120px minmax(0,1fr) 96px" }}>
        <span className="dk-num" style={{ textAlign: "center" }}>{p.round ?? "—"}</span>
        <span>{nameOf(p.playerId)}</span><span>{infLabel(p.infractionId)}</span>
        <span><span className={`dd-chip ${p.penalty === "caution" || p.penalty === "warning" ? "dd-chip--muted" : "dd-chip--rose"}`}>{PENALTY_LABEL[p.penalty]}</span></span>
        <span className="dd-meta">{p.judge ?? "—"}</span><span className="dd-meta" style={{ overflowWrap: "anywhere" }}>{p.notes ?? ""}</span>
        <span>{writable && <Button size="sm" variant="rose-outline" aria-label={`Remove ${PENALTY_LABEL[p.penalty]} for ${nameOf(p.playerId)}`} onClick={() => void send({ type: "RemovePenalty", penaltyId: p.id })}>Remove</Button>}</span>
      </li>)}</ul>
    </div></div>
  </div>;
}

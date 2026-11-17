"use client";
import { useMemo, useState } from "react";
import type { PublicMatchView, PublicView, Standing } from "@dd-tournament/engine";
import { EmptyStamp, Sheet, Stamp, Tabs, Wordmark } from "../ui";
import { eventMeta, phaseLabel } from "./format";
import { usePublicEvent } from "./live";
import { RoundTimer } from "./RoundTimer";

const STANDINGS_PREVIEW = 16;

function Winner({ name, won }: { name: string; won: boolean }) {
  return <span className="pub-name"><span style={{ fontWeight: won ? 600 : 400 }}>{name}</span>{won && <Stamp kind="plain" size="sm" still>Win</Stamp>}</span>;
}

function ResultCell({ m }: { m: PublicMatchView }) {
  switch (m.result) {
    case "p1": case "p2": return <span className="dd-meta">Final</span>;
    case "draw": return <Stamp kind="draw" still />;
    case "double_loss": return <Stamp kind="double_loss" still>Dbl loss</Stamp>;
    case "bye_win": case "bye_loss": return <span className="dd-meta">Bye</span>;
    default: return <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}><EmptyStamp />In progress</span>;
  }
}

function PairingRows({ matches }: { matches: PublicMatchView[] }) {
  return <ol className="pub-list" aria-label="Pairings">
    {matches.map(m => <li key={m.id} className="dd-table-row pub-prow">
      <span className="dd-display pub-table pub-a-t"><span className="dd-sr">Table </span>{m.table ?? "-"}</span>
      <span className="pub-a-1"><Winner name={m.p1} won={m.result === "p1"} /></span>
      <span className="pub-a-2">{m.p2 === null ? <span className="dd-meta">Bye</span> : <Winner name={m.p2} won={m.result === "p2"} />}</span>
      <span className="pub-a-r"><ResultCell m={m} /></span>
    </li>)}
  </ol>;
}

function StandingRows({ rows, topCut, expanded }: { rows: Standing[]; topCut: number; expanded: boolean }) {
  const shown = expanded ? rows : rows.slice(0, STANDINGS_PREVIEW);
  return <ol className="pub-list" aria-label="Standings">
    {shown.map((s, i) => <li key={s.playerId} className="pub-srow-wrap">
      <div className="dd-table-row pub-srow">
        <span className="dd-display pub-table" style={{ color: s.rank === 1 ? "var(--gold)" : undefined }}>{s.rank}</span>
        <span className="pub-ellipsis">{s.name}{s.status === "dropped" && <span className="dd-meta"> (dropped)</span>}</span>
        <span className="dd-num pub-r" style={{ fontWeight: 600 }}>{s.matchPoints}</span>
        <span className="dd-num pub-r">{s.record.wins}-{s.record.losses}-{s.record.draws}</span>
        <span className="dd-num pub-r pub-soft">{s.omw.toFixed(2)}</span>
        <span className="dd-num pub-r pub-soft pub-hide-sm">{s.oomw.toFixed(2)}</span>
      </div>
      {topCut > 0 && i === topCut - 1 && i < shown.length - 1 && <div role="separator" className="pub-cut"><span /><span className="dd-caps" style={{ color: "var(--text)" }}>Top {topCut} cut</span><span /></div>}
    </li>)}
  </ol>;
}

function Bracket({ view }: { view: PublicView }) {
  if (!view.bracket.length) return null;
  return <Sheet aria-labelledby="bracket-h" className="pub-sheet">
    <h2 id="bracket-h" className="dd-display" style={{ margin: 0, fontSize: 20 }}>Playoff bracket</h2>
    {view.bracket.map(round => <div key={round.round} style={{ display: "grid", gap: 8 }}>
      <h3 className="dd-caps" style={{ margin: 0 }}>Round {round.round}</h3>
      <PairingRows matches={round.matches} />
    </div>)}
  </Sheet>;
}

export function PublicEvent({ code }: { code: string }) {
  const { view, status, stale } = usePublicEvent(code);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("pairings");
  const [expanded, setExpanded] = useState(false);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => (view?.currentRound?.matches ?? []).filter(m => !q || m.p1.toLowerCase().includes(q) || (m.p2 ?? "").toLowerCase().includes(q)), [view, q]);
  const standings = useMemo(() => (view?.standings ?? []).filter(s => !q || s.name.toLowerCase().includes(q)), [view, q]);

  if (status === "loading") return <Shell><p role="status" className="dd-meta">Loading event...</p></Shell>;
  if (status === "missing") return <Shell><h1 className="dd-display pub-title">Event not found</h1><p>Check the link. The event code is <span className="dd-mono">{code}</span>.</p></Shell>;
  if (!view) return <Shell><p role="alert" style={{ color: "var(--rose-2)" }}>Could not load this event. Retrying.</p></Shell>;

  const round = view.currentRound;
  const played = round ? round.matches.filter(m => m.p2 !== null) : [];
  const reported = played.filter(m => m.result !== null).length;
  const live = view.phase === "swiss" || view.phase === "playoff";
  const pairingsSheet = <Sheet aria-labelledby="pair-h" className="pub-sheet" data-active={tab === "pairings"}>
    <div className="pub-sheet-head">
      <h2 id="pair-h" className="dd-display" style={{ margin: 0, fontSize: 20 }}>{round ? `Pairings · Round ${round.number}` : "Pairings"}</h2>
      {round && <span className="dd-meta dd-num">{reported} of {played.length} reported</span>}
    </div>
    {round ? matches.length ? <div className="dd-scroll-x"><div className="pub-minw-pair">
      <div aria-hidden="true" className="dd-caps pub-head pub-prow pub-head-pair"><span style={{ textAlign: "center" }}>Table</span><span>Player 1</span><span>Player 2</span><span>Result</span></div>
      <PairingRows matches={matches} />
    </div></div> : <p className="dd-meta">No pairing matches your search.</p>
      : <p className="dd-meta">{view.phase === "registration" ? "Pairings appear when the first round is paired." : "No round is in progress."}</p>}
  </Sheet>;
  const standingsSheet = <Sheet aria-labelledby="stand-h" className="pub-sheet pub-sheet--wide" data-active={tab === "standings"}>
    <div className="pub-sheet-head">
      <h2 id="stand-h" className="dd-display" style={{ margin: 0, fontSize: 20 }}>{view.phase === "complete" ? "Final standings" : "Standings · live"}</h2>
      {round && live && <span className="dd-meta">Includes {reported} reported round {round.number} matches</span>}
    </div>
    {standings.length ? <div className="dd-scroll-x"><div className="pub-minw-stand">
      <div aria-hidden="true" className="dd-caps pub-head pub-srow"><span style={{ textAlign: "center" }}>Rank</span><span>Player</span><span className="pub-r">Points</span><span className="pub-r">W-L-D</span><span className="pub-r">OMW%</span><span className="pub-r pub-hide-sm">OOMW%</span></div>
      <StandingRows rows={standings} topCut={q ? 0 : view.topCut} expanded={expanded || !!q} />
    </div></div> : <p className="dd-meta">{view.standings.length ? "No player matches your search." : "Standings appear once results are in."}</p>}
    {!q && standings.length > STANDINGS_PREVIEW && <button type="button" className="dd-btn dd-btn--ghost dd-btn--sm pub-more" onClick={() => setExpanded(e => !e)}>
      {expanded ? "Show fewer players" : `Show all ${standings.length} players`}</button>}
  </Sheet>;

  return <Shell>
    <header className="pub-head-block">
      <div className="pub-title-row">
        <div style={{ display: "grid", gap: 10 }}>
          <h1 className="dd-display pub-title">{view.name}</h1>
          <div className="pub-status">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: live ? "var(--gold)" : "var(--text)", fontWeight: 600 }}>
              {live && <span className="dd-pip" aria-hidden="true" />}{phaseLabel(view)}</span>
            {live && <RoundTimer round={round} />}
            <span className="dd-meta">{eventMeta(view)}</span>
            {view.location && <span className="dd-meta">{view.location}</span>}
          </div>
        </div>
        <label className="dd-field pub-search"><span className="dd-caps">Find your table</span>
          <input className="dd-input" type="search" placeholder="Your name" value={query} onChange={e => setQuery(e.target.value)} autoComplete="off" /></label>
      </div>
    </header>
    <div className="pub-tabs-mobile"><Tabs variant="phone" label="Event sections" value={tab} onChange={setTab} items={[{ id: "pairings", label: "Pairings" }, { id: "standings", label: "Standings" }]} /></div>
    <div className="pub-grid">{pairingsSheet}{standingsSheet}</div>
    <Bracket view={view} />
    <footer className="pub-foot">
      <span role="status">{stale ? "Connection lost. Trying again." : "Updates live as results are reported."}</span>
      <a href={`/e/${code}/me`}>Playing? Sign in to join or report your result</a>
    </footer>
  </Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="pub-page"><div className="pub-wrap">
    <a href="/" className="pub-brand"><Wordmark full fill="var(--bg-deep)" /></a>
    {children}
  </div></div>;
}

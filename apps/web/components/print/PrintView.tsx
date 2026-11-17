"use client";
import { useEffect, useMemo, useState } from "react";
import { isTemporaryMemberId, type DeskView, type Match, type MatchResult, type PublicView, type Standing } from "@dd-tournament/engine";
import { Button, Checkbox, Select } from "../ui";

export type PrintKind = "pairings" | "slips" | "standings" | "players" | "brackets";
type PrintMatch = { id: string; table: number | null; p1: string; p2: string | null; result: MatchResult | null };
type PrintPlayer = { name: string; memberId: string | null; status: string; table: number | null };
type Source = { players: PrintPlayer[] | null; name: string; rounds: { number: number; stage: string; matches: PrintMatch[] }[]; standings: Standing[]; full: boolean; backHref: string | null };

function fromDesk(desk: DeskView, code: string): Source {
  const names = new Map(desk.state.players.map(p => [p.id, p.name]));
  const mapMatch = (m: Match): PrintMatch => ({ id: m.id, table: m.table, p1: names.get(m.p1) ?? "?", p2: m.p2 ? names.get(m.p2) ?? "?" : null, result: m.result });
  const current = desk.state.rounds.at(-1);
  const tableOf = (id: string) => current?.matches.find(m => m.p1 === id || m.p2 === id)?.table ?? null;
  const players = desk.state.players.map(p => ({ name: p.name, memberId: p.memberId, status: p.status, table: tableOf(p.id) }));
  return { players, name: desk.state.settings.name, rounds: desk.state.rounds.map(r => ({ number: r.number, stage: r.stage, matches: r.matches.map(mapMatch) })), standings: desk.standings, full: true, backHref: `/e/${code}/desk` };
}
function fromPublic(view: PublicView, code: string): Source {
  const rounds = [...view.bracket.map(b => ({ number: b.round, stage: "playoff", matches: b.matches })), ...(view.currentRound ? [{ number: view.currentRound.number, stage: view.currentRound.stage, matches: view.currentRound.matches }] : [])];
  const unique = new Map(rounds.map(r => [r.number, r]));
  return { players: null, name: view.name, rounds: [...unique.values()].map(r => ({ number: r.number, stage: r.stage, matches: r.matches.map(m => ({ id: m.id, table: m.table, p1: m.p1, p2: m.p2, result: m.result })) })), standings: view.standings, full: false, backHref: `/e/${code}` };
}

const byTable = (a: PrintMatch, b: PrintMatch) => (a.table ?? 1e9) - (b.table ?? 1e9);

export function PrintView({ code, kind, sortByPlayer = false }: { code: string; kind: PrintKind; sortByPlayer?: boolean }) {
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState("");
  const [roundPick, setRoundPick] = useState<number | null>(null);
  const [byPlayer, setByPlayer] = useState(sortByPlayer);
  const [dropped, setDropped] = useState(false);
  const base = `/api/events/${encodeURIComponent(code)}`;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const desk = await fetch(`${base}/desk`, { cache: "no-store" });
        if (desk.ok) { if (alive) setSource(fromDesk(await desk.json() as DeskView, code)); return; }
        const pub = await fetch(base, { cache: "no-store" });
        if (!pub.ok) throw new Error("missing");
        if (alive) setSource(fromPublic(await pub.json() as PublicView, code));
      } catch { if (alive) setError("Could not load this event."); }
    })();
    return () => { alive = false; };
  }, [base, code]);

  const round = useMemo(() => {
    if (!source) return null;
    return source.rounds.find(r => r.number === roundPick) ?? source.rounds.at(-1) ?? null;
  }, [source, roundPick]);

  if (error) return <p role="alert" className="print-msg">{error}</p>;
  if (!source) return <p role="status" className="print-msg">Loading...</p>;

  const title = { pairings: "Pairings", slips: "Result slips", standings: "Standings", players: "Player list", brackets: "Brackets" }[kind];
  const playoffs = source.rounds.filter(r => r.stage === "playoff");
  const matches = [...(round?.matches ?? [])].sort(byTable);
  const rows = source.standings.filter(s => dropped || s.status !== "dropped");

  return <div className="print-root">
    <div className="print-bar dd-noprint">
      <div className="print-bar-left">
        {source.backHref && <a href={source.backHref} className="dd-btn dd-btn--ghost dd-btn--sm">Back</a>}
        <span className="dd-display" style={{ fontSize: 16 }}>{title}</span>
        {(kind === "pairings" || kind === "slips") && source.rounds.length > 0 && <label className="print-ctl"><span className="dd-sr">Round</span>
          <Select compact aria-label="Round" value={round?.number ?? ""} onChange={e => setRoundPick(Number(e.target.value))}>
            {source.rounds.map(r => <option key={r.number} value={r.number}>Round {r.number}</option>)}
          </Select></label>}
        {kind === "pairings" && <Checkbox label="Sort by player name" checked={byPlayer} onChange={e => setByPlayer(e.target.checked)} />}
        {kind === "standings" && <Checkbox label="Include dropped players" checked={dropped} onChange={e => setDropped(e.target.checked)} />}
      </div>
      <Button variant="rose" size="sm" keyHint="Ctrl+P" onClick={() => window.print()}>Print</Button>
    </div>

    <article className="print-paper">
      <header className="print-head">
        <h1>{source.name}</h1>
        <p>{title}{(kind === "pairings" || kind === "slips") && round ? ` · ${round.stage === "playoff" ? "Playoff round" : "Round"} ${round.number}` : ""}</p>
      </header>

      {kind === "pairings" && (round ? <PairingsTable matches={matches} byPlayer={byPlayer} /> : <p>No round has been paired yet.</p>)}
      {kind === "slips" && (round ? <div className="print-slips">{matches.filter(m => m.p2 !== null).map(m => <Slip key={m.id} m={m} round={round.number} event={source.name} />)}</div> : <p>No round has been paired yet.</p>)}
      {kind === "standings" && <StandingsTable rows={rows} />}
      {kind === "players" && (source.players ? <PlayerList players={source.players} /> : <p>The player list is available to event staff. Sign in to the desk to print it.</p>)}
      {kind === "brackets" && (playoffs.length ? <div className="print-brackets">{playoffs.map(r => <div key={r.number} className="print-bracket-col"><h2>Round {r.number}</h2>
        {[...r.matches].sort(byTable).map(m => <div key={m.id} className="print-bracket-match"><span className={m.result === "p1" ? "w" : ""}>{m.p1}</span><span className={m.result === "p2" ? "w" : ""}>{m.p2 ?? "Bye"}</span><small>Table {m.table ?? "-"}</small></div>)}</div>)}</div> : <p>No playoff yet.</p>)}
    </article>
  </div>;
}

function PairingsTable({ matches, byPlayer }: { matches: PrintMatch[]; byPlayer: boolean }) {
  if (!byPlayer) return <table className="print-table"><thead><tr><th className="n">Table</th><th>Player 1</th><th>Player 2</th></tr></thead>
    <tbody>{matches.map(m => <tr key={m.id}><td className="n">{m.table ?? "Bye"}</td><td>{m.p1}</td><td>{m.p2 ?? "Bye"}</td></tr>)}</tbody></table>;
  const rows = matches.flatMap(m => [{ name: m.p1, table: m.table, vs: m.p2 }, ...(m.p2 ? [{ name: m.p2, table: m.table, vs: m.p1 }] : [])]).sort((a, b) => a.name.localeCompare(b.name));
  return <table className="print-table"><thead><tr><th>Player</th><th className="n">Table</th><th>Opponent</th></tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}><td>{r.name}</td><td className="n">{r.table ?? "Bye"}</td><td>{r.vs ?? "Bye"}</td></tr>)}</tbody></table>;
}

function StandingsTable({ rows }: { rows: Standing[] }) {
  return <table className="print-table"><thead><tr><th className="n">Rank</th><th>Player</th><th className="n">Points</th><th className="n">W-L-D</th><th className="n">OMW%</th><th className="n">OOMW%</th></tr></thead>
    <tbody>{rows.map(s => <tr key={s.playerId}><td className="n">{s.rank}</td><td>{s.name}{s.status === "dropped" ? " (dropped)" : ""}</td><td className="n">{s.matchPoints}</td>
      <td className="n">{s.record.wins}-{s.record.losses}-{s.record.draws}</td><td className="n">{s.omw.toFixed(1)}%</td><td className="n">{s.oomw.toFixed(1)}%</td></tr>)}</tbody></table>;
}

function Slip({ m, round, event }: { m: PrintMatch; round: number; event: string }) {
  const box = <span className="print-box" aria-hidden="true" />;
  return <section className="print-slip">
    <div className="print-slip-head"><strong>Table {m.table ?? "?"}</strong><span>{event} · Round {round}</span></div>
    <div className="print-slip-players"><span>{m.p1}</span><span>vs</span><span>{m.p2}</span></div>
    <div className="print-slip-opts">
      <span>{box}{m.p1} wins ( - )</span><span>{box}{m.p2} wins ( + )</span><span>{box}Draw ( * )</span><span>{box}Double loss ( / )</span>
    </div>
    <div className="print-slip-sign"><span>Winner signature</span><span>Drops</span></div>
  </section>;
}

const pad = (id: string) => id.padStart(10, "0");

function PlayerList({ players }: { players: PrintPlayer[] }) {
  const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name));
  return <table className="print-table"><thead><tr><th>Name</th><th>COSSY ID</th><th>Table / status</th></tr></thead>
    <tbody>{sorted.map((p, i) => <tr key={i}><td>{p.name}</td>
      <td className="mono">{p.memberId ? <>{pad(p.memberId)}{isTemporaryMemberId(p.memberId) ? " (temporary)" : ""}</> : "-"}</td>
      <td>{p.status === "dropped" ? "Dropped" : p.status === "cut" ? "Cut" : p.table !== null ? `Table ${p.table}` : "Active"}</td></tr>)}</tbody></table>;
}

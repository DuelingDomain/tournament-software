"use client";
import { useEffect, useMemo, useState } from "react";
import { isTemporaryMemberId, type DeskView, type MatchResult, type PrintData, type PublicView, type Standing } from "@dd-tournament/engine";
import { Button, Checkbox, Select } from "../ui";

export type PrintKind = "pairings" | "slips" | "standings" | "players" | "brackets" | "pairings-by-team" | "unreported" | "paired-down" | "penalties";
type PrintMatch = { id: string; table: number | null; tables: number[]; p1: string; p2: string | null; m1: string[]; m2: string[]; result: MatchResult | null };
type PrintPlayer = { name: string; memberId: string | null; status: string; table: number | null; team: string | null };
type Extra = Pick<PrintData, "pairingsByTeam" | "unreportedMatches" | "pairedDownPlayers" | "penalties">;
type Source = { firstSide: Map<string, string>; players: PrintPlayer[] | null; name: string; teamEvent: boolean; teamMembers: Map<string, string[]>; rounds: { number: number; stage: string; matches: PrintMatch[] }[]; standings: Standing[]; extra: Extra | null; full: boolean; backHref: string | null };

/** "3" for one table, "3-4" when a team match holds several. */
const tableText = (m: { table: number | null; tables: number[] }) => m.table === null ? "Bye" : m.tables.length > 1 ? `${m.tables[0]}–${m.tables.at(-1)}` : String(m.table);

function fromDesk(desk: DeskView, code: string): Source {
  const { state } = desk;
  const teamEvent = state.settings.playerStructure > 1;
  const byId = new Map<string, string>([...state.players, ...state.teams].map(p => [p.id, p.name]));
  const printed = new Map(desk.printData.matches.map(m => [m.id, m]));
  const mapMatch = (m: { id: string; table: number | null; p1: string; p2: string | null; result: MatchResult | null }): PrintMatch => {
    const pm = printed.get(m.id);
    return { id: m.id, table: m.table, tables: pm?.tables ?? (m.table === null ? [] : [m.table]), p1: byId.get(m.p1) ?? "?", p2: m.p2 ? byId.get(m.p2) ?? "?" : null,
      m1: pm?.p1.members.map(x => x.name) ?? [], m2: pm?.p2?.members.map(x => x.name) ?? [], result: m.result };
  };
  const current = state.rounds.at(-1);
  const tableOf = (id: string) => current?.matches.find(m => m.p1 === id || m.p2 === id)?.table ?? null;
  const teamOf = new Map(state.teams.flatMap(t => t.memberIds.map(id => [id, t.name] as const)));
  const players = state.players.map(p => ({ name: p.name, memberId: p.memberId, status: p.status, table: teamEvent ? tableOf(state.teams.find(t => t.memberIds.includes(p.id))?.id ?? "") : tableOf(p.id), team: teamOf.get(p.id) ?? null }));
  const teamMembers = new Map(state.teams.map(t => [t.id, t.memberIds.map(id => byId.get(id) ?? "?")]));
  const firstSide = new Map(state.rounds.flatMap(r => r.matches.map(m => [m.id, m.p1] as const)));
  return { firstSide, players, name: state.settings.name, teamEvent, teamMembers, rounds: state.rounds.map(r => ({ number: r.number, stage: r.stage, matches: r.matches.map(mapMatch) })), standings: desk.standings,
    extra: { pairingsByTeam: desk.printData.pairingsByTeam, unreportedMatches: desk.printData.unreportedMatches, pairedDownPlayers: desk.printData.pairedDownPlayers, penalties: desk.printData.penalties }, full: true, backHref: `/e/${code}/desk` };
}
function fromPublic(view: PublicView, code: string): Source {
  const rounds = [...view.bracket.map(b => ({ number: b.round, stage: "playoff", matches: b.matches })), ...(view.currentRound ? [{ number: view.currentRound.number, stage: view.currentRound.stage, matches: view.currentRound.matches }] : [])];
  const unique = new Map(rounds.map(r => [r.number, r]));
  return { firstSide: new Map(), players: null, name: view.name, teamEvent: view.playerStructure > 1, teamMembers: new Map(view.teams.map(t => [t.id, t.members.map(m => m.name)])), extra: null,
    rounds: [...unique.values()].map(r => ({ number: r.number, stage: r.stage, matches: r.matches.map(m => ({ id: m.id, table: m.table, tables: m.tables, p1: m.p1, p2: m.p2, m1: m.p1Members.map(x => x.name), m2: m.p2Members.map(x => x.name), result: m.result })) })),
    standings: view.standings, full: false, backHref: `/e/${code}` };
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

  const title = { pairings: "Pairings", slips: "Result slips", standings: "Standings", players: source.teamEvent ? "Team list" : "Player list", brackets: "Brackets", "pairings-by-team": "Pairings by team", unreported: "Unreported matches", "paired-down": "Paired-down players", penalties: "Penalties" }[kind];
  const staffOnly = <p>This document is available to event staff. Sign in to the desk to print it.</p>;
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
        {kind === "pairings" && <Checkbox label={source.teamEvent ? "Sort by team name" : "Sort by player name"} checked={byPlayer} onChange={e => setByPlayer(e.target.checked)} />}
        {kind === "standings" && <Checkbox label={source.teamEvent ? "Include dropped teams" : "Include dropped players"} checked={dropped} onChange={e => setDropped(e.target.checked)} />}
      </div>
      <Button variant="rose" size="sm" keyHint="Ctrl+P" onClick={() => window.print()}>Print</Button>
    </div>

    <article className="print-paper">
      <header className="print-head">
        <h1>{source.name}</h1>
        <p>{title}{(kind === "pairings" || kind === "slips") && round ? ` · ${round.stage === "playoff" ? "Playoff round" : "Round"} ${round.number}` : ""}</p>
      </header>

      {kind === "pairings" && (round ? <PairingsTable matches={matches} byPlayer={byPlayer} team={source.teamEvent} /> : <p>No round has been paired yet.</p>)}
      {kind === "slips" && (round ? <div className="print-slips">{matches.filter(m => m.p2 !== null).map(m => <Slip key={m.id} m={m} round={round.number} event={source.name} />)}</div> : <p>No round has been paired yet.</p>)}
      {kind === "standings" && <StandingsTable rows={rows} team={source.teamEvent} members={source.teamMembers} />}
      {kind === "players" && (source.players ? <PlayerList players={source.players} team={source.teamEvent} /> : <p>The player list is available to event staff. Sign in to the desk to print it.</p>)}
      {kind === "brackets" && (playoffs.length ? <div className="print-brackets">{playoffs.map(r => <div key={r.number} className="print-bracket-col"><h2>Round {r.number}</h2>
        {[...r.matches].sort(byTable).map(m => <div key={m.id} className="print-bracket-match"><span className={m.result === "p1" ? "w" : ""}>{m.p1}</span><span className={m.result === "p2" ? "w" : ""}>{m.p2 ?? "Bye"}</span><small>Table {m.table === null ? "-" : tableText(m)}</small></div>)}</div>)}</div> : <p>No playoff yet.</p>)}
      {kind === "pairings-by-team" && (!source.extra ? staffOnly : !source.teamEvent ? <p>This tournament has no teams.</p> : <ByTeamTable rows={source.extra.pairingsByTeam} firstSide={source.firstSide} />)}
      {kind === "unreported" && (!source.extra ? staffOnly : <UnreportedTable rows={source.extra.unreportedMatches} />)}
      {kind === "paired-down" && (!source.extra ? staffOnly : <PairedDownTable rows={source.extra.pairedDownPlayers} team={source.teamEvent} />)}
      {kind === "penalties" && (!source.extra ? staffOnly : <PenaltiesTable rows={source.extra.penalties} />)}
    </article>
  </div>;
}

const Members = ({ names }: { names: string[] }) => names.length ? <small className="print-members">{names.join(", ")}</small> : null;
const Side = ({ name, members }: { name: string; members: string[] }) => <>{name}<Members names={members} /></>;

function PairingsTable({ matches, byPlayer, team }: { matches: PrintMatch[]; byPlayer: boolean; team: boolean }) {
  const who = team ? "Team" : "Player";
  if (!byPlayer) return <table className="print-table"><thead><tr><th className="n">Table</th><th>{who} 1</th><th>{who} 2</th></tr></thead>
    <tbody>{matches.map(m => <tr key={m.id}><td className="n">{tableText(m)}</td><td><Side name={m.p1} members={m.m1} /></td><td>{m.p2 ? <Side name={m.p2} members={m.m2} /> : "Bye"}</td></tr>)}</tbody></table>;
  const rows = matches.flatMap(m => [{ name: m.p1, members: m.m1, text: tableText(m), vs: m.p2 }, ...(m.p2 ? [{ name: m.p2, members: m.m2, text: tableText(m), vs: m.p1 }] : [])]).sort((a, b) => a.name.localeCompare(b.name));
  return <table className="print-table"><thead><tr><th>{who}</th><th className="n">Table</th><th>Opponent</th></tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}><td><Side name={r.name} members={r.members} /></td><td className="n">{r.text}</td><td>{r.vs ?? "Bye"}</td></tr>)}</tbody></table>;
}

function StandingsTable({ rows, team, members }: { rows: Standing[]; team: boolean; members: Map<string, string[]> }) {
  return <table className="print-table"><thead><tr><th className="n">Rank</th><th>{team ? "Team" : "Player"}</th><th className="n">Points</th><th className="n">W-L-D</th><th className="n">OMW%</th><th className="n">OOMW%</th></tr></thead>
    <tbody>{rows.map(s => <tr key={s.playerId}><td className="n">{s.rank}</td><td>{s.name}{s.status === "dropped" ? " (dropped)" : ""}{team && <Members names={members.get(s.playerId) ?? []} />}</td><td className="n">{s.matchPoints}</td>
      <td className="n">{s.record.wins}-{s.record.losses}-{s.record.draws}</td><td className="n">{s.omw.toFixed(1)}%</td><td className="n">{s.oomw.toFixed(1)}%</td></tr>)}</tbody></table>;
}

const Entrant = ({ c }: { c: { name: string; members: { name: string }[] } }) => <Side name={c.name} members={c.members.map(m => m.name)} />;

function teamResult(result: MatchResult | null, isP1: boolean) {
  if (result === null) return "";
  if (result === "draw") return "Draw";
  if (result === "double_loss") return "Double loss";
  if (result === "bye_win") return "Bye";
  if (result === "bye_loss") return "Bye loss";
  return (result === "p1") === isP1 ? "Won" : "Lost";
}
function ByTeamTable({ rows, firstSide }: { rows: PrintData["pairingsByTeam"]; firstSide: Map<string, string> }) {
  const sideOf = firstSide;
  if (rows.length === 0) return <p>No round has been paired yet.</p>;
  return <table className="print-table"><thead><tr><th className="n">Round</th><th>Team</th><th className="n">Tables</th><th>Opponent</th><th>Result</th></tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}><td className="n">{r.round}</td><td><Entrant c={r.team} /></td><td className="n">{r.table === null ? "Bye" : r.tables.length > 1 ? `${r.tables[0]}–${r.tables.at(-1)}` : r.table}</td><td>{r.opponent ? <Entrant c={r.opponent} /> : "Bye"}</td>
      <td>{teamResult(r.result, sideOf.get(r.matchId) === r.team.id)}</td></tr>)}</tbody></table>;
}

function UnreportedTable({ rows }: { rows: PrintData["unreportedMatches"] }) {
  if (rows.length === 0) return <p>Every match has a result.</p>;
  return <table className="print-table"><thead><tr><th className="n">Round</th><th className="n">Table</th><th>Side 1</th><th>Side 2</th></tr></thead>
    <tbody>{rows.map(m => <tr key={m.id}><td className="n">{m.round}</td><td className="n">{tableText(m)}</td><td><Entrant c={m.p1} /></td><td>{m.p2 ? <Entrant c={m.p2} /> : "Bye"}</td></tr>)}</tbody></table>;
}

function PairedDownTable({ rows, team }: { rows: PrintData["pairedDownPlayers"]; team: boolean }) {
  if (rows.length === 0) return <p>Nobody has been paired down.</p>;
  return <table className="print-table"><thead><tr><th className="n">Round</th><th>{team ? "Team" : "Player"}</th><th className="n">Points</th><th>Paired against</th><th className="n">Their points</th></tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}><td className="n">{r.round}</td><td>{r.name}</td><td className="n">{r.points}</td><td>{r.isBye ? "Bye" : r.opponentName}</td><td className="n">{r.opponentPoints ?? "-"}</td></tr>)}</tbody></table>;
}

function PenaltiesTable({ rows }: { rows: PrintData["penalties"] }) {
  if (rows.length === 0) return <p>No penalties have been recorded.</p>;
  const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }); };
  return <table className="print-table"><thead><tr><th>Player</th><th className="n">Round</th><th>Infraction</th><th>Penalty</th><th>Judge</th><th>Notes</th><th>Time</th></tr></thead>
    <tbody>{rows.map(p => <tr key={p.id}><td><Entrant c={p.player} /></td><td className="n">{p.round ?? "-"}</td><td>{p.infraction}</td><td>{String(p.penalty).replace(/_/g, " ")}</td><td>{p.judge ?? "-"}</td><td>{p.notes ?? ""}</td><td>{when(p.at)}</td></tr>)}</tbody></table>;
}

function Slip({ m, round, event }: { m: PrintMatch; round: number; event: string }) {
  const box = <span className="print-box" aria-hidden="true" />;
  return <section className="print-slip">
    <div className="print-slip-head"><strong>{m.tables.length > 1 ? "Tables" : "Table"} {m.table === null ? "?" : tableText(m)}</strong><span>{event} · Round {round}</span></div>
    <div className="print-slip-players"><span><Side name={m.p1} members={m.m1} /></span><span>vs</span><span><Side name={m.p2 ?? ""} members={m.m2} /></span></div>
    <div className="print-slip-opts">
      <span>{box}{m.p1} wins ( - )</span><span>{box}{m.p2} wins ( + )</span><span>{box}Draw ( * )</span><span>{box}Double loss ( / )</span>
    </div>
    <div className="print-slip-sign"><span>Winner signature</span><span>Drops</span></div>
  </section>;
}

const pad = (id: string) => id.padStart(10, "0");

function PlayerList({ players, team }: { players: PrintPlayer[]; team: boolean }) {
  const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name));
  return <table className="print-table"><thead><tr><th>Name</th>{team && <th>Team</th>}<th>COSSY ID</th><th>Table / status</th></tr></thead>
    <tbody>{sorted.map((p, i) => <tr key={i}><td>{p.name}</td>{team && <td>{p.team ?? "-"}</td>}
      <td className="mono">{p.memberId ? <>{pad(p.memberId)}{isTemporaryMemberId(p.memberId) ? " (temporary)" : ""}</> : "-"}</td>
      <td>{p.status === "dropped" ? "Dropped" : p.status === "cut" ? "Cut" : p.table !== null ? `Table ${p.table}` : "Active"}</td></tr>)}</tbody></table>;
}

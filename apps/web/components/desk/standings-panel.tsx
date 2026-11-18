"use client";
import { useMemo, useState } from "react";
import { standings as computeStandings, type DeskView, type StaffRole } from "@dd-tournament/engine";
import { Checkbox, Field, Select } from "../ui";
import { competitorLabel, isTeamEvent, membersOf, playerById, roundTitle, standingsThrough, statusText } from "./helpers";
import { PointsControl } from "./points-control";
import { can } from "./roles";
import type { SendFn } from "./use-desk";

const pct = (n: number) => `${n.toFixed(1)}%`;

export function StandingsPanel({ desk, role, send, includeDropped, setIncludeDropped }: { desk: DeskView; role: StaffRole; send: SendFn; includeDropped: boolean; setIncludeDropped: (v: boolean) => void }) {
  const { state } = desk;
  const team = isTeamEvent(state);
  const who = competitorLabel(state);
  const byId = playerById(state);
  const open = state.settings.format === "open_dueling" || state.settings.style === "open_dueling";
  const last = state.rounds.at(-1)?.number ?? 0;
  const [picked, setPicked] = useState<number | null>(null);
  const through = picked !== null && picked <= last ? picked : last;
  const rows = useMemo(() => {
    const list = through === last ? desk.standings : standingsThrough(state, computeStandings, through);
    return includeDropped ? list : list.filter(s => s.status === "active");
  }, [desk.standings, state, through, last, includeDropped]);
  const cut = state.settings.format === "swiss" && state.phase !== "playoff" && state.settings.topCut > 0 ? state.settings.topCut : 0;
  const playoffs = state.rounds.some(r => r.stage === "playoff");
  const selectedRound = state.rounds.find(r => r.number === through);
  const partial = !!selectedRound && selectedRound.matches.some(m => m.result === null);

  return <div className="dk-sec" style={{ gap: 12 }}>
    <div className="dk-slip" style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
      <Field label="Round">
        <Select compact value={through} onChange={e => setPicked(Number(e.target.value))} aria-label="Standings after round" disabled={last === 0}>
          {state.rounds.map(r => <option key={r.number} value={r.number}>{`After ${roundTitle(r)}`}</option>)}
          {last === 0 && <option value={0}>No rounds yet</option>}
        </Select>
      </Field>
      <Checkbox label="Include Dropped Players" checked={includeDropped} onChange={e => setIncludeDropped(e.target.checked)} />
      <span className="dd-meta" style={{ marginLeft: "auto" }}>{partial ? "Round in progress: standings include only reported matches." : state.settings.tiebreak === "floor33" ? "Tiebreaks: opponent win % floored at 33.3%." : "Tiebreaks: legacy opponent win %."}</span>
    </div>
    <div className="dd-scroll-x"><div className="dk-table" style={{ "--w": open ? "760px" : "640px" } as React.CSSProperties}>
      <div aria-hidden="true" className="dk-sh dd-caps" data-pts={open}><span>Rank</span><span>{who}</span><span className="dk-num">Points</span><span className="dk-num">W-L-D</span><span className="dk-num">OMW%</span><span className="dk-num">OOMW%</span>{open && <span className="dk-num">Open points</span>}</div>
      {rows.length === 0 && <p className="dk-empty">{last === 0 ? "Standings appear once round 1 is paired and results are in." : `No ${who.toLowerCase()}s to show.`}</p>}
      <ol className="dk-list" aria-label="Standings">
        {rows.map((s, i) => <li key={s.playerId}>
          <div className="dk-srow" data-out={s.status !== "active"} data-pts={open}>
            <span className="dk-rank" data-first={s.rank === 1}>{s.rank}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span style={{ display: "grid", minWidth: 0 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                {team && (() => { const t = state.teams?.find(x => x.id === s.playerId); return t ? <span className="dk-members">{membersOf(state, t).map(m => m.name).join(" · ")}</span> : null; })()}
              </span>
              {s.status !== "active" && <span className="dd-chip dd-chip--muted">{statusText({ status: s.status, droppedAfterRound: byId.get(s.playerId)?.droppedAfterRound ?? 0, checkedIn: false } as never)}</span>}
              {playoffs && s.playoffFinish !== null && <span className="dd-chip dd-chip--violet">{s.playoffFinish === 1 ? "Winner" : s.playoffFinish === 2 ? "Finalist" : `Top ${s.playoffFinish === 3 ? 4 : s.playoffFinish}`}</span>}
            </span>
            <span className="dk-num">{s.matchPoints}</span>
            <span className="dk-num">{s.record.wins}-{s.record.losses}-{s.record.draws}</span>
            <span className="dk-num">{pct(s.omw)}</span>
            <span className="dk-num">{pct(s.oomw)}</span>
            {open && <PointsControl name={s.name} points={s.openDuelingPoints ?? 0} disabled={!can(role, "AdjustPoints") || state.phase === "complete"} onAdjust={d => void send({ type: "AdjustPoints", playerId: s.playerId, delta: d })} />}
          </div>
          {cut > 0 && i + 1 === cut && rows[i + 1] && <div className="dk-cutline" role="separator" aria-label={`Top ${cut} cut`}><span /><span>Top {cut} cut{rows[i + 1]!.rank === s.rank ? " · tied at the cut" : ""}</span><span /></div>}
        </li>)}
      </ol>
    </div></div>
  </div>;
}

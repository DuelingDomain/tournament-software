"use client";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Button, ButtonLink, Input, Tabs } from "./ui";
import { pairingLabel } from "./desk/tournament-options";

export const eventsSchema = z.object({ events: z.array(z.object({
  code: z.string(), name: z.string(), phase: z.string(), role: z.string().nullable().optional(), joined: z.boolean().optional(), startsAt: z.string().nullable().optional(),
  createdAt: z.string().optional(), format: z.string().optional(), playerStructure: z.number().optional(), playerCount: z.number().optional(), teamCount: z.number().optional(),
  round: z.number().nullable().optional(), plannedRounds: z.number().nullable().optional(),
})) });
export type EventRow = z.infer<typeof eventsSchema>["events"][number];

const ROLE: Record<string, string> = { organizer: "Organizer", head_judge: "Head judge", judge: "Judge", scorekeeper: "Scorekeeper", staff: "Staff" };
const PAGE_SIZE = 25;

type Group = "live" | "upcoming" | "finished" | "all";
const GROUPS: { id: Group; label: string }[] = [{ id: "live", label: "In progress" }, { id: "upcoming", label: "Upcoming" }, { id: "finished", label: "Finished" }, { id: "all", label: "All" }];

/** Start date from the settings; events without one fall back to the day they were created. */
function dateOf(e: EventRow): { time: number; fallback: boolean } {
  const start = e.startsAt ? Date.parse(e.startsAt) : NaN;
  if (!Number.isNaN(start)) return { time: start, fallback: false };
  const made = e.createdAt ? Date.parse(e.createdAt) : NaN;
  return { time: Number.isNaN(made) ? 0 : made, fallback: true };
}

function groupOf(e: EventRow): Exclude<Group, "all"> {
  if (e.phase === "complete") return "finished";
  return e.phase === "registration" ? "upcoming" : "live";
}

function whenText(time: number) {
  if (!time) return "No date";
  const d = new Date(time);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), hour: "numeric", minute: "2-digit" });
}

function statusText(e: EventRow) {
  if (e.phase === "complete") return "Finalized";
  if (e.phase === "playoff") return "Playoffs";
  if (e.phase === "registration") return "Registration";
  const round = e.round ?? 0;
  if (!round) return "Registration";
  // Only Swiss has a planned length; the other pairing structures just count rounds.
  return e.format === "swiss" && e.plannedRounds && round <= e.plannedRounds ? `Round ${round} of ${e.plannedRounds}` : `Round ${round}`;
}

function structureText(e: EventRow) {
  const parts = [pairingLabel((e.format ?? "swiss") as Parameters<typeof pairingLabel>[0])];
  const n = e.playerStructure ?? 1;
  parts.push(n === 1 ? "Individual" : n === 2 ? "Tag" : `Team of ${n}`);
  return parts.join(" · ");
}

function roleText(e: EventRow) {
  const parts = [e.role ? ROLE[e.role] ?? e.role : null, e.joined ? "Player" : null].filter(Boolean);
  return parts.join(", ") || "Viewer";
}

function sorted(rows: EventRow[], group: Group, now: number) {
  const byDate = (a: EventRow, b: EventRow) => dateOf(b).time - dateOf(a).time;
  if (group !== "upcoming") return [...rows].sort(byDate);
  // Dated future events come first, soonest on top; open registrations with a past or no date follow, newest first.
  const ahead = rows.filter(e => !dateOf(e).fallback && dateOf(e).time >= now).sort((a, b) => dateOf(a).time - dateOf(b).time);
  return [...ahead, ...rows.filter(e => !ahead.includes(e)).sort(byDate)];
}

const EMPTY: Record<Group, string> = {
  live: "No events in progress. An event shows here once its first round is paired.",
  upcoming: "No upcoming events. Events in registration show here.",
  finished: "No finished events yet. An event shows here once it is finalized.",
  all: "You are not part of any event yet. Open an event link from your organizer to join, or create your own.",
};

export function EventList({ events, canCreate, onCreate }: { events: EventRow[]; canCreate: boolean; onCreate: () => void }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Group | null>(null);
  const [page, setPage] = useState(0);
  const now = useMemo(() => Date.now(), []);

  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? events.filter(e => e.name.toLowerCase().includes(needle)) : events;
  }, [events, query]);
  const counts: Record<Group, number> = useMemo(() => ({
    live: matching.filter(e => groupOf(e) === "live").length, upcoming: matching.filter(e => groupOf(e) === "upcoming").length,
    finished: matching.filter(e => groupOf(e) === "finished").length, all: matching.length,
  }), [matching]);
  // Until the person chooses, open on the first group that has something in it.
  const total = (g: Group) => g === "all" ? events.length : events.filter(e => groupOf(e) === g).length;
  const group: Group = picked ?? (total("live") ? "live" : total("upcoming") ? "upcoming" : "all");

  const rows = useMemo(() => sorted(group === "all" ? matching : matching.filter(e => groupOf(e) === group), group, now), [matching, group, now]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const at = Math.min(page, pages - 1);
  const shown = rows.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE);

  function open(e: EventRow) {
    window.location.assign(`/e/${encodeURIComponent(e.code)}/${e.role ? "desk" : e.joined ? "me" : ""}`);
  }

  return <section className="dd-sheet ev-sheet" aria-labelledby="my-events-h">
    <div className="ev-head">
      <h1 id="my-events-h" className="dd-display ev-title">My events</h1>
      <Input type="search" className="dd-input--sm ev-search" placeholder="Search by name" aria-label="Search events by name" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} />
      {canCreate && <Button variant="rose" className="ev-create" onClick={onCreate}>Create event</Button>}
    </div>
    <Tabs variant="index" label="Event groups" value={group} onChange={id => { setPicked(id as Group); setPage(0); }}
      items={GROUPS.map(g => ({ id: g.id, label: g.label, panelId: "ev-panel", badge: <span className="ev-count">{counts[g.id]}</span> }))} />
    <div className="ev-scroll" id="ev-panel" role="tabpanel" aria-labelledby={`tab-${group}`} tabIndex={-1}>
      {shown.length === 0 ? <div className="ev-empty">
        <p className="dd-meta" style={{ margin: 0 }}>{query.trim() ? `No events match "${query.trim()}".` : EMPTY[group]}</p>
        {query.trim() ? <Button size="sm" onClick={() => { setQuery(""); setPage(0); }}>Clear search</Button>
          : canCreate && group !== "finished" && <Button size="sm" variant="rose-outline" onClick={onCreate}>Create event</Button>}
      </div> : <table className="ev-table">
        <thead><tr>
          <th scope="col" className="ev-c-name">Name</th><th scope="col" className="ev-c-date">Date</th><th scope="col">Status</th>
          <th scope="col" className="ev-c-struct">Structure</th><th scope="col" className="ev-c-n">Players</th><th scope="col" className="ev-c-role">My role</th>
          <th scope="col" className="ev-c-act"><span className="dd-sr">Actions</span></th>
        </tr></thead>
        <tbody>{shown.map(e => {
          const date = dateOf(e);
          const main = `/e/${encodeURIComponent(e.code)}/${e.role ? "desk" : e.joined ? "me" : ""}`;
          const live = e.phase === "swiss" || e.phase === "playoff";
          return <tr key={e.code} className="ev-row" onClick={ev => { if (!(ev.target as HTMLElement).closest("a,button")) open(e); }}>
            <td className="ev-c-name"><a className="ev-name" href={main} title={e.name}>{e.name}</a></td>
            <td className="ev-c-date" title={date.fallback ? "No start date set; showing the day it was created." : undefined}>
              <span className={date.fallback ? "ev-hint" : undefined}>{whenText(date.time)}</span>{date.fallback && <span className="ev-hint"> · created</span>}
            </td>
            <td><span className={`dd-chip${live ? "" : " dd-chip--muted"}`}>{statusText(e)}</span></td>
            <td className="ev-c-struct">{structureText(e)}</td>
            <td className="ev-c-n" title={(e.playerStructure ?? 1) > 1 ? `${e.playerCount ?? 0} players in ${e.teamCount ?? 0} ${e.teamCount === 1 ? "team" : "teams"}` : undefined}>{e.playerCount ?? 0}</td>
            <td className="ev-c-role">{roleText(e)}</td>
            <td className="ev-c-act"><span className="ev-actions">
              {e.role && <ButtonLink size="sm" variant="violet" href={`/e/${encodeURIComponent(e.code)}/desk`}>Desk</ButtonLink>}
              {e.joined && <ButtonLink size="sm" href={`/e/${encodeURIComponent(e.code)}/me`}>My table</ButtonLink>}
              <ButtonLink size="sm" variant="ghost" href={`/e/${encodeURIComponent(e.code)}`}>Public page</ButtonLink>
            </span></td>
          </tr>;
        })}</tbody>
      </table>}
    </div>
    <div className="ev-foot">
      <span className="dd-meta" aria-live="polite">{rows.length ? `${at * PAGE_SIZE + 1}-${at * PAGE_SIZE + shown.length} of ${rows.length}` : "0 events"}</span>
      {pages > 1 && <span className="ev-pager">
        <Button size="sm" disabled={at === 0} onClick={() => setPage(at - 1)} aria-label="Previous page">Previous</Button>
        <span className="dd-meta">Page {at + 1} of {pages}</span>
        <Button size="sm" disabled={at >= pages - 1} onClick={() => setPage(at + 1)} aria-label="Next page">Next</Button>
      </span>}
    </div>
  </section>;
}

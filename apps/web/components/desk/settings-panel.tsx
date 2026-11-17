"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DeskView, EventSettings, Penalty, StaffRole } from "@dd-tournament/engine";
import { Button, Checkbox, Field, Input, Select } from "../ui";
import { useAccountSearch } from "./accounts";
import { PENALTY_LABEL } from "./helpers";
import { ROLES, ROLE_LABEL, can, canEditDiscord } from "./roles";
import type { SendFn } from "./use-desk";

const CUTS = [0, 2, 4, 8, 16, 32, 64];
const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function SettingsPanel({ code, desk, role, send, onImport }: { code: string; desk: DeskView; role: StaffRole; send: SendFn; onImport: (kind: "tournament" | "players") => void }) {
  const { state } = desk;
  const editable = can(role, "UpdateSettings") && state.phase !== "complete";
  const [draft, setDraft] = useState<EventSettings>(state.settings);
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(state.settings), [draft, state.settings]);
  useEffect(() => { setDraft(state.settings); }, [state.settings]);
  const set = <K extends keyof EventSettings>(k: K, v: EventSettings[K]) => setDraft(d => ({ ...d, [k]: v }));

  async function save() {
    const { format, ...rest } = draft;
    const res = await send({ type: "UpdateSettings", settings: { ...rest, ...(format !== state.settings.format ? { format } : {}) } });
    setMsg(res.ok ? { bad: false, text: "Settings saved." } : { bad: true, text: res.message });
  }
  const copy = (path: string) => { void navigator.clipboard?.writeText(`${location.origin}${path}`).then(() => setMsg({ bad: false, text: "Link copied." }), () => setMsg({ bad: true, text: "Could not copy. Select the link and copy it." })); };

  return <div className="dk-sec">
    <section className="dk-sec" aria-labelledby="set-event">
      <h2 id="set-event" className="dk-h2">Event settings</h2>
      <form className="dk-sec" onSubmit={e => { e.preventDefault(); if (editable && dirty) void save(); }}>
        <fieldset disabled={!editable} style={{ border: 0, margin: 0, padding: 0 }} className="dk-sec">
          <div className="dk-form-grid">
            <Field label="Name"><Input value={draft.name} onChange={e => set("name", e.target.value)} maxLength={200} /></Field>
            <Field label="Format" hint={state.rounds.length ? "Locked once a round is paired." : undefined}>
              <Select value={draft.format} onChange={e => set("format", e.target.value as EventSettings["format"])} disabled={state.rounds.length > 0}>
                <option value="swiss">Swiss</option><option value="single_elim">Single elimination</option>
              </Select></Field>
            <Field label="Planned rounds" hint={`Suggested for ${state.players.length} players: ${desk.suggestedRounds}`}>
              <Input type="number" min={1} max={100} value={draft.plannedRounds ?? ""} placeholder="Decide as you go" onChange={e => set("plannedRounds", e.target.value === "" ? null : Number(e.target.value))} /></Field>
            <Field label="Cut to top"><Select value={draft.topCut} onChange={e => set("topCut", Number(e.target.value) as EventSettings["topCut"])}>
              {CUTS.map(n => <option key={n} value={n}>{n === 0 ? "No cut" : `Top ${n}`}</option>)}</Select></Field>
            <Field label="Tiebreak"><Select value={draft.tiebreak} onChange={e => set("tiebreak", e.target.value as EventSettings["tiebreak"])}>
              <option value="floor33">Opponent win % floored at 33.3%</option><option value="legacy">Legacy opponent win %</option></Select></Field>
            <Field label="Starting table"><Input type="number" min={1} value={draft.startingTable} onChange={e => set("startingTable", Math.max(1, Number(e.target.value) || 1))} /></Field>
            <Field label="Round minutes"><Input type="number" min={1} max={1440} value={draft.roundMinutes} onChange={e => set("roundMinutes", Number(e.target.value) || 50)} /></Field>
            <Field label="Location"><Input value={draft.location ?? ""} onChange={e => set("location", e.target.value || null)} maxLength={500} /></Field>
            <Field label="Starts"><Input type="datetime-local" value={toLocal(draft.startsAt)} onChange={e => set("startsAt", e.target.value ? new Date(e.target.value).toISOString() : null)} /></Field>
            <Field label="Names on the public page"><Select value={draft.publicNames} onChange={e => set("publicNames", e.target.value as EventSettings["publicNames"])}>
              <option value="full">Full names</option><option value="initials">Initials</option></Select></Field>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 24px" }}>
            <Checkbox label="Players can join themselves" checked={draft.registrationOpen} onChange={e => set("registrationOpen", e.target.checked)} />
            <Checkbox label="Require a COSSY ID to enter" checked={draft.requireMemberId} onChange={e => set("requireMemberId", e.target.checked)} />
            <Checkbox label="Allow late entry after round 1" checked={draft.allowLateEntry} onChange={e => set("allowLateEntry", e.target.checked)} />
          </div>
          <details>
            <summary style={{ cursor: "pointer", minHeight: 32, display: "flex", alignItems: "center", fontWeight: 600 }}>Infraction list ({draft.infractions.length})</summary>
            <div className="dk-sec" style={{ gap: 6, marginTop: 8 }}>
              {draft.infractions.map((inf, i) => <div key={inf.id} className="dk-dlg-row" style={{ alignItems: "center" }}>
                <Input aria-label={`Infraction ${i + 1} label`} value={inf.label} onChange={e => set("infractions", draft.infractions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} style={{ flex: "2 1 220px", width: "auto" }} />
                <Select aria-label={`Default penalty for ${inf.label}`} value={inf.defaultPenalty} onChange={e => set("infractions", draft.infractions.map((x, j) => (j === i ? { ...x, defaultPenalty: e.target.value as Penalty } : x)))} style={{ flex: "1 1 160px", width: "auto" }}>
                  {(Object.keys(PENALTY_LABEL) as Penalty[]).map(p => <option key={p} value={p}>{PENALTY_LABEL[p]}</option>)}</Select>
                <Button size="sm" onClick={() => set("infractions", draft.infractions.filter((_, j) => j !== i))} aria-label={`Remove ${inf.label}`}>Remove</Button>
              </div>)}
              <div><Button size="sm" onClick={() => set("infractions", [...draft.infractions, { id: `custom_${Date.now().toString(36)}`, label: "New infraction", defaultPenalty: "warning" }])}>Add infraction</Button></div>
            </div>
          </details>
        </fieldset>
        <div className="dk-btn-row" style={{ alignItems: "center" }}>
          <Button type="submit" variant="violet" disabled={!editable || !dirty}>Save settings</Button>
          {dirty && <Button onClick={() => setDraft(state.settings)}>Discard changes</Button>}
          <span role="status" className={msg?.bad ? "dd-error" : "dd-meta"}>{msg?.text}</span>
        </div>
        {!editable && <p className="dd-meta" style={{ margin: 0 }}>{state.phase === "complete" ? "This event is finished. Reopen it from the Tournament menu to change settings." : "Your role can read settings but not change them."}</p>}
      </form>
    </section>

    <section className="dk-sec" aria-labelledby="set-links">
      <h2 id="set-links" className="dk-h2">Links</h2>
      {([["Public page", desk.links.public], ["Player page (join and report)", desk.links.join]] as const).map(([label, path]) => <div key={path} className="dk-copy">
        <span style={{ minWidth: 190 }}>{label}</span><code>{path}</code><Button size="sm" onClick={() => copy(path)} aria-label={`Copy link: ${label}`}>Copy link</Button>
      </div>)}
    </section>

    <StaffSection code={code} desk={desk} role={role} send={send} />
    <DiscordSection code={code} role={role} />

    <section className="dk-sec" aria-labelledby="set-files">
      <h2 id="set-files" className="dk-h2">Import and export</h2>
      <div className="dk-links">
        {([["tournament", "Tournament file (.Tournament)"], ["players-xml", "Players (XML)"], ["players.csv", "Players (CSV)"], ["standings.csv", "Standings (CSV)"], ["matches.csv", "Matches (CSV)"]] as const).map(([kind, label]) =>
          <a key={kind} className="dd-btn dd-btn--sm" href={`/api/events/${encodeURIComponent(code)}/export/${kind}`} download>{label}</a>)}
      </div>
      {can(role, "UpdateSettings") && <div className="dk-links">
        <Button size="sm" onClick={() => onImport("players")} disabled={state.phase !== "registration"}>Import players…</Button>
        <Button size="sm" onClick={() => onImport("tournament")}>Import a .Tournament file…</Button>
        {state.phase !== "registration" && <span className="dd-meta" style={{ alignSelf: "center" }}>Player lists import during registration only.</span>}
      </div>}
    </section>
  </div>;
}

function StaffSection({ code, desk, role, send }: { code: string; desk: DeskView; role: StaffRole; send: SendFn }) {
  const manage = can(role, "AddStaff");
  const search = useAccountSearch(code);
  const [newRole, setNewRole] = useState<StaffRole>("scorekeeper");
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const staffIds = new Set(desk.state.staff.map(s => s.userId));
  const roles = ROLES.filter(r => r !== "organizer" || role === "organizer");
  const report = useCallback((res: { ok: boolean; message?: string }, ok: string) => setMsg(res.ok ? { bad: false, text: ok } : { bad: true, text: res.message ?? "Failed." }), []);
  return <section className="dk-sec" aria-labelledby="set-staff">
    <h2 id="set-staff" className="dk-h2">Staff and roles</h2>
    <ul className="dk-list">{desk.state.staff.map(s => <li key={s.id} className="dk-trow dk-staff">
      <span>{s.name}</span>
      <Select compact aria-label={`Role for ${s.name}`} value={s.role} disabled={!manage || (s.role === "organizer" && role !== "organizer")} onChange={async e => report(await send({ type: "SetStaffRole", staffId: s.id, role: e.target.value as StaffRole }), `${s.name} is now ${ROLE_LABEL[e.target.value as StaffRole]}.`)}>
        {ROLES.map(r => <option key={r} value={r} disabled={r === "organizer" && role !== "organizer"}>{ROLE_LABEL[r]}</option>)}
      </Select>
      {manage ? <Button size="sm" variant="rose-outline" aria-label={`Remove ${s.name} from staff`} onClick={async () => report(await send({ type: "RemoveStaff", staffId: s.id }), `${s.name} removed from staff.`)}>Remove</Button> : <span />}
    </li>)}</ul>
    {manage && <div className="dk-slip dk-sec" style={{ gap: 10 }}>
      <form role="search" className="dk-dlg-row" onSubmit={e => { e.preventDefault(); void search.run(search.query.trim()); }}>
        <Field label="Add staff: account search"><Input type="search" value={search.query} onChange={e => search.setQuery(e.target.value)} autoComplete="off" placeholder="Name, username or Discord" /></Field>
        <Field label="Role"><Select value={newRole} onChange={e => setNewRole(e.target.value as StaffRole)}>{roles.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></Field>
      </form>
      {search.results?.length === 0 && <p className="dd-meta" style={{ margin: 0 }}>No accounts match.</p>}
      <ul className="dk-acc">{(search.results ?? []).map(a => <li key={a.userId}>
        <div className="dk-acc-info"><span className="dk-acc-name">{a.displayName}</span><span className="dd-meta">@{a.username}</span></div>
        {staffIds.has(a.userId) ? <span className="dd-chip dd-chip--muted">On staff</span>
          : <Button size="sm" variant="violet" onClick={async () => report(await send({ type: "AddStaff", userId: a.userId, name: a.displayName, role: newRole }), `${a.displayName} added as ${ROLE_LABEL[newRole]}.`)}>Add as {ROLE_LABEL[newRole]}</Button>}
      </li>)}</ul>
    </div>}
    <span role="status" className={msg?.bad ? "dd-error" : "dd-meta"}>{msg?.text}</span>
  </section>;
}

function DiscordSection({ code, role }: { code: string; role: StaffRole }) {
  const edit = canEditDiscord(role);
  const [state, setState] = useState<{ configured: boolean; postPairings: boolean; postStandings: boolean } | null>(null);
  const [url, setUrl] = useState("");
  const [pairings, setPairings] = useState(false);
  const [standings, setStandings] = useState(false);
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/events/${encodeURIComponent(code)}/discord`, { cache: "no-store" });
      if (!r.ok) return;
      const body = (await r.json()) as { configured: boolean; postPairings: boolean; postStandings: boolean };
      setState(body); setPairings(body.postPairings); setStandings(body.postStandings);
    } catch { /* leave blank */ }
  }, [code]);
  useEffect(() => { void load(); }, [load]);
  async function put(webhookUrl: string | null) {
    const r = await fetch(`/api/events/${encodeURIComponent(code)}/discord`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ webhookUrl, postPairings: pairings, postStandings: standings }) });
    if (!r.ok) { setMsg({ bad: true, text: r.status === 400 ? "That is not a Discord webhook URL (https://discord.com/api/webhooks/…)." : "Could not save." }); return; }
    setUrl(""); setMsg({ bad: false, text: webhookUrl === null ? "Webhook removed." : "Webhook saved." }); await load();
  }
  return <section className="dk-sec" aria-labelledby="set-discord">
    <h2 id="set-discord" className="dk-h2">Discord webhook</h2>
    <p className="dd-meta" style={{ margin: 0 }}>{state === null ? "Loading…" : state.configured ? "A webhook is configured. Its URL is never shown again." : "No webhook configured."}</p>
    {edit ? <form className="dk-sec" style={{ gap: 12 }} onSubmit={e => { e.preventDefault(); if (url.trim()) void put(url.trim()); }}>
      <Field label={state?.configured ? "Replace webhook URL" : "Webhook URL"} hint="Paste a Discord channel webhook. The post options save together with the URL, so paste it again to change them."><Input type="password" autoComplete="off" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/…" /></Field>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 24px" }}>
        <Checkbox label="Post pairings" checked={pairings} onChange={e => setPairings(e.target.checked)} />
        <Checkbox label="Post standings" checked={standings} onChange={e => setStandings(e.target.checked)} />
      </div>
      <div className="dk-btn-row" style={{ alignItems: "center" }}>
        <Button variant="violet" disabled={!url.trim()} onClick={() => void put(url.trim())}>Save webhook</Button>
        <Button disabled={!state?.configured || !!url.trim()} onClick={() => void put(null)}>Remove webhook</Button>
        <span role="status" className={msg?.bad ? "dd-error" : "dd-meta"}>{msg?.text}</span>
      </div>
    </form> : <p className="dd-meta" style={{ margin: 0 }}>Only the organizer can change the webhook.</p>}
  </section>;
}

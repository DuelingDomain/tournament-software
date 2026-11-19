"use client";
import { useCallback, useEffect, useState } from "react";
import type { DeskView, StaffRole } from "@dd-tournament/engine";
import { Button, Checkbox, Field, Input } from "../ui";
import { canEditDiscord } from "./roles";

/** Links and the Discord webhook, shown under the tournament settings fields. */
export function SharingSections({ code, desk, role, onNote }: { code: string; desk: DeskView; role: StaffRole; onNote: (text: string, bad?: boolean) => void }) {
  const copy = (path: string) => { void navigator.clipboard?.writeText(`${location.origin}${path}`).then(() => onNote("Link copied."), () => onNote("Could not copy. Select the link and copy it.", true)); };
  return <div className="dk-sec" style={{ marginTop: 4 }}>
    <section className="dk-sec" aria-labelledby="set-links">
      <h2 id="set-links" className="dk-h2">Links</h2>
      {([["Public page", desk.links.public], ["Player page (join and report)", desk.links.join]] as const).map(([label, path]) => <div key={path} className="dk-copy">
        <span style={{ minWidth: 190 }}>{label}</span><code>{path}</code><Button size="sm" onClick={() => copy(path)} aria-label={`Copy link: ${label}`}>Copy link</Button>
      </div>)}
    </section>
    <DiscordSection code={code} role={role} />
  </div>;
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

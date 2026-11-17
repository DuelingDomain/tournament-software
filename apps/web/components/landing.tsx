"use client";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
const meSchema = z.object({ user: z.object({ displayName: z.string() }).nullable(), canCreate: z.boolean() });
const eventsSchema = z.object({ events: z.array(z.object({ code: z.string(), name: z.string(), phase: z.string() })) });
export function Landing() {
  const [me, setMe] = useState<z.infer<typeof meSchema> | null>(null);
  const [events, setEvents] = useState<z.infer<typeof eventsSchema>["events"]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    fetch("/api/me").then(r => r.json()).then(data => meSchema.parse(data)).then(async data => {
      setMe(data);
      if (data.user) setEvents(eventsSchema.parse(await (await fetch("/api/events")).json()).events);
    }).catch(() => setMessage("Could not load your account."));
  }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.get("name"), createCode: form.get("createCode") }) });
    const data: unknown = await response.json();
    if (!response.ok) { setMessage(JSON.stringify(data)); return; }
    window.location.assign(`/e/${z.object({ code: z.string() }).parse(data).code}/desk`);
  }
  return <><h1>DD Tournaments</h1><p>Run community tournaments with Dueling Domain accounts.</p>
    {me?.user ? <><p>Signed in as {me.user.displayName}</p><form onSubmit={async event => { event.preventDefault(); await fetch("/auth/sign-out", { method: "POST" }); window.location.assign("/"); }}><button>Sign out</button></form>
      <h2>My events</h2><ul>{events.map(event => <li key={event.code}><a href={`/e/${event.code}`}>{event.name}</a> ({event.phase})</li>)}</ul>
      {me.canCreate && <form onSubmit={create}><h2>Create event</h2><label>Name <input name="name" required /></label><label>Create code <input name="createCode" type="password" defaultValue="" /></label><button>Create</button></form>}</>
      : <a href="/auth/start?return=/">Sign in with Dueling Domain</a>}
    <p role="status">{message}</p></>;
}

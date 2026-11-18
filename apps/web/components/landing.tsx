"use client";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { Button, ButtonLink, Field, Input, LogoMark, Perforation, Sheet, Slip, Wordmark } from "./ui";

const meSchema = z.object({ user: z.object({ displayName: z.string(), username: z.string().optional() }).nullable(), canCreate: z.boolean() });
const eventsSchema = z.object({ events: z.array(z.object({
  code: z.string(), name: z.string(), phase: z.string(), role: z.string().nullable().optional(), joined: z.boolean().optional(), startsAt: z.string().nullable().optional(),
})) });
type EventRow = z.infer<typeof eventsSchema>["events"][number];

const PHASE: Record<string, string> = { registration: "Registration", swiss: "Swiss rounds", playoff: "Playoffs", complete: "Complete" };
const ROLE: Record<string, string> = { organizer: "Organizer", head_judge: "Head judge", judge: "Judge", scorekeeper: "Scorekeeper", staff: "Staff" };
const ERRORS: Record<string, string> = { invalid_create_code: "That create code is not right.", invalid_body: "Check the event name and try again.", unauthorized: "Sign in again to continue." };

function when(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function Landing() {
  const [me, setMe] = useState<z.infer<typeof meSchema> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const [signinError, setSigninError] = useState("");

  useEffect(() => {
    // A failed sign-in step sends the browser here with ?signin=<code>; show it once, then clean the address bar.
    const params = new URLSearchParams(window.location.search);
    if (params.has("signin")) {
      setSigninError(params.get("signin") === "replayed_assertion" ? "That sign-in link was already used. Sign in again." : "Sign-in did not finish. Try again.");
      params.delete("signin");
      window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
    }
    let alive = true;
    (async () => {
      try {
        const data = meSchema.parse(await (await fetch("/api/me")).json());
        if (!alive) return;
        setMe(data);
        if (data.user) {
          const list = eventsSchema.parse(await (await fetch("/api/events")).json()).events;
          if (alive) setEvents(list);
        }
      } catch { if (alive) setMessage("Could not load your account. Reload to try again."); }
      finally { if (alive) setLoaded(true); }
    })();
    return () => { alive = false; };
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: String(form.get("name") ?? "").trim(), createCode: String(form.get("createCode") ?? "") }) });
      const data: unknown = await response.json();
      if (!response.ok) { setMessage(ERRORS[(data as { error?: string }).error ?? ""] ?? "Could not create the event."); setBusy(false); return; }
      window.location.assign(`/e/${z.object({ code: z.string() }).parse(data).code}/desk`);
    } catch { setMessage("Could not create the event."); setBusy(false); }
  }

  async function signOut() {
    await fetch("/auth/sign-out", { method: "POST" }).catch(() => undefined);
    window.location.assign("/");
  }

  if (!loaded) return <div className="land-center"><p role="status" className="dd-meta">Loading...</p></div>;
  if (!me?.user) return <SignIn message={message || signinError} />;

  return <div className="pub-page"><div className="pub-wrap" style={{ maxWidth: 960 }}>
    <header className="land-bar">
      <Wordmark full fill="var(--bg-deep)" />
      <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
        <span className="dd-meta">Signed in as <strong style={{ color: "var(--text)", fontWeight: 600 }}>{me.user.displayName}</strong></span>
        <Button size="sm" variant="ghost" onClick={signOut}>Sign out</Button>
      </span>
    </header>
    <div className="land-grid">
      <Sheet aria-labelledby="my-events-h" style={{ display: "grid", gap: 12, alignContent: "start" }}>
        <h1 id="my-events-h" className="dd-display" style={{ margin: 0, fontSize: 20 }}>My events</h1>
        {events.length === 0 && <p className="dd-meta" style={{ margin: 0 }}>You are not part of any event yet. Open an event link from your organizer to join, or create your own.</p>}
        <ul className="pub-list">
          {events.map(e => <li key={e.code}><Slip className="land-event">
            <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
              <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{e.name}</span>
              <span className="dd-meta">{PHASE[e.phase] ?? e.phase}{e.role ? ` · ${ROLE[e.role] ?? e.role}` : ""}{e.joined ? " · Playing" : ""}{when(e.startsAt) ? ` · ${when(e.startsAt)}` : ""}</span>
            </div>
            <div className="land-actions">
              {e.role && <ButtonLink size="sm" variant="violet" href={`/e/${e.code}/desk`}>Desk</ButtonLink>}
              {e.joined && <ButtonLink size="sm" href={`/e/${e.code}/me`}>My table</ButtonLink>}
              <ButtonLink size="sm" variant="ghost" href={`/e/${e.code}`}>Public page</ButtonLink>
            </div>
          </Slip></li>)}
        </ul>
      </Sheet>
      {me.canCreate && <form className="dd-sheet" onSubmit={create} aria-labelledby="create-h" style={{ display: "grid", gap: 16, alignContent: "start" }}>
        <h2 id="create-h" className="dd-display" style={{ margin: 0, fontSize: 20 }}>Create event</h2>
        <Field label="Event name"><Input name="name" required maxLength={200} placeholder="Weekly Duel Night #12" autoComplete="off" /></Field>
        <Field label="Create code" hint="Only if your community asked for one."><Input name="createCode" type="password" autoComplete="off" /></Field>
        <Button type="submit" variant="rose" disabled={busy} block>{busy ? "Creating..." : "Create event"}</Button>
        <p role="alert" className="dd-error" style={{ margin: 0 }}>{message}</p>
      </form>}
    </div>
    {!me.canCreate && <p role="alert" className="dd-error">{message}</p>}
  </div></div>;
}

function SignIn({ message }: { message: string }) {
  return <div className="land-center">
    <div className="land-stack">
      <div className="land-sleeve" aria-hidden="true" style={{ transform: "translate(-10px, 10px)", background: "var(--bg-surface)" }} />
      <div className="land-sleeve" aria-hidden="true" style={{ transform: "translate(-5px, 5px)", background: "#1a2036", borderTopColor: "var(--border-hi)" }} />
      <main className="land-card">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <LogoMark size={28} fill="var(--bg-elevated)" /><span className="dd-caps">Dueling Domain</span>
        </div>
        <h1 className="dd-display" style={{ margin: 0, fontSize: 32, lineHeight: 1.1 }}>DD Tournaments</h1>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5 }}>Run and follow card-game tournaments: pairings, results, standings.</p>
        <Perforation className="land-perf" />
        <div style={{ marginTop: "auto", display: "grid", gap: 12 }}>
          <ButtonLink variant="rose" size="lg" block href="/auth/start?return=/">Sign in with Dueling Domain</ButtonLink>
          <p className="dd-meta" style={{ margin: 0, textAlign: "center" }}>Organizers run the desk. Players see their table and report from their phone.</p>
          {message && <p role="alert" className="dd-error">{message}</p>}
        </div>
      </main>
    </div>
    <footer className="land-foot">
      <a href="https://duelingdomain.com/privacy">Privacy</a>
      <a href="https://duelingdomain.com/terms">Terms</a>
      <a href="mailto:support@duelingdomain.com">support@duelingdomain.com</a>
    </footer>
  </div>;
}

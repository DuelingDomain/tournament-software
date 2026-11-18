"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button, ButtonLink, LogoMark, Perforation, Wordmark } from "./ui";
import { EventList, eventsSchema, type EventRow } from "./event-list";
import { TournamentDialog } from "./desk/tournament-dialog";

const meSchema = z.object({ user: z.object({ id: z.number(), displayName: z.string(), username: z.string().optional() }).nullable(), canCreate: z.boolean(), createCodeRequired: z.boolean().default(false) });
export function Landing() {
  const [me, setMe] = useState<z.infer<typeof meSchema> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);

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
        if (data.user && data.canCreate && params.has("new")) { setCreating(true); params.delete("new"); window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`); }
        if (data.user) {
          const list = eventsSchema.parse(await (await fetch("/api/events")).json()).events;
          if (alive) setEvents(list);
        }
      } catch { if (alive) setMessage("Could not load your account. Reload to try again."); }
      finally { if (alive) setLoaded(true); }
    })();
    return () => { alive = false; };
  }, []);

  /** The new tournament opens on the Players panel; team events open there too, on the team enroll form. */
  function created(code: string) {
    try { localStorage.setItem(`dk:panel:${code}`, "players"); } catch { /* storage unavailable */ }
    window.location.assign(`/e/${encodeURIComponent(code)}/desk`);
  }

  async function signOut() {
    await fetch("/auth/sign-out", { method: "POST" }).catch(() => undefined);
    window.location.assign("/");
  }

  if (!loaded) return <div className="land-center"><p role="status" className="dd-meta">Loading...</p></div>;
  if (!me?.user) return <SignIn message={message || signinError} />;

  return <div className="ev-page">
    <header className="land-bar">
      <Wordmark full fill="var(--bg-deep)" />
      <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
        <span className="dd-meta">Signed in as <strong style={{ color: "var(--text)", fontWeight: 600 }}>{me.user.displayName}</strong></span>
        <Button size="sm" variant="ghost" onClick={signOut}>Sign out</Button>
      </span>
    </header>
    <EventList events={events} canCreate={me.canCreate} onCreate={() => setCreating(true)} />
    {message && <p role="alert" className="dd-error">{message}</p>}
    {creating && <TournamentDialog mode="create" creator={{ userId: me.user.id, name: me.user.displayName }} createCodeRequired={me.createCodeRequired} onClose={() => setCreating(false)} onCreated={created} />}
  </div>;
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

"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
type Mode = "public" | "me" | "desk" | "print";
export function EventPanel({ code, mode, printKind }: { code: string; mode: Mode; printKind?: string }) {
  const base = `/api/events/${encodeURIComponent(code)}`;
  const [data, setData] = useState<unknown>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`${base}${mode === "public" ? "" : mode === "me" ? "/me" : "/desk"}`);
    const value: unknown = await response.json();
    setData(value); if (!response.ok) setMessage(`Request failed (${response.status})`);
  }, [base, mode]);
  useEffect(() => { load().catch(() => setMessage("Could not load this event.")); }, [load]);
  async function send(action: string, payload: unknown) {
    const response = await fetch(`${base}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const value: unknown = await response.json();
    setMessage(response.ok ? "Saved" : JSON.stringify(value));
    await load();
  }
  function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const memberId = String(new FormData(event.currentTarget).get("memberId") ?? "");
    void send("join", memberId ? { memberId } : {});
  }
  function report(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void send("report", { matchId: form.get("matchId"), result: form.get("result") });
  }
  function command(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const version = z.object({ version: z.number() }).parse(data).version;
      const parsed: unknown = JSON.parse(String(new FormData(event.currentTarget).get("command")));
      void send("commands", { expectedVersion: version, command: parsed });
    } catch { setMessage("Enter a valid command and load the desk first."); }
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const response = await fetch(`${base}/import`, { method: "POST", body: form });
    setMessage(JSON.stringify(await response.json())); await load();
  }
  const display = printKind === "standings" ? z.object({ standings: z.unknown() }).safeParse(data)
    : printKind ? z.object({ state: z.object({ rounds: z.array(z.unknown()) }) }).safeParse(data) : null;
  const shown = display?.success ? ("standings" in display.data ? display.data.standings : display.data.state.rounds.at(-1)) : data;
  return <><h1>Event {code}{printKind ? `: ${printKind}` : ""}</h1>
    <nav><a href={`/e/${code}`}>Public</a> | <a href={`/e/${code}/me`}>My entry</a> | <a href={`/e/${code}/desk`}>Desk</a> | <a href={`/auth/start?return=${encodeURIComponent(`/e/${code}/${mode === "me" ? "me" : "desk"}`)}`}>Sign in</a></nav>
    {mode === "me" && <><form onSubmit={join}><label>Member ID (optional) <input name="memberId" /></label><button>Join</button></form>
      <form onSubmit={report}><label>Match ID <input name="matchId" required /></label><label>Result <select name="result"><option value="p1">Player 1 wins</option><option value="p2">Player 2 wins</option><option value="draw">Draw</option><option value="double_loss">Double loss</option></select></label><button>Report</button></form>
      <button onClick={() => void send("drop", {})}>Drop from event</button></>}
    {mode === "desk" && <><form onSubmit={command}><label>Command JSON <textarea name="command" defaultValue={'{"type":"PairNextRound"}'} required /></label><button>Apply</button></form>
      <form onSubmit={upload}><label>XML file <input type="file" name="file" required /></label><select name="kind" aria-label="Import kind"><option value="tournament">Tournament</option><option value="players">Players</option></select><button>Import</button></form>
      <p>{["tournament", "players-xml", "players.csv", "standings.csv", "matches.csv"].map(kind => <a key={kind} href={`${base}/export/${kind}`}>{kind} </a>)}</p>
      <p>{["pairings", "slips", "standings"].map(kind => <a key={kind} href={`/e/${code}/print/${kind}`}>Print {kind} </a>)}</p></>}
    {mode === "print" && <button onClick={() => window.print()}>Print</button>}
    <p role="status">{message}</p><pre>{JSON.stringify(shown, null, 2)}</pre></>;
}

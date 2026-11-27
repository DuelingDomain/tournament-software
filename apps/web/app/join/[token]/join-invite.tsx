"use client";
import { useState } from "react";
import { Button } from "../../../components/ui";

export function JoinInvite({ token, organizerName }: { token: string; organizerName: string }) {
  const [pending, setPending] = useState(false);
  const [joinedOrganizer, setJoinedOrganizer] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function join() {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/players/join", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      });
      if (response.status === 401) {
        window.location.replace(`/auth/start?${new URLSearchParams({ return: `/join/${token}` })}`);
        return;
      }
      if (response.status === 404) { setError("This invite link is no longer valid."); return; }
      if (!response.ok) throw new Error();
      const joined = (await response.json()) as { organizerName: string };
      setJoinedOrganizer(joined.organizerName);
    } catch {
      setError("Could not join. Try again.");
    } finally {
      setPending(false);
    }
  }

  return <>
    <h1 className="dd-display state-title">{joinedOrganizer ? "Player list joined" : `Join ${organizerName}'s player list?`}</h1>
    {joinedOrganizer
      ? <p className="state-text" role="status">You joined {joinedOrganizer}'s player list.</p>
      : <Button variant="violet" disabled={pending} onClick={() => void join()}>{pending ? "Joining…" : "Join"}</Button>}
    {error && <p className="state-text" role="alert">{error}</p>}
  </>;
}

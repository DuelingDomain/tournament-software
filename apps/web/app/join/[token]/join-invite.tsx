"use client";
import { useEffect, useState } from "react";

export function JoinInvite({ token }: { token: string }) {
  const [message, setMessage] = useState("Joining…");
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function join() {
      try {
        const response = await fetch("/api/players/join", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), signal,
        });
        if (response.status === 401) {
          window.location.replace(`/auth/start?${new URLSearchParams({ return: `/join/${token}` })}`);
          return;
        }
        if (response.status === 404) { setMessage("This invite link is no longer valid."); return; }
        if (!response.ok) throw new Error();
        const { organizerName } = (await response.json()) as { organizerName: string };
        setMessage(`You joined ${organizerName}'s player list.`);
      } catch {
        if (!signal.aborted) setMessage("Could not join. Reload this page to try again.");
      }
    }
    void join();
    return () => controller.abort();
  }, [token]);
  return <p className="state-text" role="status">{message}</p>;
}

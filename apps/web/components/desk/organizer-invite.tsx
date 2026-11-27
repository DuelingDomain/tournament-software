"use client";
import { useEffect, useState } from "react";
import { Button, Field, Input } from "../ui";

export function OrganizerInvite({ code }: { code: string }) {
  const endpoint = `/api/players/invite?event=${encodeURIComponent(code)}`;
  const [link, setLink] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load() {
      try {
        const response = await fetch(endpoint, { signal, cache: "no-store" });
        if (response.status === 403) return;
        if (!response.ok) throw new Error();
        const { path } = (await response.json()) as { path: string };
        setLink(new URL(path, window.location.origin).href);
      } catch {
        if (!signal.aborted) setMessage("Could not load your invite link.");
      }
    }
    void load();
    return () => controller.abort();
  }, [endpoint]);

  async function regenerate() {
    setRegenerating(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, { method: "PUT" });
      if (!response.ok) throw new Error();
      const { path } = (await response.json()) as { path: string };
      setLink(new URL(path, window.location.origin).href);
      setMessage("New invite link created.");
    } catch {
      setMessage("Could not regenerate the link.");
    } finally {
      setRegenerating(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setMessage("Invite link copied.");
    } catch {
      setMessage("Select the link to copy it.");
    }
  }

  if (!link && !message) return null;
  return <div>
    <div className="dk-field-row">
      <Field label="Your invite link"><Input value={link} readOnly onFocus={event => event.currentTarget.select()} /></Field>
      <div className="dk-btn-row">
        <Button onClick={() => void copy()} disabled={!link || regenerating}>Copy</Button>
        <Button onClick={() => void regenerate()} disabled={!link || regenerating}>Regenerate</Button>
      </div>
    </div>
    <span className="dd-meta" role="status">{message}</span>
  </div>;
}

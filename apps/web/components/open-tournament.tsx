"use client";
import { useEffect, useState } from "react";
import { Button, Dialog, Field, FilePicker, Input } from "./ui";
import { MESSAGES } from "./desk/use-desk";

const ACCEPT = ".Tournament,.tournament";

/** Open Tournament: the chosen .Tournament file becomes a new event, and you become its organizer. */
export function OpenTournamentDialog({ createCodeRequired, onClose }: { createCodeRequired?: boolean; onClose: () => void }) {
  const [needCode, setNeedCode] = useState(createCodeRequired ?? false);
  const [code, setCode] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (createCodeRequired !== undefined) return;
    void fetch("/api/me").then(r => r.json()).then((me: { createCodeRequired?: boolean }) => setNeedCode(Boolean(me.createCodeRequired))).catch(() => undefined);
  }, [createCodeRequired]);

  async function run() {
    if (!file) { setErr("Choose a file."); return; }
    setBusy(true); setErr(null);
    const form = new FormData(); form.set("file", file); form.set("createCode", code);
    try {
      const res = await fetch("/api/events/import", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string; message?: string };
      if (!res.ok || !body.code) { setErr(MESSAGES[body.error ?? ""] ?? body.message ?? "That file could not be opened."); setBusy(false); return; }
      window.location.assign(`/e/${encodeURIComponent(body.code)}/desk`);
    } catch { setErr("Could not reach the server."); setBusy(false); }
  }
  return <Dialog open onClose={onClose} title="Open Tournament" actions={<><Button onClick={onClose}>Cancel</Button><Button variant="violet" disabled={busy || !file} onClick={() => void run()}>Open</Button></>}>
    <p className="dd-meta" style={{ margin: 0 }}>The file opens as a new tournament. You are its organizer. Your other tournaments stay as they are.</p>
    <FilePicker label="Tournament file" accept={ACCEPT} file={file} onChange={f => { setFile(f); setErr(null); }}
      onReject={name => setErr(`${name} is not a .Tournament file.`)} hint="A .Tournament file." />
    {needCode && <Field label="Create code" hint="Your community asked for a code."><Input type="password" value={code} onChange={e => setCode(e.target.value)} autoComplete="off" required /></Field>}
    {err && <p role="alert" className="dd-error">{err}</p>}
  </Dialog>;
}

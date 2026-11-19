"use client";
import { useEffect, useState } from "react";
import type { StaffRole } from "@dd-tournament/engine";
import { isTemporaryMemberId, normalizeMemberId, padMemberId } from "@dd-tournament/engine";
import type { DeskView } from "../../lib/desk-view";
import { Button, Field, Input } from "../ui";
import { saveMemberId, useAccountSearch, type Account } from "./accounts";
import { WarnIcon } from "./icons";
import { useMemberIdWarnings } from "./member-id-warnings";
import { can } from "./roles";
import type { SendFn } from "./use-desk";

const pad = (id: string | null) => (id ? (normalizeMemberId(id) ? padMemberId(id) : id) : "");

/** The "All Players" tab: every Dueling Domain account staff can look up, with COSSY ID editing. */
export function AllPlayersPanel({ code, desk, role, send, notify, onExport, onImport }: { code: string; desk: DeskView; role: StaffRole; send: SendFn; notify: (m: string) => void; onExport: () => void; onImport: () => void }) {
  const search = useAccountSearch(code);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [overrides, setOverrides] = useState<Record<number, string | null>>({});
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const [listed, setListed] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => { void fetch("/api/players", { cache: "no-store" }).then(r => r.json()).then((b: { players?: unknown[] }) => { if (alive) setListed(b.players?.length ?? 0); }).catch(() => undefined); };
    load();
    window.addEventListener("dk:global-players", load);
    return () => { alive = false; window.removeEventListener("dk:global-players", load); };
  }, []);
  const enrolled = new Set(desk.state.players.flatMap(p => (p.userId === null ? [] : [p.userId])));
  const canEditId = can(role, "UpdatePlayer");
  const canAdd = can(role, "AddPlayers") && desk.state.phase !== "playoff" && desk.state.phase !== "complete";
  const current = (a: Account) => (a.userId in overrides ? overrides[a.userId] ?? null : a.memberId);
  const rows = (search.results ?? []).map(account => {
    const saved = pad(current(account));
    const value = edits[account.userId] ?? saved;
    return { account, value, memberId: normalizeMemberId(value), dirty: value !== saved };
  });
  const warnings = useMemberIdWarnings(code, rows.map(row => row.memberId), desk.specialMemberIdsEnabled);

  async function saveId(a: Account) {
    const raw = edits[a.userId] ?? pad(current(a));
    const value = raw.trim() === "" ? null : raw;
    if (value !== null && normalizeMemberId(value) === null) { setMsg({ bad: true, text: "A COSSY ID is one to ten digits." }); return; }
    const res = await saveMemberId(code, a.userId, value);
    if (!res.ok) { setMsg({ bad: true, text: res.message }); return; }
    setOverrides(o => ({ ...o, [a.userId]: res.memberId })); setEdits(e => { const { [a.userId]: _gone, ...rest } = e; return rest; });
    setMsg({ bad: false, text: `${a.displayName}: COSSY ID ${res.memberId ? `saved${res.checkDigitOk || isTemporaryMemberId(res.memberId) ? "" : ", but the check digit does not match. Confirm with the player"}` : "cleared"}.` });
  }
  async function enroll(a: Account) {
    const r = await send({ type: "AddPlayers", players: [{ userId: a.userId, name: a.displayName }] });
    setMsg(r.ok ? { bad: false, text: `${a.displayName} enrolled.` } : { bad: true, text: r.code === "member_id_required" ? "This tournament requires a COSSY ID. Save one for the account first." : r.message });
    if (r.ok) notify(`${a.displayName} enrolled`);
  }

  return <div className="dk-sec">
    <h2 className="dk-h2">All Players</h2>
    <p className="dd-meta" style={{ margin: 0 }}>Every Dueling Domain account you can look up. Edit a COSSY ID here and it saves to the account.</p>
    <div className="dk-field-row" aria-label="Global player list">
      <span className="dd-meta" style={{ alignSelf: "center" }}>Your global player list: {listed === null ? "loading" : `${listed} ${listed === 1 ? "player" : "players"}`}. Players from tournaments you open or import are added.</span>
      <div className="dk-btn-row"><Button onClick={onImport}>Import Player List…</Button><Button onClick={onExport} disabled={listed === 0}>Export to CSV</Button></div>
    </div>
    <form role="search" className="dk-field-row" onSubmit={e => { e.preventDefault(); void search.run(search.query.trim()); }}>
      <Field label="Account search"><Input type="search" value={search.query} onChange={e => search.setQuery(e.target.value)} autoComplete="off" placeholder="Name, username, Discord or COSSY ID" /></Field>
      <div className="dk-btn-row"><Button type="submit" variant="violet">Search</Button><Button onClick={() => { search.setQuery(""); void search.run(""); }}>Show All</Button></div>
    </form>
    <span role="status" className={msg?.bad ? "dd-error" : "dd-meta"}>{msg?.text}</span>
    {search.state === "error" && <p className="dd-error" role="alert">{search.error}</p>}
    {search.results === null && search.state !== "error" && <p className="dk-empty">Search to list accounts.</p>}
    {search.results?.length === 0 && <p className="dk-empty">No accounts match.</p>}
    <div className="dd-scroll-x"><div className="dk-table" style={{ "--w": "720px" } as React.CSSProperties}>
      {(search.results?.length ?? 0) > 0 && <div aria-hidden="true" className="dk-th dd-caps" style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr) 260px 110px" }}><span>Account</span><span>Discord</span><span>COSSY ID</span><span /></div>}
      <ul className="dk-list">{rows.map(({ account: a, value, memberId, dirty }) => {
        return <li key={a.userId} className="dk-trow" style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr) 260px 110px", paddingBlock: 8 }}>
          <span style={{ display: "flex", flexDirection: "column" }}><span style={{ fontWeight: 600 }}>{a.displayName}</span><span className="dd-meta">@{a.username}</span></span>
          <span className="dk-mono" style={{ color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis" }}>{a.discordUsername ?? "—"}</span>
          <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ display: "flex", gap: 6 }}>
              <Input mono className="dd-input--sm" aria-label={`COSSY ID for ${a.displayName}`} inputMode="numeric" value={value} disabled={!canEditId} onChange={e => setEdits(x => ({ ...x, [a.userId]: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") void saveId(a); }} />
              <Button size="sm" disabled={!canEditId || !dirty} onClick={() => void saveId(a)} aria-label={`Save COSSY ID for ${a.displayName}`}>Save</Button>
            </span>
            {memberId !== null && warnings.has(memberId) && <span className="dk-idwarn"><WarnIcon size={13} />Check digit does not match.</span>}
          </span>
          <span>{enrolled.has(a.userId) ? <span className="dd-chip dd-chip--muted">Enrolled</span> : canAdd && <Button size="sm" variant="violet" onClick={() => void enroll(a)}>Enroll</Button>}</span>
        </li>;
      })}</ul>
    </div></div>
  </div>;
}

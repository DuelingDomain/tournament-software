"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeskView, Player, StaffRole } from "@dd-tournament/engine";
import { isTemporaryMemberId, memberIdCheckDigitOk, normalizeMemberId, padMemberId } from "@dd-tournament/engine";
import { Button, ConfirmDialog, Field, Input } from "../ui";
import { saveMemberId, useAccountSearch, type Account } from "./accounts";
import { CheckIcon, DashIcon, RingIcon, WarnIcon } from "./icons";
import { byName, nextTempId, statusText } from "./helpers";
import { PointsControl } from "./points-control";
import { can } from "./roles";
import type { SendFn } from "./use-desk";

const pad = (id: string | null) => (id ? (normalizeMemberId(id) ? padMemberId(id) : id) : "");
function splitName(name: string): [string, string] {
  const parts = name.trim().split(/\s+/);
  return parts.length < 2 ? [name, ""] : [parts.slice(0, -1).join(" "), parts.at(-1)!];
}
function idProblem(id: string): string | null {
  const n = normalizeMemberId(id);
  if (!id.trim()) return null;
  if (n === null) return "A COSSY ID is one to ten digits.";
  if (!isTemporaryMemberId(n) && !memberIdCheckDigitOk(n)) return "Check digit does not match. Confirm with the player.";
  return null;
}

export function AccountList({ accounts, state, error, query, enrolled, canEnroll, onEnroll, onPick, children }: {
  accounts: Account[] | null; state: string; error: string | null; query: string; enrolled: Set<number>; canEnroll: boolean;
  onEnroll: (a: Account) => void; onPick?: (a: Account) => void; children?: (a: Account) => React.ReactNode;
}) {
  if (state === "error") return <p className="dd-error" role="alert"><WarnIcon size={14} />{error}</p>;
  if (accounts === null) return <p className="dd-meta" style={{ margin: 0 }}>Type a name, username, Discord or COSSY ID, or press Show All.</p>;
  if (accounts.length === 0) return <p className="dd-meta" style={{ margin: 0 }}>{state === "loading" ? "Searching…" : query ? `No accounts match "${query}".` : "No accounts to list. Type a name to search."}</p>;
  return <>
    <div className="dd-meta" aria-live="polite">{accounts.length} account{accounts.length === 1 ? "" : "s"}{query ? ` match "${query}"` : ""}</div>
    <ul className="dk-acc">{accounts.map(a => <li key={a.userId}>
      <button type="button" className="dk-acc-info" onClick={() => onPick?.(a)} disabled={!onPick} style={{ background: "none", border: 0, padding: 0, color: "inherit", textAlign: "left", cursor: onPick ? "pointer" : "default", font: "inherit" }}>
        <span className="dk-acc-name">{a.displayName}</span>
        <span className="dd-meta">@{a.username}{a.discordUsername ? <> · Discord <span className="dk-mono" style={{ color: "var(--text-3)" }}>{a.discordUsername}</span></> : null}</span>
        <span className="dd-meta">COSSY ID {a.memberId ? <span className="dk-mono" style={{ color: "var(--text)" }}>{pad(a.memberId)}</span> : "none on file, Enroll assigns a temp ID"}</span>
      </button>
      {children?.(a)}
      {canEnroll && (enrolled.has(a.userId) ? <span className="dd-chip dd-chip--muted">Enrolled</span> : <Button size="sm" variant="violet" onClick={() => onEnroll(a)}>Enroll</Button>)}
    </li>)}</ul>
  </>;
}

interface Props { code: string; desk: DeskView; role: StaffRole; send: SendFn; notify: (m: string, bad?: boolean) => void }
export function PlayersPanel({ code, desk, role, send, notify }: Props) {
  // Quick controls (check-in, points) retry once and tell the user when they still fail.
  const quick = async (input: Parameters<SendFn>[0]) => { const r = await send(input, { retry: true }); if (!r.ok) notify(r.message, true); };
  const { state } = desk;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [idText, setIdText] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ bad: boolean; text: string } | null>(null);
  const [confirmDrop, setConfirmDrop] = useState(false);
  const search = useAccountSearch(code);
  // Show the account list right away so the Name lookup column is never an empty box.
  useEffect(() => { void search.run(""); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const filterRef = useRef<HTMLInputElement>(null);
  const idRef = useRef<HTMLInputElement>(null);

  const selected = state.players.find(p => p.id === selectedId) ?? null;
  const canAdd = can(role, "AddPlayers"), canEdit = can(role, "UpdatePlayer"), canDrop = can(role, "DropPlayer") && can(role, "RemovePlayer");
  const round = state.rounds.at(-1);
  const registration = state.phase === "registration";
  const closed = state.phase === "playoff" || state.phase === "complete";
  const lateBlocked = !registration && !state.settings.allowLateEntry;
  const enrolledIds = useMemo(() => new Set(state.players.flatMap(p => (p.userId === null ? [] : [p.userId]))), [state.players]);
  const warnings = useMemo(() => new Map(desk.integrity.memberIdWarnings.map(w => [w.playerId, w.problem] as const)), [desk.integrity.memberIdWarnings]);

  useEffect(() => { const on = () => { filterRef.current?.focus(); filterRef.current?.select(); }; window.addEventListener("dk:focus-find", on); return () => window.removeEventListener("dk:focus-find", on); }, []);

  const clear = useCallback(() => { setSelectedId(null); setIdText(""); setFirst(""); setLast(""); setAccount(null); setMessage(null); search.setQuery(""); search.clear(); }, [search]);
  const pick = (p: Player) => {
    setSelectedId(p.id); setIdText(pad(p.memberId)); const [f, l] = splitName(p.name); setFirst(f); setLast(l); setAccount(null); setMessage(null);
  };
  const fillFromAccount = (a: Account) => {
    setSelectedId(null); setAccount(a); setIdText(pad(a.memberId)); const [f, l] = splitName(a.displayName); setFirst(f); setLast(l); setMessage(null);
  };

  // Typing a COSSY ID or a name looks accounts up, like the old name search.
  const onId = (value: string) => {
    setIdText(value); setMessage(null);
    const n = normalizeMemberId(value);
    if (!selected && n && value.replace(/\D/g, "").length >= 3) search.setQuery(n);
  };
  useEffect(() => {
    if (selected || !search.results) return;
    const n = normalizeMemberId(idText);
    const exact = n ? search.results.filter(a => a.memberId && normalizeMemberId(a.memberId) === n) : [];
    if (exact.length === 1 && account?.userId !== exact[0]!.userId) { setAccount(exact[0]!); const [f, l] = splitName(exact[0]!.displayName); setFirst(f); setLast(l); }
  }, [search.results, idText, selected, account]);
  const onName = (setter: (v: string) => void) => (value: string) => { setter(value); if (!selected) { setAccount(null); search.setQuery(value.trim()); } };

  /** No account: enroll by name and ID like the original. With no ID typed, the player gets the next temp ID. */
  async function enrollByName(typedId: string) {
    const name = [first.trim(), last.trim()].filter(Boolean).join(" ");
    if (!name) { setMessage({ bad: true, text: "Type a first and last name, or pick an account." }); return; }
    const normalized = typedId.trim() ? normalizeMemberId(typedId) : null;
    if (typedId.trim() && normalized === null) { setMessage({ bad: true, text: "A COSSY ID is one to ten digits." }); return; }
    const memberId = normalized ?? nextTempId(state.players);
    setBusy(true); setMessage(null);
    const result = await send({ type: "AddPlayers", players: [{ userId: null, name, memberId }] });
    setBusy(false);
    if (!result.ok) { setMessage({ bad: true, text: result.message }); return; }
    setMessage({ bad: false, text: `${name} enrolled with ${isTemporaryMemberId(memberId) ? "temp ID " : "ID "}${pad(memberId)}.` });
    notify(`${name} enrolled`);
    setSelectedId(null); setIdText(""); setFirst(""); setLast(""); setAccount(null); search.setQuery(""); search.clear();
    idRef.current?.focus();
  }

  async function enroll(target: Account | null, typedId: string, keepResults = false) {
    if (!target) { await enrollByName(typedId); return; }
    setBusy(true); setMessage(null);
    const normalized = typedId.trim() ? normalizeMemberId(typedId) : null;
    if (typedId.trim() && normalized === null) { setBusy(false); setMessage({ bad: true, text: "A COSSY ID is one to ten digits." }); return; }
    let tempAfter: string | null = null;
    if (normalized && isTemporaryMemberId(normalized)) tempAfter = normalized;
    else if (normalized && normalized !== target.memberId && normalizeMemberId(target.memberId ?? "") !== normalized) {
      const saved = await saveMemberId(code, target.userId, normalized);
      if (!saved.ok) { setBusy(false); setMessage({ bad: true, text: saved.message }); return; }
    } else if (!normalized && !target.memberId && !state.settings.requireMemberId) tempAfter = nextTempId(state.players);
    const result = await send({ type: "AddPlayers", players: [{ userId: target.userId, name: target.displayName }] });
    if (!result.ok) { setBusy(false); setMessage({ bad: true, text: result.code === "member_id_required" ? "This tournament requires a COSSY ID. Type one in the ID box, then Enroll." : result.message }); return; }
    const entry = result.desk.state.players.find(p => p.userId === target.userId);
    if (entry && tempAfter && can(role, "UpdatePlayer")) await send({ type: "UpdatePlayer", playerId: entry.id, memberId: tempAfter });
    setBusy(false);
    setMessage({ bad: false, text: `${target.displayName} enrolled${tempAfter ? ` with temp ID ${pad(tempAfter)}` : ""}.` });
    notify(`${target.displayName} enrolled`);
    if (keepResults) { setSelectedId(null); setIdText(""); setFirst(""); setLast(""); setAccount(null); } else clear();
    idRef.current?.focus();
  }

  async function update(player: Player) {
    setBusy(true); setMessage(null);
    const name = [first.trim(), last.trim()].filter(Boolean).join(" ");
    const normalized = idText.trim() ? normalizeMemberId(idText) : null;
    if (idText.trim() && normalized === null) { setBusy(false); setMessage({ bad: true, text: "A COSSY ID is one to ten digits." }); return; }
    if (!name) { setBusy(false); setMessage({ bad: true, text: "A player needs a name." }); return; }
    if (player.userId !== null && normalized && !isTemporaryMemberId(normalized) && normalized !== player.memberId) {
      const saved = await saveMemberId(code, player.userId, normalized);
      if (!saved.ok) { setBusy(false); setMessage({ bad: true, text: saved.message }); return; }
    }
    // Send only what changed: after the event is finalized the server accepts an ID-only change.
    const nameChanged = name !== player.name, idChanged = normalized !== player.memberId;
    if (!nameChanged && !idChanged) { setBusy(false); setMessage({ bad: false, text: `${name} is unchanged.` }); return; }
    const result = await send({ type: "UpdatePlayer", playerId: player.id, ...(nameChanged ? { name } : {}), ...(idChanged ? { memberId: normalized } : {}) });
    setBusy(false);
    setMessage(result.ok ? { bad: false, text: `${name} updated.` } : { bad: true, text: result.message });
  }

  async function dropOrReenroll(player: Player) {
    setConfirmDrop(false);
    const result = player.status === "dropped" ? await send({ type: "ReEnroll", playerId: player.id })
      : await send(registration ? { type: "RemovePlayer", playerId: player.id } : { type: "DropPlayer", playerId: player.id });
    setMessage(result.ok ? { bad: false, text: player.status === "dropped" ? `${player.name} re-enrolled.` : registration ? `${player.name} removed.` : `${player.name} dropped.` } : { bad: true, text: result.message });
    if (result.ok && registration) clear();
  }

  const stats = useMemo(() => {
    const active = state.players.filter(p => p.status === "active");
    return { total: state.players.length, active: active.length, checked: active.filter(p => p.checkedIn).length, dropped: state.players.filter(p => p.status === "dropped").length, cut: state.players.filter(p => p.status === "cut").length };
  }, [state.players]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = [...state.players].sort(byName);
    if (!q) return list;
    return list.filter(p => p.name.toLowerCase().includes(q) || (p.memberId && pad(p.memberId).includes(q.replace(/\D/g, "") || "\u0000")) || desk.accounts[p.id]?.discordUsername?.toLowerCase().includes(q) || desk.accounts[p.id]?.username?.toLowerCase().includes(q));
  }, [state.players, filter, desk.accounts]);

  const open = state.settings.format === "open_dueling" || state.settings.style === "open_dueling";
  const problem = idProblem(idText);
  const formName = [first, last].filter(Boolean).join(" ");
  const enrollLabel = selected ? "Update" : "Enroll";
  // Updating a name or ID works in every phase; only new entries stop after the cut.
  const enrollDisabled = busy || (selected ? !canEdit : closed || lateBlocked || !canAdd || (!account && !formName.trim()));
  const dropLabel = selected?.status === "dropped" ? "Re-enroll" : "Drop";
  const dropDisabled = busy || !selected || !canDrop || selected.status === "cut" || state.phase === "complete";
  const lateNote = !registration && !lateBlocked && !closed ? `Late entry: a new player gets a loss bye for ${state.rounds.length === 1 ? "round 1" : `rounds 1 to ${state.rounds.length}`}.` : "";

  return <div className="dk-pane">
    <form className="dk-slip dk-field-row" aria-label="Enroll a player" onSubmit={e => { e.preventDefault(); if (enrollDisabled) return; void (selected ? update(selected) : enroll(account, idText)); }}>
      <Field label="COSSY ID" className="dd-field--id"><Input ref={idRef} mono inputMode="numeric" autoComplete="off" value={idText} onChange={e => onId(e.target.value)} aria-describedby="enroll-note" aria-invalid={problem !== null && idText.length >= 10 ? true : undefined} /></Field>
      <Field label="First & Middle"><Input autoComplete="off" value={first} readOnly={!!account && !selected} onChange={e => onName(setFirst)(e.target.value)} /></Field>
      <Field label="Last"><Input autoComplete="off" value={last} readOnly={!!account && !selected} onChange={e => onName(setLast)(e.target.value)} /></Field>
      <div className="dk-btn-row">
        <Button type="submit" variant="violet" disabled={enrollDisabled} keyHint="Enter">{enrollLabel}</Button>
        <Button onClick={clear}>Clear</Button>
        <Button variant="rose-outline" disabled={dropDisabled} onClick={() => selected && (selected.status === "dropped" ? void dropOrReenroll(selected) : setConfirmDrop(true))} aria-label={selected ? `${dropLabel} ${selected.name}` : "Drop (select a player first)"}>{dropLabel}</Button>
        <Button disabled={busy || (!selected ? !canAdd : !canEdit)} onClick={() => { const t = pad(nextTempId(state.players)); setIdText(t); setMessage({ bad: false, text: selected ? "Temp ID filled. Press Update to save it." : "Temp ID filled." }); }}>Temp ID</Button>
      </div>
      <p id="enroll-note" className={`dk-note${message?.bad ? " dk-note--bad" : ""}`} role="status">
        {message && <span>{message.text}</span>}
        {!message && account && !selected && <span>Filled from Name lookup: {account.displayName}, account <span className="dk-mono" style={{ color: "var(--text)" }}>{account.username}</span>. Enroll adds them{state.rounds.length ? ` to round ${round?.number} pairings` : " to the tournament"}.</span>}
        {!message && !account && !selected && !formName.trim() && <span>Type a COSSY ID or a name to find an account, or search on the right.</span>}
        {!message && !account && !selected && formName.trim() && <span>No account picked. Enroll adds {formName.trim()} by name with {idText.trim() ? "the ID you typed" : "a temp ID"}. Pick an account on the right to link one.</span>}
        {!message && selected && <span>{selected.name} selected. Edit the name or ID and press Update.</span>}
        {problem && <span className="dk-idwarn"><WarnIcon size={13} />{problem}</span>}
        {lateBlocked && !selected && <span>Late entry is off for this tournament. Turn it on in Settings.</span>}
        {lateNote && !selected && <span>{lateNote}</span>}
        {selected && registration && <span>Dropping before round 1 removes the player.</span>}
      </p>
    </form>

    <div className="dk-split">
      <section aria-labelledby="enrolled-h" className="dk-split-main">
        <div className="dk-listhead">
          <h2 id="enrolled-h" className="dk-h2">Enrolled Players:</h2>
          <span className="dd-meta">{stats.total} enrolled · {stats.active} active ({stats.checked} checked in){stats.dropped ? ` · ${stats.dropped} dropped` : ""}{stats.cut ? ` · ${stats.cut} cut` : ""}</span>
          <Field label={<>Filter <span className="dk-mono" style={{ textTransform: "none" }}>Ctrl+F</span></>} className="dk-filter">
            <Input ref={filterRef} type="search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Name, COSSY ID or Discord" autoComplete="off" />
          </Field>
        </div>
        <div className="dd-scroll-x dk-scroll"><div className="dk-table" style={{ "--w": open ? "760px" : "660px" } as React.CSSProperties}>
          <div aria-hidden="true" className="dk-ph dd-caps" data-pts={open}><span>Name</span><span>COSSY ID</span><span>Discord</span><span>Status</span>{open && <span>Points</span>}</div>
          {shown.length === 0 && <p className="dk-empty">{state.players.length ? "No player matches that filter." : "No players yet. Search accounts on the right and press Enroll."}</p>}
          <ul className="dk-plist">{shown.map(p => {
            const warn = warnings.get(p.id);
            const acc = desk.accounts[p.id];
            const temp = p.memberId !== null && isTemporaryMemberId(p.memberId);
            return <li key={p.id} className="dk-prow" data-selected={p.id === selectedId} data-pts={open}>
              <button type="button" className="dk-prow-main" aria-pressed={p.id === selectedId} onClick={() => pick(p)}>
                <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span>{p.name}{p.userId === null && <span className="dd-meta"> · no account yet</span>}</span>
                  {warn && <span className="dk-idwarn"><WarnIcon size={13} />{warn === "duplicate" ? "Another player has this COSSY ID." : "Check digit does not match. Confirm with the player."}</span>}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span className="dk-mono">{p.memberId ? pad(p.memberId) : "—"}</span>{temp && <span className="dk-tempid">TEMP ID</span>}
                </span>
                <span className="dk-mono" style={{ color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis" }}>{acc?.discordUsername ?? "—"}</span>
              </button>
              {p.status === "active"
                ? <button type="button" className="dk-status" data-state={p.checkedIn ? "in" : "idle"} role="switch" aria-checked={p.checkedIn} disabled={!can(role, "SetCheckedIn") || state.phase === "complete"} aria-label={`${p.name}: ${p.checkedIn ? "checked in" : "not checked in"}`}
                  onClick={() => void quick({ type: "SetCheckedIn", playerId: p.id, checkedIn: !p.checkedIn })}>{p.checkedIn ? <CheckIcon size={12} /> : <RingIcon />}{statusText(p)}</button>
                : <span className="dk-status" data-state="out"><DashIcon />{statusText(p)}</span>}
              {open && <PointsControl name={p.name} points={p.openDuelingPoints ?? 0} disabled={!can(role, "AdjustPoints") || state.phase === "complete"} onAdjust={d => void quick({ type: "AdjustPoints", playerId: p.id, delta: d })} />}
            </li>;
          })}</ul>
        </div></div>
      </section>

      <section aria-labelledby="lookup-h" className="dk-lookup">
        <h2 id="lookup-h" className="dk-h2">Name lookup</h2>
        <p className="dd-meta" style={{ margin: 0, lineHeight: 1.5 }}>Searches Dueling Domain accounts by name, username, Discord or COSSY ID.</p>
        <form role="search" style={{ display: "flex", gap: 8, alignItems: "flex-end" }} onSubmit={e => { e.preventDefault(); void search.run(search.query.trim()); }}>
          <Field label="Account search" className="dd-field--grow"><Input type="search" value={search.query} onChange={e => search.setQuery(e.target.value)} autoComplete="off" /></Field>
          <Button type="submit" variant="violet">Search</Button>
          <Button onClick={() => { search.setQuery(""); void search.run(""); }}>Show All</Button>
        </form>
        <div className="dk-scroll"><AccountList accounts={search.results} state={search.state} error={search.error} query={search.query} enrolled={enrolledIds}
          canEnroll={canAdd && !closed && !lateBlocked} onPick={fillFromAccount} onEnroll={a => void enroll(a, "", true)} /></div>
      </section>
    </div>
    <ConfirmDialog open={confirmDrop} title={selected ? `${registration ? "Remove" : "Drop"} ${selected.name}?` : "Drop player?"}
      message={registration ? "No round has been paired yet, so this removes them from the player list." : "They stay in the standings as dropped. Re-enroll brings them back with loss byes for missed rounds."}
      confirmLabel={registration ? "Remove player" : "Drop player"} onConfirm={() => selected && void dropOrReenroll(selected)} onCancel={() => setConfirmDrop(false)} />
  </div>;
}

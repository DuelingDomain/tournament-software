"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Command, DeskView, EventState, StaffRole, Team } from "@dd-tournament/engine";
import { CommandError, applyCommand, isTemporaryMemberId, normalizeMemberId, padMemberId } from "@dd-tournament/engine";
import { Button, ConfirmDialog, Field, Input, Select } from "../ui";
import { findAccounts, saveMemberId, useAccountSearch, type Account } from "./accounts";
import { CheckIcon, DashIcon, RingIcon, WarnIcon } from "./icons";
import { byName, membersOf } from "./helpers";
import { AccountList } from "./players-panel";
import { PointsControl } from "./points-control";
import { can } from "./roles";
import type { SendFn } from "./use-desk";

const pad = (id: string | null) => (id ? (normalizeMemberId(id) ? padMemberId(id) : id) : "");
const SIZE_NAME = ["", "", "Tag Dueling", "Three-Player Team", "Four-Player Team", "Five-Player Team"];
/** One ordered member position: an enrolled person, or an account that Enroll adds first. */
type Slot = { playerId: string | null; account: Account | null };
const EMPTY: Slot = { playerId: null, account: null };
/** What the user typed in one member row: the same ID / First / Last boxes as single-player enroll. */
type Draft = { id: string; first: string; last: string };
const NO_DRAFT: Draft = { id: "", first: "", last: "" };
function splitName(name: string): [string, string] {
  const parts = name.trim().split(/\s+/);
  return parts.length < 2 ? [name, ""] : [parts.slice(0, -1).join(" "), parts.at(-1)!];
}

const nameOf = (d: Draft) => [d.first.trim(), d.last.trim()].filter(Boolean).join(" ");
const typedId = (d: Draft) => (d.id.trim() ? normalizeMemberId(d.id) : null);

/** The next temp ID that nothing in `held` uses; the new ID joins `held` so later rows never get the same one. */
function allocateTemp(held: Set<string>): string {
  let n = 9999000000;
  while (held.has(String(n))) n++;
  held.add(String(n));
  return String(n);
}

interface Props { code: string; desk: DeskView; role: StaffRole; send: SendFn; notify: (m: string, bad?: boolean) => void }

/** Team events: enroll form with ordered member positions, the team list, and the account lookup beside it. */
export function TeamsPanel({ code, desk, role, send, notify }: Props) {
  // Quick controls (check-in, points) retry once and tell the user when they still fail.
  const quick = async (input: Parameters<SendFn>[0]) => { const r = await send(input, { retry: true }); if (!r.ok) notify(r.message, true); };
  const { state } = desk;
  const size = state.settings.playerStructure;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slots, setSlots] = useState<Slot[]>(() => Array.from({ length: size }, () => EMPTY));
  const [drafts, setDrafts] = useState<Draft[]>(() => Array.from({ length: size }, () => NO_DRAFT));
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ bad: boolean; text: string } | null>(null);
  const [confirmDrop, setConfirmDrop] = useState(false);
  const search = useAccountSearch(code);
  const filterRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const lookupRow = useRef<number | null>(null);

  const selected = state.teams.find(t => t.id === selectedId) ?? null;
  const canAdd = can(role, "AddTeams"), canEdit = can(role, "UpdateTeam"), canDropTeam = can(role, "DropTeam"), canRemoveTeam = can(role, "RemoveTeam");
  const registration = state.phase === "registration";
  const closed = state.phase === "playoff" || state.phase === "complete";
  const lateBlocked = !registration && !state.settings.allowLateEntry;
  const peopleById = useMemo(() => new Map(state.players.map(p => [p.id, p] as const)), [state.players]);
  const enrolledIds = useMemo(() => new Set(state.players.flatMap(p => (p.userId === null ? [] : [p.userId]))), [state.players]);
  const onTeam = useMemo(() => new Set(state.teams.filter(t => t.id !== selectedId).flatMap(t => t.memberIds)), [state.teams, selectedId]);
  const taken = (s: Slot) => s.playerId ?? (s.account ? `a${s.account.userId}` : null);
  const used = new Set(slots.map(taken).filter((v): v is string => v !== null));
  const free = useMemo(() => state.players.filter(p => p.status === "active" && !onTeam.has(p.id)).sort(byName), [state.players, onTeam]);

  useEffect(() => { const on = () => { filterRef.current?.focus(); filterRef.current?.select(); }; window.addEventListener("dk:focus-find", on); return () => window.removeEventListener("dk:focus-find", on); }, []);

  const blank = useCallback(() => Array.from({ length: size }, () => EMPTY), [size]);
  const clear = useCallback(() => { setSelectedId(null); setName(""); setSlots(blank()); setDrafts(Array.from({ length: size }, () => NO_DRAFT)); setMessage(null); lookupRow.current = null; search.setQuery(""); search.clear(); }, [blank, size, search]);
  const pick = (t: Team) => {
    setSelectedId(t.id); setName(t.name); setMessage(null);
    setSlots(Array.from({ length: size }, (_, i) => (t.memberIds[i] ? { playerId: t.memberIds[i]!, account: null } : EMPTY)));
    setDrafts(Array.from({ length: size }, (_, i) => { const p = t.memberIds[i] ? peopleById.get(t.memberIds[i]!) : undefined; return p ? draftOf(p.name, p.memberId) : NO_DRAFT; }));
  };
  const draftOf = (displayName: string, memberId: string | null): Draft => { const [first, last] = splitName(displayName); return { id: pad(memberId), first, last }; };
  const setDraft = (i: number, patch: Partial<Draft>) => setDrafts(list => list.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  const setSlot = (i: number, slot: Slot, draft?: Draft) => {
    setSlots(list => list.map((s, k) => (k === i ? slot : s)));
    if (draft) setDrafts(list => list.map((d, k) => (k === i ? draft : d)));
    else if (slot === EMPTY) setDrafts(list => list.map((d, k) => (k === i ? NO_DRAFT : d)));
  };
  /** A looked-up account fills position `index` (else the first free one); an account that is already enrolled uses its person entry. */
  const fromAccount = (a: Account, index?: number) => {
    const person = state.players.find(p => p.userId === a.userId);
    if (person && onTeam.has(person.id)) { setMessage({ bad: true, text: `${a.displayName} is already on a team.` }); return; }
    const key = person ? person.id : `a${a.userId}`;
    if (used.has(key) && !(index !== undefined && taken(slots[index]!) === key)) { setMessage({ bad: true, text: `${a.displayName} is already in this team.` }); return; }
    const at = index ?? slots.findIndex(s => taken(s) === null);
    if (at < 0) { setMessage({ bad: true, text: "Every member position is full. Clear one first." }); return; }
    const memberId = person?.memberId ?? a.memberId;
    const draft = draftOf(a.displayName, memberId);
    // An ID typed on the row stays when the account has none yet; Enroll saves it to the account.
    if (!memberId && drafts[at]?.id.trim()) draft.id = drafts[at]!.id;
    setSlot(at, person ? { playerId: person.id, account: null } : { playerId: null, account: a }, draft); setMessage(null);
  };
  /** A click in Name lookup fills the row whose Enter started the search (if still free), else the first free row. */
  const fromLookup = (a: Account) => {
    const row = lookupRow.current;
    lookupRow.current = null;
    fromAccount(a, row !== null && taken(slots[row]!) === null ? row : undefined);
  };
  /** Enter in a member row: look the typed COSSY ID or name up. One match fills the row; several go to Name lookup; none keeps the typed entry. */
  async function lookup(i: number) {
    const d = drafts[i]!;
    const id = typedId(d);
    if (d.id.trim() && id === null) { setMessage({ bad: true, text: `Member ${i + 1}: a COSSY ID is one to ten digits.` }); return; }
    if (id && isTemporaryMemberId(id)) {
      setMessage(nameOf(d)
        ? { bad: false, text: `Member ${i + 1} has no account yet. ${nameOf(d)} enrolls with temp ID ${pad(id)}.` }
        : { bad: true, text: `Member ${i + 1} has temp ID ${pad(id)}. Type a name for the entry.` });
      return;
    }
    const q = id ?? nameOf(d);
    if (!q) { setMessage({ bad: true, text: `Type a COSSY ID or a name for member ${i + 1}, then press Enter.` }); return; }
    const found = await findAccounts(code, q);
    if (!found.ok) { setMessage({ bad: true, text: found.message }); return; }
    const exact = id ? found.users.filter(a => a.memberId && normalizeMemberId(a.memberId) === id) : [];
    const pool = exact.length ? exact : found.users;
    if (pool.length === 1) { fromAccount(pool[0]!, i); return; }
    if (pool.length === 0) {
      setMessage(nameOf(d)
        ? { bad: false, text: `No account matches "${q}". Member ${i + 1} has no account yet and enrolls as ${nameOf(d)}${id ? ` with ID ${pad(id)}` : ""}.` }
        : { bad: true, text: `No account has COSSY ID ${pad(id)}. Type a name to enroll this member with no account.` });
      return;
    }
    lookupRow.current = i;
    search.setQuery(q); setMessage({ bad: false, text: `${pool.length} accounts match "${q}". Click one in Name lookup to fill member ${i + 1}.` });
  }

  const rowReady = (i: number) => taken(slots[i]!) !== null || nameOf(drafts[i]!) !== "";
  const filled = slots.every((_, i) => rowReady(i));
  const enrollDisabled = busy || closed || lateBlocked || !name.trim() || !filled || (selected ? !canEdit : !canAdd);

  /**
   * One run of the enroll steps. `apply` runs a command and returns the state after it, so the same steps can run first
   * on a copy of the desk state (nothing is written if a step is refused) and then for real.
   */
  async function steps(apply: (c: Command) => Promise<{ ok: true; state: EventState; before: EventState } | { ok: false; message: string; code?: string }>, real: boolean) {
    const ids = drafts.map(typedId);
    const held = new Set<string>([...state.players.map(p => p.memberId), ...ids].filter((v): v is string => v !== null));
    const canTemp = !state.settings.requireMemberId && can(role, "UpdatePlayer");
    const picks = slots.map((s, i) => {
      const person = s.playerId ? peopleById.get(s.playerId) : undefined;
      const known = person ? person.memberId : s.account ? s.account.memberId : null;
      return { slot: s, i, person, typed: ids[i] ?? null, known: known ? normalizeMemberId(known) : null };
    });
    // Every row that still has no COSSY ID gets one temp ID from the shared set, before any command runs.
    const give = new Map<number, string>();
    for (const r of picks) {
      if (r.known) continue;
      if (r.typed) give.set(r.i, r.typed);
      else if (canTemp) give.set(r.i, allocateTemp(held));
    }
    const entries = picks.flatMap((r): { r: (typeof picks)[number]; entry: { userId: number | null; name: string; memberId?: string } }[] => {
      if (r.slot.playerId !== null) return [];
      const memberId = r.known ?? give.get(r.i);
      const withId = memberId ? { memberId } : {};
      if (r.slot.account) return [{ r, entry: { userId: r.slot.account.userId, name: r.slot.account.displayName, ...withId } }];
      return [{ r, entry: { userId: null, name: nameOf(drafts[r.i]!), ...withId } }];
    });
    const added: string[] = [];
    let latest: EventState = state;
    const fail = async (message: string, code?: string) => {
      // A refused step after players were added: take the new entries back out so nothing half-done stays.
      if (real && added.length && state.phase === "registration") for (const id of added) await apply({ type: "RemovePlayer", playerId: id });
      return { ok: false as const, message, code };
    };
    const ownerOf = new Map<number, string>(); // row -> player id
    for (const r of picks) if (r.slot.playerId) ownerOf.set(r.i, r.slot.playerId);
    if (real) {
      // A COSSY ID typed for a person whose account has none is saved to the account first, like single-player enroll.
      for (const r of picks) {
        const userId = r.slot.account?.userId ?? r.person?.userId ?? null;
        if (userId !== null && !r.known && r.typed && !isTemporaryMemberId(r.typed)) {
          const saved = await saveMemberId(code, userId, r.typed);
          if (!saved.ok) return fail(saved.message);
        }
      }
    }
    if (entries.length) {
      const r = await apply({ type: "AddPlayers", players: entries.map(e => e.entry) });
      if (!r.ok) return fail(r.code === "member_id_required" ? "This tournament requires a COSSY ID for every member. Type one in the row, or add it to the account first." : r.message, r.code);
      const made = r.state.players.slice(r.before.players.length);
      entries.forEach((e, k) => { if (made[k]) { ownerOf.set(e.r.i, made[k]!.id); added.push(made[k]!.id); } });
      latest = r.state;
    }
    // IDs for people who already have none (including accounts whose ID the server filled in later).
    for (const r of picks) {
      const id = ownerOf.get(r.i);
      const want = give.get(r.i);
      if (!id || !want) continue;
      const person = latest.players.find(p => p.id === id);
      if (!person || person.memberId !== null) continue;
      const u = await apply({ type: "UpdatePlayer", playerId: id, memberId: want });
      if (!u.ok) return fail(u.message, u.code);
      latest = u.state;
    }
    const memberIds = picks.map(r => ownerOf.get(r.i)).filter((v): v is string => !!v);
    const team: Command = selected ? { type: "UpdateTeam", teamId: selected.id, name: name.trim(), memberIds } : { type: "AddTeams", teams: [{ name: name.trim(), memberIds }] };
    const t = await apply(team);
    if (!t.ok) return fail(t.message, t.code);
    return { ok: true as const };
  }

  async function enroll() {
    setBusy(true); setMessage(null);
    const bad = drafts.findIndex(d => d.id.trim() && typedId(d) === null);
    if (bad >= 0) { setBusy(false); setMessage({ bad: true, text: `Member ${bad + 1}: a COSSY ID is one to ten digits.` }); return; }
    const typed = drafts.flatMap((d, i) => { const id = typedId(d); return id ? [{ i, id }] : []; });
    const twin = typed.find((a, k) => typed.some((b, j) => j !== k && b.id === a.id));
    if (twin) { setBusy(false); setMessage({ bad: true, text: `Two members have the same COSSY ID ${pad(twin.id)}. Change one.` }); return; }
    // Dry run on a copy of the desk state: a refused step stops here and nothing is written.
    let copy: EventState = structuredClone(state);
    const dry = await steps(async c => {
      try { const before = copy; copy = applyCommand(copy, c, { now: new Date().toISOString(), seed: 1, actor: "dry-run" }); return { ok: true, state: copy, before }; }
      catch (error) { if (error instanceof CommandError) return { ok: false, message: error.message, code: error.code }; throw error; }
    }, false).catch(() => null);
    if (dry && !dry.ok) { setBusy(false); setMessage({ bad: true, text: dry.message }); return; }
    const done = await steps(async c => { const r = await send(c); return r.ok ? { ok: true, state: r.desk.state, before: r.before.state } : { ok: false, message: r.message, code: r.code }; }, true);
    setBusy(false);
    if (!done.ok) { setMessage({ bad: true, text: done.message }); return; }
    setMessage({ bad: false, text: `${name.trim()} ${selected ? "updated" : "enrolled"}.` });
    notify(`${name.trim()} ${selected ? "updated" : "enrolled"}`);
    clear(); nameRef.current?.focus();
  }

  /** Temp ID on one row: the next temp ID that no enrolled person or other row holds. */
  function tempFor(i: number) {
    const held = new Set<string>([...state.players.map(p => p.memberId), ...drafts.map(typedId)].filter((v): v is string => v !== null));
    const id = pad(allocateTemp(held));
    setDraft(i, { id }); setMessage({ bad: false, text: `Member ${i + 1} gets temp ID ${id} when you press ${selected ? "Update" : "Enroll"}.` });
  }

  async function dropOrReenroll(team: Team) {
    setConfirmDrop(false);
    const result = team.status === "dropped" ? await send({ type: "ReEnrollTeam", teamId: team.id })
      : await send(registration ? { type: "RemoveTeam", teamId: team.id } : { type: "DropTeam", teamId: team.id });
    setMessage(result.ok ? { bad: false, text: team.status === "dropped" ? `${team.name} re-enrolled.` : registration ? `${team.name} removed.` : `${team.name} dropped.` } : { bad: true, text: result.message });
    if (result.ok && registration) clear();
  }

  async function toggleCheckIn(team: Team, to: boolean) {
    for (const m of membersOf(state, team)) { if (m.checkedIn !== to) { const r = await send({ type: "SetCheckedIn", playerId: m.id, checkedIn: to }, { retry: true }); if (!r.ok) { notify(r.message, true); return; } } }
  }

  const stats = useMemo(() => ({
    total: state.teams.length, active: state.teams.filter(t => t.status === "active").length,
    dropped: state.teams.filter(t => t.status === "dropped").length, cut: state.teams.filter(t => t.status === "cut").length,
  }), [state.teams]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = [...state.teams].sort(byName);
    if (!q) return list;
    return list.filter(t => t.name.toLowerCase().includes(q) || membersOf(state, t).some(m => m.name.toLowerCase().includes(q) || (m.memberId && pad(m.memberId).includes(q.replace(/\D/g, "") || "\u0000"))));
  }, [state, filter]);
  const dropLabel = selected?.status === "dropped" ? "Re-enroll" : "Drop";
  const canDrop = registration ? canRemoveTeam : canDropTeam;
  const dropDisabled = busy || !selected || !canDrop || selected.status === "cut" || state.phase === "complete";
  const label = SIZE_NAME[size] ?? "Team";
  const open = state.settings.format === "open_dueling" || state.settings.style === "open_dueling";

  return <div className="dk-pane dk-pane--teams">
    <form className="dk-slip dk-team-form" aria-label="Enroll a team" onSubmit={e => { e.preventDefault(); if (!enrollDisabled) void enroll(); }}>
      <div className="dk-team-top">
        <Field label="Team name" className="dk-team-name"><Input ref={nameRef} autoComplete="off" maxLength={80} value={name} onChange={e => { setName(e.target.value); setMessage(null); }} /></Field>
        <div className="dk-btn-row">
          <Button type="submit" variant="violet" disabled={enrollDisabled} keyHint="Enter">{selected ? "Update" : "Enroll"}</Button>
          <Button onClick={clear}>Clear</Button>
          <Button variant="rose-outline" disabled={dropDisabled} onClick={() => selected && (selected.status === "dropped" ? void dropOrReenroll(selected) : setConfirmDrop(true))}
            aria-label={selected ? `${dropLabel} ${selected.name}` : "Drop (select a team first)"}>{dropLabel}</Button>
        </div>
      </div>
      <div className="dk-team-slots">
        <div className="dk-team-head dd-caps" aria-hidden="true"><span>#</span><span>COSSY ID</span><span>First &amp; middle</span><span>Last</span><span>Or choose</span><span /><span /></div>
        {slots.map((s, i) => {
          const key = s.playerId ?? (s.account ? `a${s.account.userId}` : "");
          const mine = s.playerId ? peopleById.get(s.playerId) : undefined;
          const d = drafts[i] ?? NO_DRAFT;
          const onEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); void lookup(i); } };
          const filledRow = taken(s) !== null;
          const hasId = filledRow && (s.playerId ? mine?.memberId : s.account?.memberId) != null;
          const empty = !filledRow && !d.id && !d.first && !d.last;
          const canTemp = !hasId && (filledRow || nameOf(d) !== "") && !d.id.trim();
          return <fieldset key={i} className="dk-team-member">
            <legend className="dk-vh">Member {i + 1}</legend>
            <span className="dk-team-no dd-caps" aria-hidden="true">{i + 1}</span>
            <Input mono aria-label={`Member ${i + 1} COSSY ID`} inputMode="numeric" autoComplete="off" value={d.id} readOnly={hasId} onKeyDown={onEnter} onChange={e => setDraft(i, { id: e.target.value })} />
            <Input aria-label={`Member ${i + 1} first name`} autoComplete="off" value={d.first} readOnly={filledRow} onKeyDown={onEnter} onChange={e => setDraft(i, { first: e.target.value })} />
            <Input aria-label={`Member ${i + 1} last name`} autoComplete="off" value={d.last} readOnly={filledRow} onKeyDown={onEnter} onChange={e => setDraft(i, { last: e.target.value })} />
            <Select value={key} onChange={e => {
              const v = e.target.value;
              if (!v) setSlot(i, EMPTY);
              else if (v.startsWith("a")) setSlot(i, s.account ? s : EMPTY);
              else { const p = peopleById.get(v); setSlot(i, { playerId: v, account: null }, p ? draftOf(p.name, p.memberId) : undefined); }
            }} aria-label={`Member ${i + 1}`}>
              <option value="">Choose a member</option>
              {s.account && <option value={key}>{s.account.displayName} (new)</option>}
              {mine && !free.some(p => p.id === mine.id) && <option value={mine.id}>{mine.name}</option>}
              {free.filter(p => !used.has(p.id) || p.id === s.playerId).map(p => <option key={p.id} value={p.id}>{p.name}{p.memberId ? ` · ${pad(p.memberId)}` : ""}</option>)}
            </Select>
            <Button size="sm" className="dk-team-temp" aria-label={`Temp ID for member ${i + 1}`} disabled={busy || !canTemp || (selected ? !canEdit : !canAdd)} onClick={() => tempFor(i)}>Temp ID</Button>
            <Button size="sm" className="dk-team-x" aria-label={`Clear member ${i + 1}`} disabled={empty} onClick={() => setSlot(i, EMPTY)}><span aria-hidden="true">&times;</span></Button>
          </fieldset>;
        })}
      </div>
      <p id="team-note" className={`dk-note${message?.bad ? " dk-note--bad" : ""}`} role="status">
        {message && <span>{message.text}</span>}
        {!message && !selected && <span>{label}: name the team, then fill {size} members in playing order. Press Enter in a row to look up an account, or click one in Name lookup. No account yet? Type a name and use Temp ID.</span>}
        {!message && selected && <span>{selected.name} selected. Change the name or members and press Update.</span>}
        {lateBlocked && <span>Late entry is off for this tournament. Turn it on in Update Settings.</span>}
        {selected && registration && <span>Dropping before round 1 removes the team. Its members stay enrolled.</span>}
      </p>
    </form>

    <div className="dk-split dk-split--teams">
      <section aria-labelledby="teams-h" className="dk-split-main">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <h2 id="teams-h" className="dk-h2">Enrolled Teams:</h2>
          <span className="dd-meta">{stats.total} enrolled · {stats.active} active{stats.dropped ? ` · ${stats.dropped} dropped` : ""}{stats.cut ? ` · ${stats.cut} cut` : ""}</span>
        </div>
        <Field label={<>Filter teams <span className="dk-mono" style={{ textTransform: "none" }}>Ctrl+F</span></>}>
          <Input ref={filterRef} type="search" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Team, member or COSSY ID" autoComplete="off" />
        </Field>
        <div className="dd-scroll-x dk-scroll"><div className="dk-table" style={{ "--w": open ? "700px" : "560px" } as React.CSSProperties}>
          <div aria-hidden="true" className="dk-th dd-caps" data-pts={open}><span>Team and members</span><span>Status</span>{open && <span>Points</span>}</div>
          {shown.length === 0 && <p className="dk-empty">{state.teams.length ? "No team matches that filter." : "No teams yet. Pick members and press Enroll."}</p>}
          <ul className="dk-plist">{shown.map(t => {
            const members = membersOf(state, t);
            const warnMember = members.find(m => desk.integrity.memberIdWarnings.some(w => w.playerId === m.id));
            const allIn = members.length > 0 && members.every(m => m.checkedIn);
            return <li key={t.id} className="dk-trow" data-selected={t.id === selectedId} data-pts={open}>
              <button type="button" className="dk-trow-main" aria-pressed={t.id === selectedId} onClick={() => pick(t)}>
                <span className="dk-team-title">{t.name}</span>
                <span className="dk-team-members">{members.map((m, i) => <span key={m.id}>{i + 1}. {m.name}{m.memberId ? <> <span className="dk-mono">{pad(m.memberId)}</span>{isTemporaryMemberId(m.memberId) && <span className="dk-tempid">TEMP ID</span>}</> : null}</span>)}</span>
                {warnMember && <span className="dk-idwarn"><WarnIcon size={13} />{warnMember.name}: check the COSSY ID.</span>}
              </button>
              {t.status === "active"
                ? <button type="button" className="dk-status" data-state={allIn ? "in" : "idle"} role="switch" aria-checked={allIn} disabled={!can(role, "SetCheckedIn") || state.phase === "complete"} aria-label={`${t.name}: ${allIn ? "all members checked in" : "not checked in"}`}
                  onClick={() => void toggleCheckIn(t, !allIn)}>{allIn ? <CheckIcon size={12} /> : <RingIcon />}{allIn ? "Checked in" : "Not checked in"}</button>
                : <span className="dk-status" data-state="out"><DashIcon />{t.status === "cut" ? "Cut" : `Dropped R${t.droppedAfterRound ?? 0}`}</span>}
              {open && <PointsControl name={t.name} points={t.openDuelingPoints ?? 0} disabled={!can(role, "AdjustPoints") || state.phase === "complete"} onAdjust={d => void quick({ type: "AdjustPoints", playerId: t.id, delta: d })} />}
            </li>;
          })}</ul>
        </div></div>
      </section>

      <section aria-labelledby="lookup-h" className="dk-lookup">
        <h2 id="lookup-h" className="dk-h2">Name lookup</h2>
        <p className="dd-meta" style={{ margin: 0, lineHeight: 1.5 }}>Searches Dueling Domain accounts by name, username, Discord or COSSY ID. Click one to place them on the team.</p>
        <form role="search" style={{ display: "flex", gap: 8, alignItems: "flex-end" }} onSubmit={e => { e.preventDefault(); lookupRow.current = null; void search.run(search.query.trim()); }}>
          <Field label="Account search" className="dd-field--grow"><Input type="search" value={search.query} onChange={e => search.setQuery(e.target.value)} autoComplete="off" /></Field>
          <Button type="submit" variant="violet">Search</Button>
          <Button onClick={() => { lookupRow.current = null; search.setQuery(""); void search.run(""); }}>Show All</Button>
        </form>
        <div className="dk-scroll">
          <AccountList accounts={search.results} state={search.state} error={search.error} query={search.query} enrolled={new Set()}
            canEnroll={false} onPick={fromLookup} onEnroll={() => undefined}>
            {a => enrolledIds.has(a.userId) ? <span className="dd-chip dd-chip--muted">Enrolled</span> : null}
          </AccountList>
        </div>
      </section>
    </div>
    <ConfirmDialog open={confirmDrop} title={selected ? `${registration ? "Remove" : "Drop"} ${selected.name}?` : "Drop team?"}
      message={registration ? "No round has been paired yet, so this removes the team from the list. Its members stay enrolled." : "The team stays in the standings as dropped. Re-enroll brings it back with loss byes for missed rounds."}
      confirmLabel={registration ? "Remove team" : "Drop team"} onConfirm={() => selected && void dropOrReenroll(selected)} onCancel={() => setConfirmDrop(false)} />
  </div>;
}

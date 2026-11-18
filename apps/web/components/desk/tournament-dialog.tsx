"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { DeskView, EventSettings, Location, Penalty, StaffAssignment, StaffPosition, StaffRole } from "@dd-tournament/engine";
import { Button, Checkbox, Dialog, Field, Input, Select } from "../ui";
import "./desk.css";
import { useAccountSearch, type Account } from "./accounts";
import { PENALTY_LABEL } from "./helpers";
import { can } from "./roles";
import { CUTS, DEFAULT_SETTINGS, PAIRINGS, POSITIONS, POSITION_LABEL, POSITION_OF_ROLE, STRUCTURES, STYLES } from "./tournament-options";
import type { SendFn } from "./use-desk";

type Fields = Omit<Location, "id">;
const BLANK_LOCATION: Fields = { name: "", address1: "", address2: "", city: "", state: "", postal: "", country: "", phone: "", website: "" };
const LOCATION_ERRORS: Record<string, string> = { location_in_use: "A tournament uses this location. Change that tournament first.", invalid_body: "Enter a location name.", not_found: "That location no longer exists.", unauthorized: "Sign in again to continue." };
const CREATE_ERRORS: Record<string, string> = { invalid_create_code: "That create code is not right.", invalid_body: "Check the tournament name and the other fields, then try again.", unauthorized: "Sign in again to continue.", location_not_found: "Pick the location again.", forbidden_role: "Only the creator can be the organizer. Change that staff entry.", account_not_found: "One of the staff accounts no longer exists. Remove it and try again." };

export interface StaffRow { userId: number; name: string; position: StaffPosition; locked?: boolean }
const splitIso = (iso: string | null): [string, string] => {
  if (!iso) return ["", ""];
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return ["", ""];
  const p = (n: number) => String(n).padStart(2, "0");
  return [`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, `${p(d.getHours())}:${p(d.getMinutes())}`];
};
const joinIso = (date: string, time: string): string | null => {
  if (!date) return null;
  const d = new Date(`${date}T${time || "00:00"}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const toAssignments = (rows: StaffRow[]): StaffAssignment[] => rows.filter(r => !r.locked).map(r => ({ userId: r.userId, name: r.name, position: r.position }));

interface CreateProps { mode: "create"; creator: { userId: number; name: string }; createCodeRequired: boolean; onCreated: (code: string, teamEvent: boolean) => void; onClose: () => void }
interface UpdateProps { mode: "update"; desk: DeskView; role: StaffRole; send: SendFn; onDone: (text: string) => void; onClose: () => void; extra?: React.ReactNode }

/** The original's settings dialog. One component for File, New Tournament and Tournament, Update Settings. */
export function TournamentDialog(props: CreateProps | UpdateProps) {
  const update = props.mode === "update";
  const settings = update ? props.desk.state.settings : null;
  const role = update ? props.role : "organizer";
  const finished = update && props.desk.state.phase === "complete";
  const editable = update ? can(role, "UpdateSettings") && !finished : true;
  const canStaff = update ? can(role, "AddStaff") && !finished : true;
  const enrolled = update ? props.desk.state.playerStructureLocked === true || props.desk.state.players.length > 0 || props.desk.state.teams.length > 0 : false;

  const [name, setName] = useState(settings?.name ?? "");
  const initial = splitIso(settings?.startsAt ?? null);
  const [date, setDate] = useState(initial[0]);
  const [time, setTime] = useState(initial[1]);
  const [locationId, setLocationId] = useState<string | null>(settings?.locationId ?? null);
  const [style, setStyle] = useState(settings?.style ?? DEFAULT_SETTINGS.style);
  const [format, setFormat] = useState(settings?.format ?? DEFAULT_SETTINGS.format);
  const [structure, setStructure] = useState(settings?.playerStructure ?? DEFAULT_SETTINGS.playerStructure);
  const [extra, setExtra] = useState<Pick<EventSettings, "plannedRounds" | "topCut" | "tiebreak" | "startingTable" | "roundMinutes" | "publicNames" | "registrationOpen" | "requireMemberId" | "allowLateEntry"> & { infractions: EventSettings["infractions"] }>({
    plannedRounds: settings?.plannedRounds ?? DEFAULT_SETTINGS.plannedRounds, topCut: settings?.topCut ?? DEFAULT_SETTINGS.topCut, tiebreak: settings?.tiebreak ?? DEFAULT_SETTINGS.tiebreak,
    startingTable: settings?.startingTable ?? DEFAULT_SETTINGS.startingTable, roundMinutes: settings?.roundMinutes ?? DEFAULT_SETTINGS.roundMinutes, publicNames: settings?.publicNames ?? DEFAULT_SETTINGS.publicNames,
    registrationOpen: settings?.registrationOpen ?? DEFAULT_SETTINGS.registrationOpen, requireMemberId: settings?.requireMemberId ?? DEFAULT_SETTINGS.requireMemberId,
    allowLateEntry: settings?.allowLateEntry ?? DEFAULT_SETTINGS.allowLateEntry, infractions: settings?.infractions ?? [],
  });
  const setX = <K extends keyof typeof extra>(k: K, v: (typeof extra)[K]) => setExtra(d => ({ ...d, [k]: v }));
  // The owner's row is locked: the server always keeps the owner as organizer. In create mode that owner is the signed-in creator.
  const creatorId = props.mode === "create" ? props.creator.userId : null;
  const startStaff: StaffRow[] = useMemo(() => update ? props.desk.state.staff.map(s => ({ userId: s.userId, name: s.name, position: s.position ?? POSITION_OF_ROLE[s.role], locked: s.userId === props.desk.ownerUserId || (props.desk.ownerUserId === undefined && s.role === "organizer") }))
    : [{ userId: props.creator.userId, name: props.creator.name, position: "organizer" as StaffPosition, locked: true }], []); // eslint-disable-line react-hooks/exhaustive-deps
  const playerIds = useMemo(() => new Set(update ? props.desk.state.players.flatMap(p => p.userId === null ? [] : [p.userId]) : []), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [locationEdited, setLocationEdited] = useState(false);
  const [staff, setStaff] = useState<StaffRow[]>(startStaff);
  const [createCode, setCreateCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ bad: boolean; text: string } | null>(null);

  const staffChanged = JSON.stringify(toAssignments(staff)) !== JSON.stringify(toAssignments(startStaff));
  const set = <K extends keyof EventSettings>(out: Partial<EventSettings>, k: K, v: EventSettings[K], was: EventSettings[K] | undefined) => { if (!update || v !== was) out[k] = v; };

  function collect(): Partial<EventSettings> {
    const out: Partial<EventSettings> = {};
    const was = settings ?? undefined;
    set(out, "name", name.trim(), was?.name);
    const startsAt = joinIso(date, time);
    set(out, "startsAt", startsAt, was?.startsAt ?? null);
    if (locationEdited) out.locationId = locationId; else set(out, "locationId", locationId, was?.locationId ?? null);
    set(out, "style", style, was?.style);
    set(out, "format", format, was?.format);
    if (!enrolled) set(out, "playerStructure", structure, was?.playerStructure);
    set(out, "plannedRounds", extra.plannedRounds, was?.plannedRounds);
    set(out, "topCut", extra.topCut, was?.topCut);
    set(out, "tiebreak", extra.tiebreak, was?.tiebreak);
    set(out, "startingTable", extra.startingTable, was?.startingTable);
    set(out, "roundMinutes", extra.roundMinutes, was?.roundMinutes);
    set(out, "publicNames", extra.publicNames, was?.publicNames);
    set(out, "registrationOpen", extra.registrationOpen, was?.registrationOpen);
    set(out, "requireMemberId", extra.requireMemberId, was?.requireMemberId);
    set(out, "allowLateEntry", extra.allowLateEntry, was?.allowLateEntry);
    if (!update || JSON.stringify(extra.infractions) !== JSON.stringify(was?.infractions)) out.infractions = extra.infractions;
    return out;
  }

  async function submit() {
    if (!name.trim()) { setMessage({ bad: true, text: "Enter a tournament name." }); return; }
    setBusy(true); setMessage(null);
    if (props.mode === "update") {
      const res = await props.send({ type: "UpdateSettings", settings: collect(), ...(canStaff && staffChanged ? { staff: toAssignments(staff) } : {}) });
      setBusy(false);
      if (!res.ok) { setMessage({ bad: true, text: res.message }); return; }
      props.onDone("Tournament settings updated.");
      props.onClose();
      return;
    }
    try {
      const response = await fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), createCode, settings: collect(), staff: toAssignments(staff) }) });
      const data = (await response.json().catch(() => ({}))) as { code?: string; error?: string };
      if (!response.ok || !data.code) { setMessage({ bad: true, text: CREATE_ERRORS[data.error ?? ""] ?? "Could not create the tournament." }); setBusy(false); return; }
      props.onCreated(data.code, structure > 1);
    } catch { setMessage({ bad: true, text: "Could not reach the server." }); setBusy(false); }
  }

  const formId = "tournament-form";
  const label = update ? "Update" : "Create";
  const title = update ? "Update Tournament Settings" : "New Tournament";
  return <Dialog open onClose={props.onClose} title={title} actions={<>
    <Button onClick={props.onClose}>Cancel</Button>
    <Button type="submit" form={formId} variant="violet" disabled={busy || !editable}>{busy ? (update ? "Updating..." : "Creating...") : label}</Button>
  </>}>
    <span className="dk-dlg-wide" hidden />
    <form id={formId} className="dk-tdlg" onSubmit={e => { e.preventDefault(); if (!busy && editable) void submit(); }}>
      <fieldset disabled={!editable} className="dk-tdlg-set">
        <Field label="Name"><Input value={name} onChange={e => setName(e.target.value)} maxLength={200} required autoComplete="off" autoFocus placeholder="Weekly Duel Night #12" /></Field>
        <div className="dk-tdlg-row">
          <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
          <Field label="Time"><Input type="time" value={time} onChange={e => setTime(e.target.value)} /></Field>
        </div>
        <LocationPicker value={locationId} onChange={setLocationId} onEdited={() => setLocationEdited(true)} disabled={!editable} code={update ? props.desk.links.desk.split("/")[2] ?? null : null} />
        <StaffEditor rows={staff} setRows={setStaff} disabled={!canStaff} viewerRole={role} code={update ? props.desk.links.desk.split("/")[2] ?? null : null} playerIds={playerIds} creatorId={creatorId} />
        <div className="dk-tdlg-row dk-tdlg-row--3">
          <Field label="Format / Style"><Select value={style} onChange={e => setStyle(e.target.value as typeof style)}>{STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</Select></Field>
          <Field label="Pairing structure"><Select value={format} onChange={e => setFormat(e.target.value as typeof format)}>{PAIRINGS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</Select></Field>
          <Field label="Player structure" hint={enrolled ? "Locked once anyone is enrolled." : undefined}>
            <Select value={structure} disabled={enrolled} onChange={e => setStructure(Number(e.target.value) as typeof structure)}>{STRUCTURES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</Select></Field>
        </div>
        {!update && props.createCodeRequired && <Field label="Create code" hint="Your community asked for a code."><Input type="password" value={createCode} onChange={e => setCreateCode(e.target.value)} autoComplete="off" required /></Field>}

        <details className="dk-tdlg-more">
          <summary className="dk-sum">More settings: rounds, timer, cut and entry</summary>
          <div className="dk-form-grid" style={{ marginTop: 10 }}>
            <Field label="Planned rounds" hint={update ? `Suggested for this event: ${props.desk.suggestedRounds}` : undefined}>
              <Input type="number" min={1} max={100} value={extra.plannedRounds ?? ""} placeholder="Decide as you go" onChange={e => setX("plannedRounds", e.target.value === "" ? null : Number(e.target.value))} /></Field>
            <Field label="Round minutes"><Input type="number" min={1} max={1440} value={extra.roundMinutes} onChange={e => setX("roundMinutes", Number(e.target.value) || 50)} /></Field>
            <Field label="Cut to top"><Select value={extra.topCut} onChange={e => setX("topCut", Number(e.target.value) as EventSettings["topCut"])}>{CUTS.map(n => <option key={n} value={n}>{n === 0 ? "No cut" : `Top ${n}`}</option>)}</Select></Field>
            <Field label="Tiebreak"><Select value={extra.tiebreak} onChange={e => setX("tiebreak", e.target.value as EventSettings["tiebreak"])}>
              <option value="floor33">Opponent win % floored at 33.3%</option><option value="legacy">Legacy opponent win %</option></Select></Field>
            <Field label="Starting table"><Input type="number" min={1} value={extra.startingTable} onChange={e => setX("startingTable", Math.max(1, Number(e.target.value) || 1))} /></Field>
            <Field label="Names on the public page"><Select value={extra.publicNames} onChange={e => setX("publicNames", e.target.value as EventSettings["publicNames"])}>
              <option value="full">Full names</option><option value="initials">Initials</option></Select></Field>
          </div>
          <div className="dk-tdlg-checks">
            <Checkbox label="Players can join themselves" checked={extra.registrationOpen} onChange={e => setX("registrationOpen", e.target.checked)} />
            <Checkbox label="Require a COSSY ID to enter" checked={extra.requireMemberId} onChange={e => setX("requireMemberId", e.target.checked)} />
            <Checkbox label="Allow late entry after round 1" checked={extra.allowLateEntry} onChange={e => setX("allowLateEntry", e.target.checked)} />
          </div>
          <Infractions list={extra.infractions} onChange={v => setX("infractions", v)} />
        </details>
      </fieldset>
      {!editable && <p className="dd-meta" style={{ margin: 0 }}>{finished ? "This tournament is finished. Reopen it from the Tournament menu to change settings." : "Your role can read settings but not change them."}</p>}
      <p role={message?.bad ? "alert" : "status"} className={message?.bad ? "dd-error" : "dd-meta"} style={{ margin: 0 }}>{message?.text}</p>
    </form>
    {update && props.extra}
  </Dialog>;
}

function Infractions({ list, onChange }: { list: EventSettings["infractions"]; onChange: (v: EventSettings["infractions"]) => void }) {
  return <details style={{ marginTop: 8 }}>
    <summary className="dk-sum">Infraction list ({list.length})</summary>
    <div className="dk-sec" style={{ gap: 6, marginTop: 8 }}>
      {list.map((inf, i) => <div key={inf.id} className="dk-dlg-row" style={{ alignItems: "center" }}>
        <Input aria-label={`Infraction ${i + 1} label`} value={inf.label} onChange={e => onChange(list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} style={{ flex: "2 1 220px", width: "auto" }} />
        <Select aria-label={`Default penalty for ${inf.label}`} value={inf.defaultPenalty} onChange={e => onChange(list.map((x, j) => (j === i ? { ...x, defaultPenalty: e.target.value as Penalty } : x)))} style={{ flex: "1 1 160px", width: "auto" }}>
          {(Object.keys(PENALTY_LABEL) as Penalty[]).map(p => <option key={p} value={p}>{PENALTY_LABEL[p]}</option>)}</Select>
        <Button size="sm" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={`Remove ${inf.label}`}>Remove</Button>
      </div>)}
      <div><Button size="sm" onClick={() => onChange([...list, { id: `custom_${Date.now().toString(36)}`, label: "New infraction", defaultPenalty: "warning" }])}>Add infraction</Button></div>
    </div>
  </details>;
}

/** Saved locations: pick one, or New / Edit / Delete like the original's list. The editor is its own small window, as in the original. */
function LocationPicker({ value, onChange, onEdited, disabled, code }: { value: string | null; onChange: (id: string | null) => void; onEdited: () => void; disabled: boolean; code: string | null }) {
  const [list, setList] = useState<Location[] | null>(null);
  const [canEdit, setCanEdit] = useState(true);
  const [form, setForm] = useState<{ id: string | null; fields: Fields } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<{ bad: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch(code ? `/api/locations?event=${encodeURIComponent(code)}` : "/api/locations", { cache: "no-store" });
      const b = (await r.json()) as { locations?: Location[]; canEdit?: boolean };
      setList(b.locations ?? []); setCanEdit(b.canEdit !== false);
    } catch { setList([]); setMessage({ bad: true, text: "Could not load saved locations." }); }
  }, [code]);
  useEffect(() => { void load(); }, [load]);
  const current = list?.find(l => l.id === value) ?? null;
  const locked = disabled || !canEdit;

  async function save() {
    if (!form) return;
    if (!form.fields.name.trim()) { setFormMessage("Enter a location name."); return; }
    const r = await fetch(form.id ? `/api/locations/${encodeURIComponent(form.id)}` : "/api/locations", { method: form.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form.fields, name: form.fields.name.trim() }) });
    const b = (await r.json().catch(() => ({}))) as Location & { error?: string };
    if (!r.ok) { setFormMessage(LOCATION_ERRORS[b.error ?? ""] ?? "Could not save the location."); return; }
    await load(); onChange(b.id); if (form.id) onEdited();
    setForm(null); setMessage({ bad: false, text: form.id ? "Location saved. Click Update to copy it to this tournament." : "Location added." });
  }
  async function remove() {
    if (!current) return;
    setConfirm(false);
    const r = await fetch(`/api/locations/${encodeURIComponent(current.id)}`, { method: "DELETE" });
    const b = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) { setMessage({ bad: true, text: LOCATION_ERRORS[b.error ?? ""] ?? "Could not delete the location." }); return; }
    onChange(null); await load(); setMessage({ bad: false, text: "Location deleted." });
  }
  const f = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(s => s && ({ ...s, fields: { ...s.fields, [k]: e.target.value } }));
  const closeForm = () => { setForm(null); setFormMessage(null); };

  return <section className="dk-tdlg-box" aria-label="Location">
    <div className="dk-tdlg-line">
      <Field label="Location" className="dd-field--grow"><Select value={value ?? ""} disabled={disabled || list === null} onChange={e => onChange(e.target.value || null)}>
        <option value="">None</option>{(list ?? []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
      <div className="dk-btn-row">
        <Button size="sm" disabled={locked} onClick={() => { setMessage(null); setFormMessage(null); setForm({ id: null, fields: BLANK_LOCATION }); }}>New</Button>
        <Button size="sm" disabled={locked || !current} onClick={() => { if (current) { const { id, ...fields } = current; setMessage(null); setFormMessage(null); setForm({ id, fields }); } }}>Edit</Button>
        <Button size="sm" variant="rose-outline" disabled={locked || !current} onClick={() => setConfirm(true)}>Delete</Button>
      </div>
    </div>
    {current && <p className="dd-meta" style={{ margin: 0 }}>{[current.address1, current.address2, current.city, current.state, current.postal, current.country].filter(Boolean).join(", ") || "No address saved."}</p>}
    {!canEdit && <p className="dd-meta" style={{ margin: 0 }}>Saved locations belong to the organizer. Only the organizer can change them.</p>}
    {message && <p role={message.bad ? "alert" : "status"} className={message.bad ? "dd-error" : "dd-meta"} style={{ margin: 0 }}>{message.text}</p>}
    {form && <SubDialog title={form.id ? "Edit Location" : "New Location"} onClose={closeForm} onEnter={() => void save()}
      actions={<><Button onClick={closeForm}>Cancel</Button><Button variant="violet" onClick={() => void save()}>{form.id ? "Save location" : "Add location"}</Button></>}>
      <div className="dk-form-grid">
        <Field label="Location name"><Input value={form.fields.name} onChange={f("name")} maxLength={200} autoComplete="off" autoFocus /></Field>
        <Field label="Address"><Input value={form.fields.address1} onChange={f("address1")} autoComplete="off" /></Field>
        <Field label="Address line 2"><Input value={form.fields.address2} onChange={f("address2")} autoComplete="off" /></Field>
        <Field label="City"><Input value={form.fields.city} onChange={f("city")} autoComplete="off" /></Field>
        <Field label="State / Province"><Input value={form.fields.state} onChange={f("state")} autoComplete="off" /></Field>
        <Field label="Postal code"><Input value={form.fields.postal} onChange={f("postal")} autoComplete="off" /></Field>
        <Field label="Country"><Input value={form.fields.country} onChange={f("country")} autoComplete="off" /></Field>
        <Field label="Phone"><Input value={form.fields.phone} onChange={f("phone")} autoComplete="off" /></Field>
        <Field label="Website"><Input value={form.fields.website} onChange={f("website")} autoComplete="off" /></Field>
      </div>
      {formMessage && <p role="alert" className="dd-error" style={{ margin: 0 }}>{formMessage}</p>}
    </SubDialog>}
    {confirm && current && <SubDialog title="Delete Location" onClose={() => setConfirm(false)} actions={<><Button onClick={() => setConfirm(false)} autoFocus>Keep</Button><Button variant="rose" onClick={() => void remove()}>Delete location</Button></>}>
      <p style={{ margin: 0 }}>Delete the saved location "{current.name}"?</p>
    </SubDialog>}
  </section>;
}

/**
 * A small window over the settings dialog. It renders in a portal so its fields are not part of the settings form:
 * Enter runs onEnter here and never submits the tournament. Escape closes only this window.
 */
function SubDialog({ title, onClose, onEnter, actions, children }: { title: string; onClose: () => void; onEnter?: () => void; actions: React.ReactNode; children: React.ReactNode }) {
  // React passes this window's close and cancel events up to the settings dialog through the portal; stop them here.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return createPortal(<div {...{ onClose: stop, onCancel: stop }}><Dialog open onClose={onClose} title={title} actions={actions}>
    <div className="dk-tdlg-sub" onKeyDown={e => { if (e.key === "Enter" && onEnter && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); e.stopPropagation(); onEnter(); } }}>{children}</div>
  </Dialog></div>, document.body);
}

const POSITION_ORDER = (p: StaffPosition) => POSITIONS.indexOf(p);

/** Staff list: Add / Edit / Delete, account search, and the original's position names. */
function StaffEditor({ rows, setRows, disabled, viewerRole, code, playerIds, creatorId }: { rows: StaffRow[]; setRows: (r: StaffRow[]) => void; disabled: boolean; viewerRole: StaffRole; code: string | null; playerIds: Set<number>; creatorId: number | null }) {
  const search = useAccountSearch(code);
  const [selected, setSelected] = useState<number | null>(null);
  const [editor, setEditor] = useState<{ mode: "add" | "edit"; account: Account | null; position: StaffPosition; confirmPlayer: boolean } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const row = rows.find(r => r.userId === selected) ?? null;
  const positions = POSITIONS.filter(p => p !== "organizer" || viewerRole === "organizer");
  const sorted = [...rows].sort((a, b) => POSITION_ORDER(a.position) - POSITION_ORDER(b.position) || a.name.localeCompare(b.name));

  function open(mode: "add" | "edit") {
    setMessage(null); search.setQuery(""); search.clear();
    if (mode === "edit" && row) setEditor({ mode, account: null, position: row.position, confirmPlayer: false });
    else setEditor({ mode: "add", account: null, position: "floor_judge", confirmPlayer: false });
  }
  const close = () => { setEditor(null); setMessage(null); };
  function commit(confirmed = false) {
    if (!editor) return;
    if (editor.mode === "edit" && row) { setRows(rows.map(r => (r.userId === row.userId ? { ...r, position: editor.position } : r))); close(); return; }
    const a = editor.account;
    if (!a) { setMessage("Search for an account, then pick it."); return; }
    if (a.userId === creatorId) { setMessage("You are already the organizer."); return; }
    if (rows.some(r => r.userId === a.userId)) { setMessage(`${a.displayName} is already on the staff list.`); return; }
    if (playerIds.has(a.userId) && !confirmed) { setEditor({ ...editor, confirmPlayer: true }); return; }
    setRows([...rows, { userId: a.userId, name: a.displayName, position: editor.position }]); setSelected(a.userId); close();
  }
  return <section className="dk-tdlg-box" aria-label="Staff">
    <span className="dd-caps">Staff</span>
    <div className="dk-tdlg-line" style={{ alignItems: "flex-start" }}>
      <ul className="dk-tdlg-staff" aria-label="Staff list">
        {rows.length === 0 && <li className="dd-meta">No staff added. You are the organizer.</li>}
        {sorted.map(r => <li key={r.userId}><button type="button" aria-pressed={r.userId === selected} data-selected={r.userId === selected} onClick={() => setSelected(r.userId)}>
          <span>{r.name}</span><span className="dd-meta">{POSITION_LABEL[r.position]}{r.locked ? " · owner" : ""}</span></button></li>)}
      </ul>
      <div className="dk-btn-row" style={{ flexDirection: "column" }}>
        <Button size="sm" disabled={disabled} onClick={() => open("add")}>Add</Button>
        <Button size="sm" disabled={disabled || !row || row.locked} onClick={() => open("edit")}>Edit</Button>
        <Button size="sm" variant="rose-outline" disabled={disabled || !row || row.locked} onClick={() => { if (row) { setRows(rows.filter(r => r.userId !== row.userId)); setSelected(null); } }}>Delete</Button>
      </div>
    </div>
    {disabled && <p className="dd-meta" style={{ margin: 0 }}>Only an organizer or head judge changes the staff list.</p>}
    {editor && <SubDialog title={editor.mode === "add" ? "Add Staff" : "Edit Staff"} onClose={close}
      onEnter={() => { if (editor.mode === "add" && !editor.account) { void search.run(search.query.trim()); } else commit(); }}
      actions={editor.confirmPlayer ? <><Button onClick={() => setEditor({ ...editor, confirmPlayer: false })} autoFocus>Cancel</Button><Button variant="violet" onClick={() => commit(true)}>Add as staff</Button></>
        : <><Button onClick={close}>Cancel</Button><Button variant="violet" onClick={() => commit()}>{editor.mode === "add" ? "Add staff" : "Save position"}</Button></>}>
      {editor.confirmPlayer ? <p style={{ margin: 0 }}>This person is registered as a player. Add as staff anyway?</p> : <>
        {editor.mode === "edit" && row ? <p style={{ margin: 0, fontWeight: 600 }}>{row.name}</p> : <>
          <Field label="Account search"><Input type="search" value={search.query} onChange={e => search.setQuery(e.target.value)} autoComplete="off" autoFocus placeholder="Name, username or Discord" /></Field>
          {search.state === "error" && <p className="dd-error" role="alert" style={{ margin: 0 }}>{search.error}</p>}
          {search.results && <ul className="dk-tdlg-find" aria-label="Accounts found">
            {search.results.length === 0 && <li className="dd-meta">No accounts match.</li>}
            {search.results.slice(0, 20).map(a => <li key={a.userId}><button type="button" data-selected={editor.account?.userId === a.userId} onClick={() => setEditor({ ...editor, account: a })}>
              <span>{a.displayName}</span><span className="dd-meta">@{a.username}</span></button></li>)}
          </ul>}
          {editor.account && <p className="dd-meta" style={{ margin: 0 }}>Picked: <strong style={{ color: "var(--text)" }}>{editor.account.displayName}</strong></p>}
        </>}
        <Field label="Position"><Select value={editor.position} autoFocus={editor.mode === "edit"} onChange={e => setEditor({ ...editor, position: e.target.value as StaffPosition })}>{positions.map(p => <option key={p} value={p}>{POSITION_LABEL[p]}</option>)}</Select></Field>
        {message && <p role="alert" className="dd-error" style={{ margin: 0 }}>{message}</p>}
      </>}
    </SubDialog>}
  </section>;
}

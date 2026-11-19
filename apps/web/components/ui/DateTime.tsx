"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Popup } from "./Popup";
import { cx } from "./cx";

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** Date text as the code expects it (yyyy-mm-dd). Also takes yyyy/m/d, m/d/yyyy (slashes) and d.m.yyyy (dots), with short months or days. */
export function parseDate(text: string): string | null {
  const t = text.trim();
  let y: number, mo: number, d: number;
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t), us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t), eu = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (iso) { y = Number(iso[1]); mo = Number(iso[2]); d = Number(iso[3]); }
  else if (us) { mo = Number(us[1]); d = Number(us[2]); y = Number(us[3]); }
  else if (eu) { d = Number(eu[1]); mo = Number(eu[2]); y = Number(eu[3]); }
  else return null;
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? isoOf(y, mo - 1, d) : null;
}

/** Time text as the code expects it (HH:mm, 24-hour). `strict` only takes a finished entry, so partial typing is left alone. */
export function parseTime(text: string, strict = false): string | null {
  const t = text.trim().toLowerCase();
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*([ap])?m?$/.exec(t);
  if (!m) return null;
  if (strict && !(m[2] !== undefined && (t.includes(":") ? true : t.length >= 4))) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (min > 59) return null;
  if (m[3]) { if (h < 1 || h > 12) return null; h = (h % 12) + (m[3] === "p" ? 12 : 0); }
  else if (h > 23) return null;
  return `${pad(h)}:${pad(min)}`;
}

const todayIso = () => { const n = new Date(); return isoOf(n.getFullYear(), n.getMonth(), n.getDate()); };
const split = (iso: string) => { const [y, m, d] = iso.split("-").map(Number) as [number, number, number]; return { y, m: m - 1, d }; };
const addDays = (iso: string, n: number) => { const { y, m, d } = split(iso); const t = new Date(y, m, d + n); return isoOf(t.getFullYear(), t.getMonth(), t.getDate()); };
const addMonths = (iso: string, n: number) => {
  const { y, m, d } = split(iso);
  const first = new Date(y, m + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return isoOf(first.getFullYear(), first.getMonth(), Math.min(d, last));
};

/** 0 = Sunday ... 6 = Saturday: the first weekday of the reader's week. */
function weekStart(): number {
  try {
    const info = (new Intl.Locale(navigator.language) as unknown as { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } });
    const first = (info.getWeekInfo?.() ?? info.weekInfo)?.firstDay;
    if (first) return first % 7;
  } catch { /* fall through */ }
  return 0;
}

/** Keep Tab inside a popup: from the last control it goes to the first, and back. */
function trapTab(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "Tab") return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")].filter(el => el.tabIndex >= 0);
  if (items.length === 0) return;
  const first = items[0]!, last = items[items.length - 1]!;
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

const CalendarIcon = () => <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="12" height="11" rx="2" /><path d="M2 6.5h12M5.5 1.8v2.4M10.5 1.8v2.4" /></svg>;
const ClockIcon = () => <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.3 1.4" /></svg>;

interface PickerProps {
  value: string; onChange: (value: string) => void; disabled?: boolean; id?: string; autoFocus?: boolean; required?: boolean; name?: string;
  className?: string; "aria-label"?: string; placeholder?: string;
}
interface PopupApi { value: string; pick: (value: string, keepOpen?: boolean) => void; close: (refocus?: boolean) => void }

/** A text box you can type in, and a button that opens a themed popup. The typed text commits to `value` once it is a full, valid entry. */
function PickerField({ value, onChange, disabled, id, autoFocus, required, name, className, placeholder, kind, parse, live, shape, popup, hint, ...aria }: PickerProps & {
  kind: "date" | "time"; hint: string; parse: (text: string) => string | null; live: (text: string) => string | null; shape: (raw: string, grew: boolean) => string;
  popup: (api: PopupApi) => ReactNode;
}) {
  const [text, setText] = useState(value);
  const sent = useRef(value);
  const [open, setOpen] = useState(false);
  const [bad, setBad] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const uid = useId();

  // A value that changed from outside replaces the typed text.
  useEffect(() => { if (value !== sent.current) { sent.current = value; setText(value); } }, [value]);
  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const emit = (next: string) => { if (next !== sent.current) { sent.current = next; onChange(next); } };
  const close = (refocus = false) => { setOpen(false); if (refocus) input.current?.focus(); };
  const pick = (next: string, keepOpen = false) => { setText(next); setBad(false); emit(next); if (!keepOpen) close(true); };

  // A press outside closes the popup and finishes the typed entry (the blur was skipped while the popup was open).
  const settleNow = useRef<() => void>(() => {});
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { const t = e.target as Node; if (!wrap.current?.contains(t) && !pop.current?.contains(t)) { setOpen(false); settleNow.current(); } };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  // Finish the typed entry: a valid one is normalized. Invalid text stays on screen with a hint, and the value is cleared so the form never holds a date that is not shown.
  const settle = () => {
    const ok = parse(text);
    if (ok !== null) { setText(ok); emit(ok); setBad(false); }
    else if (text.trim() === "") { emit(""); setBad(false); }
    else { emit(""); setBad(true); }
  };
  settleNow.current = settle;

  return <>
  <span ref={wrap} className="dd-picker">
    <input ref={input} id={id} type="text" className={cx("dd-input", "dd-picker__input", className)} value={text} placeholder={placeholder} disabled={disabled} required={required}
      autoComplete="off" spellCheck={false} inputMode="numeric" aria-invalid={bad ? true : undefined} aria-describedby={bad ? `${uid}-hint` : undefined}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${uid}-pop` : undefined} aria-label={aria["aria-label"]}
      onChange={e => {
        const raw = e.target.value, shaped = shape(raw, raw.length > text.length);
        setText(shaped); setBad(false);
        const ok = live(shaped);
        if (ok !== null) emit(ok); else if (shaped.trim() === "") emit("");
      }}
      onBlur={() => { if (!open) settle(); }}
      onKeyDown={e => {
        if (e.key === "Enter") settle();
        else if (e.key === "ArrowDown" && !disabled) { e.preventDefault(); setOpen(true); }
        else if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); close(); }
      }} />
    <button type="button" className="dd-picker__btn" tabIndex={-1} disabled={disabled} aria-hidden="true" aria-expanded={open}
      onMouseDown={e => e.preventDefault()} onClick={() => { if (open) close(true); else { const ok = parse(text); if (ok !== null) emit(ok); setBad(false); setOpen(true); } }}>
      {kind === "date" ? <CalendarIcon /> : <ClockIcon />}
    </button>
    {name && <input type="hidden" name={name} value={value} />}
    <Popup ref={pop} anchor={wrap} open={open} maxHeight={420} className={cx("dd-pop", kind === "date" ? "dd-cal" : "dd-timepop")} role="dialog" id={`${uid}-pop`}
      aria-label={kind === "date" ? "Choose a date" : "Choose a time"} onKeyDown={e => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
        trapTab(e);
      }}>
      {popup({ value, pick, close })}
    </Popup>
  </span>
  {/* aria-hidden keeps the hint out of the field's name (it sits inside the label); the input points to it with aria-describedby. */}
  {bad && <span id={`${uid}-hint`} className="dd-error" aria-hidden="true">{hint}</span>}
  </>;
}

// ---- Date ----

function Calendar({ value, pick, close }: PopupApi) {
  const selected = parseDate(value);
  const today = todayIso();
  const [focus, setFocus] = useState(selected ?? today);
  const grid = useRef<HTMLDivElement>(null);
  const moved = useRef(true);
  const first = useRef(weekStart());
  const { y, m } = split(focus);

  useEffect(() => {
    if (!moved.current) return;
    grid.current?.querySelector<HTMLElement>(`[data-iso="${focus}"]`)?.focus();
    moved.current = false;
  }, [focus]);

  const go = (next: string, focusGrid = true) => { moved.current = focusGrid; setFocus(next); };
  const lead = (new Date(y, m, 1).getDay() - first.current + 7) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => addDays(isoOf(y, m, 1), i - lead));
  const rows = Array.from({ length: 6 }, (_, r) => cells.slice(r * 7, r * 7 + 7)).filter((row, r) => r < 5 || split(row[0]!).m === m);
  const names = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const head = Array.from({ length: 7 }, (_, i) => names[(first.current + i) % 7]!);
  const title = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(y, m, 1));

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    const col = (new Date(y, m, split(focus).d).getDay() - first.current + 7) % 7;
    const next = k === "ArrowLeft" ? addDays(focus, -1) : k === "ArrowRight" ? addDays(focus, 1) : k === "ArrowUp" ? addDays(focus, -7) : k === "ArrowDown" ? addDays(focus, 7)
      : k === "Home" ? addDays(focus, -col) : k === "End" ? addDays(focus, 6 - col)
      : k === "PageUp" ? addMonths(focus, e.shiftKey ? -12 : -1) : k === "PageDown" ? addMonths(focus, e.shiftKey ? 12 : 1) : null;
    if (next) { e.preventDefault(); go(next); }
    else if (k === "Enter" || k === " ") { e.preventDefault(); pick(focus); }
  };

  return <>
    <div className="dd-cal__head">
      <button type="button" className="dd-cal__nav" aria-label="Previous year" onClick={() => go(addMonths(focus, -12), false)}>&laquo;</button>
      <button type="button" className="dd-cal__nav" aria-label="Previous month" onClick={() => go(addMonths(focus, -1), false)}>&lsaquo;</button>
      <div className="dd-cal__title" aria-live="polite">{title}</div>
      <button type="button" className="dd-cal__nav" aria-label="Next month" onClick={() => go(addMonths(focus, 1), false)}>&rsaquo;</button>
      <button type="button" className="dd-cal__nav" aria-label="Next year" onClick={() => go(addMonths(focus, 12), false)}>&raquo;</button>
    </div>
    <div ref={grid} role="grid" aria-label={title} className="dd-cal__grid" onKeyDown={onKey}>
      <div role="row" className="dd-cal__row">{head.map((n, i) => <span key={i} role="columnheader" className="dd-cal__dow">{n}</span>)}</div>
      {rows.map((row, r) => <div role="row" className="dd-cal__row" key={r}>
        {row.map(iso => {
          const { m: cm, d } = split(iso);
          return <button type="button" role="gridcell" key={iso} data-iso={iso} className="dd-cal__day" tabIndex={iso === focus ? 0 : -1}
            aria-selected={iso === selected} aria-current={iso === today ? "date" : undefined} data-out={cm !== m || undefined}
            aria-label={new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(new Date(split(iso).y, cm, d))}
            onClick={() => pick(iso)}>{d}</button>;
        })}
      </div>)}
    </div>
    <div className="dd-cal__foot">
      <button type="button" className="dd-cal__link" onClick={() => pick(today)}>Today</button>
      <button type="button" className="dd-cal__link" onClick={() => pick("")} disabled={!selected}>Clear</button>
    </div>
  </>;
}

/** Date entry in the DD theme. `value` is yyyy-mm-dd or an empty string; typing works, and so does the calendar button or the Down arrow. */
export function DatePicker(props: PickerProps) {
  return <PickerField {...props} kind="date" placeholder={props.placeholder ?? "yyyy-mm-dd"}
    parse={parseDate} live={t => (/^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[/.]\d{1,2}[/.]\d{4})$/.test(t.trim()) ? parseDate(t) : null)}
    hint="Use yyyy-mm-dd, for example 2026-12-25."
    shape={(input, grew) => {
      // A separator typed after the automatic dash replaces it.
      const raw = input.replace(/[-/.]{2,}/g, run => run.slice(-1));
      if (!grew || !/^[\d-]*$/.test(raw)) return raw;
      let out = raw.includes("-") ? raw : [raw.slice(0, 4), raw.slice(4, 6), raw.slice(6, 8)].filter(Boolean).join("-");
      const parts = out.split("-"), at = parts.length - 1;
      if (/\d$/.test(out) && at < 2 && parts[at]!.length === (at === 0 ? 4 : 2)) out += "-";
      return out;
    }}
    popup={api => <Calendar {...api} />} />;
}

// ---- Time ----

function TimeList({ value, pick, close }: PopupApi) {
  const parsed = parseTime(value);
  const [h, mi] = parsed ? parsed.split(":").map(Number) as [number, number] : [null, null];
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = [...Array.from({ length: 12 }, (_, i) => i * 5), ...(mi !== null && mi % 5 !== 0 ? [mi] : [])].sort((a, b) => a - b);
  const [cur, setCur] = useState<{ col: 0 | 1; h: number; m: number }>(() => ({ col: 0, h: h ?? new Date().getHours(), m: mi ?? 0 }));
  const box = useRef<HTMLDivElement>(null);
  const move = useRef(true);

  useEffect(() => {
    if (!move.current) return;
    const el = box.current?.querySelector<HTMLElement>(`[data-col="${cur.col}"][data-v="${cur.col === 0 ? cur.h : cur.m}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest" });
    move.current = false;
  }, [cur]);
  useEffect(() => {
    // Show the chosen hour and minute near the middle of their lists on open.
    box.current?.querySelectorAll<HTMLElement>("[aria-selected='true']").forEach(el => { const p = el.parentElement!; p.scrollTop = el.offsetTop - p.clientHeight / 2 + el.clientHeight / 2; });
  }, []);

  const choose = (col: 0 | 1, v: number) => {
    if (col === 0) { pick(`${pad(v)}:${pad(mi ?? 0)}`, true); move.current = true; setCur({ ...cur, col: 1, h: v }); }
    else pick(`${pad(h ?? cur.h)}:${pad(v)}`);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement, col = Number(t.dataset.col) as 0 | 1;
    if (!t.dataset.v) return;
    const list = col === 0 ? hours : minutes, at = list.indexOf(Number(t.dataset.v));
    const step = (n: number) => list[Math.max(0, Math.min(list.length - 1, at + n))]!;
    let next: typeof cur | null = null;
    const set = (v: number) => ({ ...cur, col, [col === 0 ? "h" : "m"]: v }) as typeof cur;
    switch (e.key) {
      case "ArrowDown": next = set(step(1)); break;
      case "ArrowUp": next = set(step(-1)); break;
      case "PageDown": next = set(step(6)); break;
      case "PageUp": next = set(step(-6)); break;
      case "Home": next = set(list[0]!); break;
      case "End": next = set(list[list.length - 1]!); break;
      case "ArrowRight": if (col === 0) next = { ...cur, col: 1 }; break;
      case "ArrowLeft": if (col === 1) next = { ...cur, col: 0 }; break;
      case "Enter": case " ": e.preventDefault(); choose(col, Number(t.dataset.v)); return;
    }
    if (next) { e.preventDefault(); move.current = true; setCur(next); }
  };

  return <>
    <div ref={box} className="dd-timepop__cols" onKeyDown={onKey}>
      {([["Hour", hours, h, 0], ["Minute", minutes, mi, 1]] as const).map(([name, list, chosen, col]) => <div key={name} className="dd-timepop__col" role="listbox" aria-label={name}>
        {list.map(v => <button type="button" role="option" key={v} data-col={col} data-v={v} className="dd-timepop__opt" aria-selected={v === chosen}
          tabIndex={v === (col === 0 ? cur.h : cur.m) ? 0 : -1} onClick={() => choose(col, v)}>{pad(v)}</button>)}
      </div>)}
    </div>
    <div className="dd-cal__foot">
      <button type="button" className="dd-cal__link" onClick={() => pick("")} disabled={!parsed}>Clear</button>
      <button type="button" className="dd-cal__link" onClick={() => close(true)}>Done</button>
    </div>
  </>;
}

/** Time entry in the DD theme. `value` is HH:mm (24-hour) or an empty string; typing works ("1830", "6:30 pm"), and so does the clock button or the Down arrow. */
export function TimePicker(props: PickerProps) {
  return <PickerField {...props} kind="time" placeholder={props.placeholder ?? "HH:mm"}
    parse={t => parseTime(t)} live={t => parseTime(t, true)} hint="Use hh:mm, for example 18:30."
    shape={(raw, grew) => { const t = raw.replace(/:{2,}/g, ":"); return grew && /^\d{2}$/.test(t) && Number(t) < 24 ? `${t}:` : t; }}
    popup={api => <TimeList {...api} />} />;
}

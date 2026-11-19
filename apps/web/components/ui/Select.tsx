"use client";
import { Children, Fragment, isValidElement, useEffect, useId, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { Popup } from "./Popup";
import { cx } from "./cx";

interface Opt { value: string; label: string; disabled: boolean; group: string | null }

const textOf = (node: ReactNode): string => Children.toArray(node).map(c => (typeof c === "string" || typeof c === "number" ? String(c) : isValidElement<{ children?: ReactNode }>(c) ? textOf(c.props.children) : "")).join("");

/** Flatten <option> and <optgroup> children (also inside fragments) into a plain list. */
function readOptions(children: ReactNode, group: string | null = null, out: Opt[] = []): Opt[] {
  Children.forEach(children, child => {
    if (!isValidElement<{ children?: ReactNode; value?: unknown; label?: string; disabled?: boolean }>(child)) return;
    if (child.type === Fragment) readOptions(child.props.children, group, out);
    else if (child.type === "optgroup") readOptions(child.props.children, child.props.label ?? "", out);
    else if (child.type === "option") {
      const label = textOf(child.props.children);
      out.push({ value: child.props.value === undefined ? label : String(child.props.value), label, disabled: Boolean(child.props.disabled), group });
    }
  });
  return out;
}

/**
 * A listbox in the DD theme. Same props as a native <select> (value, defaultValue, onChange, name, required, disabled,
 * <option> and <optgroup> children). A hidden native select keeps the form value and validity and sends the real
 * change event, so call sites read `e.target.value` as before.
 */
export function Select({ className, compact, children, id, style, autoFocus, disabled, "aria-label": ariaLabel, "aria-labelledby": labelledBy, "aria-describedby": describedBy, "aria-invalid": invalid, onFocus, onBlur, ...rest }: Omit<ComponentProps<"select">, "multiple" | "size"> & { compact?: boolean }) {
  const options = useMemo(() => readOptions(children), [children]);
  const controlled = rest.value !== undefined;
  const [inner, setInner] = useState(() => String(rest.defaultValue ?? ""));
  const value = controlled ? String(rest.value) : inner;
  const selectedIndex = (() => { const i = options.findIndex(o => o.value === value); return i >= 0 ? i : options.findIndex(o => !o.disabled); })();
  const selected = options[selectedIndex];

  const trigger = useRef<HTMLButtonElement>(null);
  const native = useRef<HTMLSelectElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = useRef({ text: "", at: 0 });
  const uid = useId();
  const optionId = (i: number) => `${uid}-o${i}`;

  const enabled = (from: number, step: 1 | -1) => {
    for (let i = from; i >= 0 && i < options.length; i += step) if (!options[i]!.disabled) return i;
    return -1;
  };
  const show = (at = selectedIndex) => { setActive(at >= 0 ? at : enabled(0, 1)); setOpen(true); };
  const close = () => setOpen(false);

  const commit = (index: number) => {
    const opt = options[index];
    setOpen(false);
    if (!opt || opt.disabled) return;
    const el = native.current;
    if (el && el.value !== opt.value) { el.value = opt.value; el.dispatchEvent(new Event("change", { bubbles: true })); }
    if (!controlled) setInner(opt.value);
  };

  useEffect(() => { if (autoFocus) trigger.current?.focus(); }, [autoFocus]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  // Keep the highlighted row in view (an effect, so the list is already shown).
  useEffect(() => {
    if (!open || active < 0) return;
    // Scroll only the list itself; scrollIntoView would also move the dialog behind it.
    const el = document.getElementById(optionId(active)), box = list.current;
    if (!el || !box) return;
    const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop -= b.top - r.top;
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
  });

  // A press outside both the field and the list closes it.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { const t = e.target as Node; if (!trigger.current?.contains(t) && !list.current?.contains(t)) setOpen(false); };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  const typeAhead = (key: string) => {
    const now = Date.now(), t = typed.current;
    t.text = now - t.at > 700 ? key : t.text + key;
    t.at = now;
    const text = t.text.toLowerCase();
    const same = text.length > 1 && [...text].every(c => c === text[0]);
    const needle = same ? text[0]! : text;
    const start = open ? active : selectedIndex;
    const order = [...options.keys()];
    const rotated = same || text.length === 1 ? [...order.slice(start + 1), ...order.slice(0, start + 1)] : [...order.slice(Math.max(start, 0)), ...order.slice(0, Math.max(start, 0))];
    const hit = rotated.find(i => !options[i]!.disabled && options[i]!.label.toLowerCase().startsWith(needle));
    if (hit === undefined) return;
    if (open) setActive(hit); else show(hit);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.ctrlKey || e.metaKey || (e.altKey && e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    const key = e.key;
    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") { stop(); show(); }
      else if (key === "Home") { stop(); show(enabled(0, 1)); }
      else if (key === "End") { stop(); show(enabled(options.length - 1, -1)); }
      else if (key.length === 1 && key !== " ") { stop(); typeAhead(key); }
      return;
    }
    const busy = typed.current.text !== "" && Date.now() - typed.current.at < 700;
    if (key === "ArrowDown") { stop(); const n = enabled(active + 1, 1); if (n >= 0) setActive(n); }
    else if (key === "ArrowUp") { stop(); if (e.altKey) commit(active); else { const n = enabled(active - 1, -1); if (n >= 0) setActive(n); } }
    else if (key === "Home") { stop(); setActive(enabled(0, 1)); }
    else if (key === "End") { stop(); setActive(enabled(options.length - 1, -1)); }
    else if (key === "PageDown") { stop(); const n = enabled(Math.min(options.length - 1, active + 10), -1); if (n >= 0) setActive(Math.max(n, active)); }
    else if (key === "PageUp") { stop(); const n = enabled(Math.max(0, active - 10), 1); if (n >= 0) setActive(Math.min(n, active)); }
    else if (key === "Enter" || (key === " " && !busy)) { stop(); commit(active); }
    else if (key === "Escape") { stop(); close(); }
    else if (key === "Tab") { commit(active); }
    else if (key.length === 1) { stop(); typeAhead(key); }
  };

  const groups = options.map((o, i) => (i === 0 || options[i - 1]!.group !== o.group) && o.group ? o.group : null);

  return <>
    <button ref={trigger} type="button" id={id} role="combobox" className={cx("dd-select", compact && "dd-select--sm", className)} style={style}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${uid}-list` : undefined} aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
      aria-label={ariaLabel} aria-labelledby={labelledBy} aria-describedby={describedBy} aria-invalid={invalid} aria-required={rest.required || undefined}
      disabled={disabled} data-empty={selected?.value === "" ? "true" : undefined}
      onClick={() => (open ? close() : show())} onKeyDown={onKeyDown} onBlur={e => { setOpen(false); onBlur?.(e as never); }} onFocus={e => onFocus?.(e as never)}>
      <span className="dd-select__label">{selected?.label ?? ""}</span>
    </button>
    <select ref={native} className="dd-sr" tabIndex={-1} aria-hidden="true" disabled={disabled} {...rest}
      onFocus={() => trigger.current?.focus()}>{children}</select>
    <Popup ref={list} anchor={trigger} open={open} matchWidth maxHeight={320} className="dd-pop dd-listbox" role="listbox" id={`${uid}-list`}
      aria-label={ariaLabel} onMouseDown={e => e.preventDefault()}>
      {options.map((o, i) => <Fragment key={`${i}:${o.value}`}>
        {groups[i] && <div className="dd-listbox__group" role="presentation">{groups[i]}</div>}
        <div id={optionId(i)} role="option" className="dd-listbox__opt" aria-selected={i === selectedIndex} aria-disabled={o.disabled || undefined}
          data-active={i === active || undefined} onMouseMove={() => { if (!o.disabled && active !== i) setActive(i); }} onClick={() => commit(i)}>
          <span className="dd-listbox__text">{o.label || " "}</span>
          {i === selectedIndex && <svg className="dd-listbox__check" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </div>
      </Fragment>)}
    </Popup>
  </>;
}

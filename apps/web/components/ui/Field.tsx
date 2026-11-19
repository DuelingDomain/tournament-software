"use client";
import { useCallback, useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { cx } from "./cx";

export { Select } from "./Select";
export { DatePicker, TimePicker } from "./DateTime";

/** Press and hold repeats the step after a short pause. */
const HOLD_MS = 420, REPEAT_MS = 70;

function NumberInput({ className, mono, slot, ref, ...rest }: ComponentProps<"input"> & { mono?: boolean; slot?: boolean }) {
  const own = useRef<HTMLInputElement | null>(null);
  const timer = useRef<{ start?: ReturnType<typeof setTimeout>; repeat?: ReturnType<typeof setInterval> }>({});
  const setRef = useCallback((el: HTMLInputElement | null) => {
    own.current = el;
    if (typeof ref === "function") ref(el); else if (ref) ref.current = el;
  }, [ref]);
  const stop = () => { clearTimeout(timer.current.start); clearInterval(timer.current.repeat); timer.current = {}; };
  // Stop a running repeat when the field goes away or the pointer is released anywhere.
  useEffect(() => {
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => { window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); stop(); };
  }, []);
  const step = (dir: 1 | -1) => {
    const el = own.current;
    if (!el || el.matches(":disabled") || el.readOnly) return;
    try { if (dir > 0) el.stepUp(); else el.stepDown(); } catch { return; }
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const hold = (dir: 1 | -1) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    own.current?.focus();
    step(dir);
    stop();
    timer.current.start = setTimeout(() => { timer.current.repeat = setInterval(() => step(dir), REPEAT_MS); }, HOLD_MS);
  };
  const arrow = (up: boolean) => <svg viewBox="0 0 10 6" width="9" height="6" aria-hidden="true"><path d={up ? "M1 5l4-4 4 4" : "M1 1l4 4 4-4"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <span className="dd-num">
    <input ref={setRef} className={cx("dd-input", "dd-num__input", mono && "dd-input--mono", slot && "dd-input--slot", className)} {...rest} />
    <span className="dd-num__steps" aria-hidden="true">
      <button type="button" tabIndex={-1} aria-label="Increase" disabled={rest.disabled} onPointerDown={hold(1)} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onContextMenu={e => e.preventDefault()}>{arrow(true)}</button>
      <button type="button" tabIndex={-1} aria-label="Decrease" disabled={rest.disabled} onPointerDown={hold(-1)} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onContextMenu={e => e.preventDefault()}>{arrow(false)}</button>
    </span>
  </span>;
}

export function Input({ className, mono, slot, ...rest }: ComponentProps<"input"> & { mono?: boolean; slot?: boolean }) {
  if (rest.type === "number") return <NumberInput className={className} mono={mono} slot={slot} {...rest} />;
  return <input className={cx("dd-input", mono && "dd-input--mono", slot && "dd-input--slot", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cx("dd-input", "dd-textarea", className)} {...rest} />;
}

/** Label + control + optional hint/error. Wraps the control in a <label> so it is always named. */
export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return <label className={cx("dd-field", className)}>
    <span className="dd-caps">{label}</span>
    {children}
    {hint && <span className="dd-hint">{hint}</span>}
    {error && <span className="dd-error" role="alert">{error}</span>}
  </label>;
}

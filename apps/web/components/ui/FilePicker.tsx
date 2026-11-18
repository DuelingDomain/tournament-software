"use client";
import { useId, useState, type DragEvent, type ReactNode } from "react";
import { cx } from "./cx";

/** True when the file name ends with one of the extensions in an accept list (".xml,.Tournament,text/xml"). */
export function matchesAccept(name: string, accept: string) {
  const lower = name.toLowerCase();
  return accept.split(",").map(s => s.trim().toLowerCase()).filter(s => s.startsWith(".")).some(ext => lower.endsWith(ext));
}

/**
 * Styled file picker: a visually hidden real <input type="file"> behind a slip-styled drop zone.
 * The input keeps keyboard focus (the zone shows the focus ring), so Space/Enter opens the browser file chooser.
 * Dropped files are checked against `accept`; a mismatch calls `onReject` instead of `onChange`.
 */
export function FilePicker({ label, accept, file, onChange, onReject, hint, disabled, className }: {
  label: ReactNode; accept: string; file: File | null; onChange: (file: File | null) => void; onReject?: (name: string) => void;
  hint?: ReactNode; disabled?: boolean; className?: string;
}) {
  const id = useId();
  const [over, setOver] = useState(false);
  function drop(event: DragEvent) {
    event.preventDefault(); setOver(false);
    if (disabled) return;
    const dropped = event.dataTransfer.files?.[0];
    if (!dropped) return;
    if (!matchesAccept(dropped.name, accept)) { onReject?.(dropped.name); return; }
    onChange(dropped);
  }
  return <div className={cx("dd-field", className)}>
    <span className="dd-caps" id={`${id}-label`}>{label}</span>
    <label htmlFor={id} className="dd-file" data-over={over ? "true" : undefined} data-disabled={disabled ? "true" : undefined}
      onDragOver={event => { event.preventDefault(); if (!disabled) setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
      <input id={id} type="file" className="dd-sr" accept={accept} disabled={disabled} aria-labelledby={`${id}-label ${id}-name`}
        onChange={event => onChange(event.target.files?.[0] ?? null)} />
      <svg className="dd-file__icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 2.75h8.5L19.25 7.5v13.75H6z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M14.25 2.75V7.75h5M12.5 17.5v-6M9.75 14l2.75-2.75L15.25 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="dd-file__text">
        <span id={`${id}-name`} className={file ? "dd-file__name" : "dd-file__none"}>{file ? file.name : "No file chosen"}</span>
        <span className="dd-file__sub">{over ? "Drop to choose this file" : file ? "Drag another file here, or" : "Drag a file here, or"}</span>
      </span>
      <span className="dd-btn dd-btn--sm dd-file__btn" aria-hidden="true">{file ? "Change file" : "Choose file"}</span>
    </label>
    {hint && <span className="dd-hint">{hint}</span>}
  </div>;
}

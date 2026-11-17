"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Keycap } from "../ui";
import type { Action } from "./actions";

function highlight(label: string, q: string) {
  if (!q) return label;
  const i = label.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return label;
  return <>{label.slice(0, i)}<mark>{label.slice(i, i + q.length)}</mark>{label.slice(i + q.length)}</>;
}

/** Ctrl+. command palette. Lists every menu command with its key. */
export function Palette({ actions, onClose }: { actions: Action[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  useEffect(() => { ref.current?.showModal(); }, []);
  const items = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return actions.filter(a => words.every(w => `${a.menu} ${a.label} ${a.keys ?? ""}`.toLowerCase().includes(w)));
  }, [actions, q]);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { document.getElementById(`pal-${sel}`)?.scrollIntoView({ block: "nearest" }); }, [sel]);
  const run = (a: Action | undefined) => { if (!a || !a.enabled) return; onClose(); window.setTimeout(a.run, 0); };

  return <dialog ref={ref} className="dk-pal" aria-label="Command palette" onClose={onClose} onCancel={e => { e.preventDefault(); onClose(); }}>
    <div className="dk-pal-in">
      <input className="dd-input" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-activedescendant={items[sel] ? `pal-${sel}` : undefined} aria-label="Type a command"
        placeholder="Type a command" autoFocus value={q} onChange={e => setQ(e.target.value)} autoComplete="off"
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(items.length - 1, s + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); run(items[sel]); }
        }} />
      <ul id="pal-list" role="listbox" aria-label="Commands" className="dk-pal-list">
        {items.length === 0 && <li className="dd-meta" style={{ padding: 12 }}>No command matches.</li>}
        {items.map((a, i) => <li key={a.id} id={`pal-${i}`} role="option" className="dk-pal-item" aria-selected={i === sel} aria-disabled={!a.enabled || undefined}
          onMouseMove={() => setSel(i)} onClick={() => run(a)}>
          <span>{highlight(a.label, q.trim())}</span>
          {!a.enabled && a.reason && <span className="dd-meta">{a.reason}</span>}
          <span className="dk-pal-group">{a.menu}</span>{a.keys && <Keycap>{a.keys}</Keycap>}
        </li>)}
      </ul>
      <div className="dk-pal-foot"><span><Keycap>Esc</Keycap> close</span><span><Keycap>Enter</Keycap> run</span><span><Keycap>↑</Keycap><Keycap>↓</Keycap> choose</span></div>
    </div>
  </dialog>;
}

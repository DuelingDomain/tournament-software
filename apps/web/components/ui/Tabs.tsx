"use client";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";
import { Keycap } from "./Keycap";

export type TabItem = { id: string; label: ReactNode; keyHint?: string; badge?: ReactNode; href?: string; panelId?: string };

/**
 * Binder tabs (default), index dividers (`variant="index"`, with F-key hints) or phone tabs.
 * Controlled. Items with `href` render as links and use aria-current instead of the tab pattern.
 */
export function Tabs({ items, value, onChange, label, variant = "binder", className }: {
  items: TabItem[]; value: string; onChange?: (id: string) => void; label: string; variant?: "binder" | "index" | "phone"; className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const linked = items.some(item => item.href);
  function onKey(event: KeyboardEvent) {
    if (linked || !["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    const index = items.findIndex(item => item.id === value);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    event.preventDefault();
    onChange?.(items[next].id);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }
  const cls = cx("dd-tabs", variant !== "binder" && `dd-tabs--${variant}`, className);
  if (linked) return <nav aria-label={label} className={cls}>
    {items.map(item => <a key={item.id} href={item.href} className="dd-tab" aria-current={item.id === value ? "page" : undefined}>{item.label}{item.badge}{item.keyHint && <Keycap>{item.keyHint}</Keycap>}</a>)}
  </nav>;
  return <div ref={list} role="tablist" aria-label={label} className={cls} onKeyDown={onKey}>
    {items.map(item => <button key={item.id} type="button" role="tab" id={`tab-${item.id}`} aria-selected={item.id === value} aria-controls={item.panelId}
      tabIndex={item.id === value ? 0 : -1} className="dd-tab" onClick={() => onChange?.(item.id)}>
      {item.label}{item.badge}{item.keyHint && <Keycap>{item.keyHint}</Keycap>}
    </button>)}
  </div>;
}

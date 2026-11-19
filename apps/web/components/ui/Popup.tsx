"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type HTMLAttributes, type RefObject } from "react";
import { createPortal } from "react-dom";

const GAP = 4;
const EDGE = 8;

/** Where a popup goes: inside the open modal dialog (so it stays reachable and on top of it), else the page body. */
function hostOf(anchor: HTMLElement | null): HTMLElement {
  return (anchor?.closest("dialog[open]") as HTMLElement | null) ?? document.body;
}

/**
 * Floating panel for listboxes and pickers. It sits in the browser's top layer (popover) inside the same dialog as its
 * anchor, opens below the anchor, flips above it when the space below is short, and scrolls when it is taller than the
 * space it has. Nothing here steals focus: the owner decides who has focus.
 */
export const Popup = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & {
  anchor: RefObject<HTMLElement | null>; open: boolean; matchWidth?: boolean; maxHeight?: number;
}>(function Popup({ anchor, open, matchWidth, maxHeight = 320, className, style, children, ...rest }, forwarded) {
  const ref = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwarded, () => ref.current as HTMLDivElement);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => { setHost(open ? hostOf(anchor.current) : null); }, [open, anchor]);

  const place = useCallback(() => {
    const pop = ref.current, a = anchor.current;
    if (!pop || !a) return;
    const r = a.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    pop.style.maxHeight = "none";
    pop.style.minWidth = matchWidth ? `${r.width}px` : "";
    const natural = Math.min(pop.offsetHeight, maxHeight);
    const below = vh - r.bottom - GAP - EDGE, above = r.top - GAP - EDGE;
    const up = natural > below && above > below;
    const room = Math.max(96, up ? above : below);
    const height = Math.min(natural, room);
    pop.style.maxHeight = `${Math.min(maxHeight, room)}px`;
    pop.style.top = `${up ? r.top - GAP - height : r.bottom + GAP}px`;
    const width = pop.offsetWidth;
    pop.style.left = `${Math.max(EDGE, Math.min(r.left, vw - width - EDGE))}px`;
    pop.dataset.side = up ? "up" : "down";
  }, [anchor, matchWidth, maxHeight]);

  useLayoutEffect(() => {
    const pop = ref.current;
    if (!open || !host || !pop) return;
    try { if (!pop.matches(":popover-open")) pop.showPopover(); } catch { /* old browsers: fixed position and z-index still apply */ }
    place();
  });

  useEffect(() => {
    if (!open || !host) return;
    const onMove = (e: Event) => { if (!(e.target instanceof Node && ref.current?.contains(e.target))) place(); };
    window.addEventListener("resize", onMove);
    document.addEventListener("scroll", onMove, true);
    return () => { window.removeEventListener("resize", onMove); document.removeEventListener("scroll", onMove, true); };
  }, [open, host, place]);

  if (!open || !host) return null;
  return createPortal(<div ref={ref} popover="manual" className={className} style={style} {...rest}>{children}</div>, host);
});

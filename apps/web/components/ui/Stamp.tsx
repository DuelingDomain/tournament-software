import type { ReactNode } from "react";
import { cx } from "./cx";

export type StampKind = "p1" | "p2" | "draw" | "double_loss" | "bye" | "awaiting" | "plain";

/** Shape-coded so status never relies on colour alone: chevrons for wins, = for draw, X for double loss. */
function Glyph({ kind }: { kind: StampKind }) {
  const common = { width: 11, height: 11, viewBox: "0 0 12 12", "aria-hidden": true as const };
  switch (kind) {
    case "p1": return <svg {...common}><path d="M8 1.5 L3 6 L8 10.5" fill="none" stroke="currentColor" strokeWidth="2.2" /></svg>;
    case "p2": return <svg {...common}><path d="M4 1.5 L9 6 L4 10.5" fill="none" stroke="currentColor" strokeWidth="2.2" /></svg>;
    case "draw": return <svg {...common}><path d="M2 4.5 H10 M2 7.5 H10" stroke="currentColor" strokeWidth="2" /></svg>;
    case "double_loss": return <svg {...common}><path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5" stroke="currentColor" strokeWidth="2.2" /></svg>;
    case "awaiting": return <svg width="12" height="13" viewBox="0 0 14 16" aria-hidden="true"><path d="M2 1.5 H12 M2 14.5 H12 M3 1.5 C3 6 7 6.5 7 8 C7 9.5 3 10 3 14.5 M11 1.5 C11 6 7 6.5 7 8 C7 9.5 11 10 11 14.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
    default: return null;
  }
}

const LABEL: Record<StampKind, string> = { p1: "P1 wins", p2: "P2 wins", draw: "Draw", double_loss: "Double loss", bye: "Bye", awaiting: "Awaiting confirm", plain: "" };

/** Result stamp. `children` overrides the default label (e.g. a player's short name). Winner stamps are gold. */
export function Stamp({ kind, children, size, still, className }: { kind: StampKind; children?: ReactNode; size?: "sm" | "lg"; still?: boolean; className?: string }) {
  const tone = kind === "p1" || kind === "p2" || kind === "bye" ? "win" : kind === "awaiting" ? "violet" : kind === "plain" ? "plain" : kind;
  return <span className={cx("dd-stamp", `dd-stamp--${tone}`, size && `dd-stamp--${size}`, still && "dd-stamp--static", className)}>
    <Glyph kind={kind} />{children ?? LABEL[kind]}
  </span>;
}

/** Dashed empty stamp box for an unreported match. */
export function EmptyStamp() { return <span className="dd-stamp-empty" aria-hidden="true" />; }

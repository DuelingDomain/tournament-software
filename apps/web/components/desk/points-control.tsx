"use client";
import { Button } from "../ui";

/** Open Dueling: points are set by hand, one step at a time (AdjustPoints). */
export function PointsControl({ name, points, disabled, onAdjust }: { name: string; points: number; disabled?: boolean; onAdjust: (delta: number) => void }) {
  return <span className="dk-pts" role="group" aria-label={`${name}: Open Dueling points`}>
    <Button size="sm" aria-label={`Subtract a point from ${name}`} disabled={disabled} onClick={() => onAdjust(-1)}>−</Button>
    <span className="dk-num dk-pts-val" aria-live="polite">{points}</span>
    <Button size="sm" aria-label={`Add a point to ${name}`} disabled={disabled} onClick={() => onAdjust(1)}>+</Button>
  </span>;
}

"use client";
import type { PublicView } from "@dd-tournament/engine";
import { clock, remaining, spokenClock } from "./format";
import { useNow } from "./live";

/** Gold live timer. Shows the words "Time called" at zero so state is never colour alone. */
export function RoundTimer({ round, suffix = " left" }: { round: PublicView["currentRound"]; suffix?: string }) {
  const running = !!round?.endsAt;
  const now = useNow(running);
  const left = remaining(round, now);
  if (left === null) return null;
  if (left <= 0) return <span className="dd-num" style={{ color: "var(--gold)", fontWeight: 600 }}>Time called</span>;
  return <span role="timer" aria-label={`${spokenClock(left)} left`} className="dd-num" style={{ color: "var(--gold)", fontWeight: 600 }}>
    <span aria-hidden="true">{clock(left)}{suffix}</span>
  </span>;
}

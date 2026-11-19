import type { MatchResult, PublicView } from "@dd-tournament/engine";

export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function spokenClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)} minutes ${total % 60} seconds`;
}

/** Remaining ms for the round timer, or null when no timer is running. */
export function remaining(round: PublicView["currentRound"], now: number): number | null {
  if (!round?.endsAt) return null;
  return Date.parse(round.endsAt) - now;
}

export function phaseLabel(view: Pick<PublicView, "phase" | "currentRound">): string {
  const r = view.currentRound;
  switch (view.phase) {
    case "registration": return "Registration open";
    case "swiss": return r ? `Round ${r.number} in progress` : "Swiss rounds";
    case "playoff": return r ? `Playoff round ${r.number} in progress` : "Playoffs";
    case "complete": return "Event complete";
  }
}

export function eventMeta(view: PublicView): string {
  const parts = [view.format === "open_dueling" || view.style === "open_dueling" ? "Open Dueling" : view.format === "swiss" ? "Swiss" : "Single elimination"];
  if (view.plannedRounds) parts.push(`${view.plannedRounds} rounds`);
  if (view.topCut) parts.push(`top ${view.topCut} cut`);
  parts.push(view.playerStructure > 1 ? `${view.teamCount} teams · ${view.playerCount} players` : `${view.playerCount} players`);
  return parts.join(" · ");
}

export const isByeResult = (r: MatchResult | null) => r === "bye_win" || r === "bye_loss";

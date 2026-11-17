import type { DeskView, EventState, Match, MatchResult, Player, Round, Standing } from "@dd-tournament/engine";

export type ResultKind = "p1" | "p2" | "draw" | "double_loss";
export type Entry = ResultKind | null;
export type DeskCommandResult = { ok: true; before: DeskView; desk: DeskView } | { ok: false; code: string; message: string };

export const RESULT_KEY: Record<string, Entry | undefined> = { "-": "p1", "+": "p2", "=": "p2", "*": "draw", "/": "double_loss", "$": null };
export const KEY_OF: Record<string, string> = { p1: "-", p2: "+", draw: "*", double_loss: "/", clear: "$" };
export const STAMP_TEXT: Record<MatchResult, string> = {
  p1: "P1 Wins", p2: "P2 Wins", draw: "Draw", double_loss: "Double Loss", bye_win: "Bye", bye_loss: "Bye (loss)",
};
export const PENALTY_LABEL = { caution: "Caution", warning: "Warning", game_loss: "Game Loss", match_loss: "Match Loss", disqualification: "Disqualification" } as const;

export const playerById = (state: EventState) => new Map(state.players.map(p => [p.id, p] as const));
export const currentRound = (state: EventState): Round | undefined => state.rounds.at(-1);
export const activePlayers = (state: EventState) => state.players.filter(p => p.status === "active");
export const firstWord = (name: string) => name.trim().split(/\s+/)[0] ?? name;
export const byName = (a: Player, b: Player) => a.name.localeCompare(b.name);
export const isBye = (m: Match) => m.p2 === null;

/** Wins-losses-draws counted over rounds before `round`, shown beside names like the old grid. */
export function recordsBefore(state: EventState, round: number) {
  const records = new Map<string, [number, number, number]>(state.players.map(p => [p.id, [0, 0, 0]]));
  for (const r of state.rounds) {
    if (r.number >= round) continue;
    for (const m of r.matches) {
      if (m.result === null) continue;
      const a = records.get(m.p1);
      const b = m.p2 === null ? undefined : records.get(m.p2);
      if (m.result === "p1" || m.result === "bye_win") { if (a) a[0]++; if (b) b[1]++; }
      else if (m.result === "p2") { if (a) a[1]++; if (b) b[0]++; }
      else if (m.result === "draw") { if (a) a[2]++; if (b) b[2]++; }
      else { if (a) a[1]++; if (b) b[1]++; }
    }
  }
  return new Map([...records].map(([id, [w, l, d]]) => [id, `${w}-${l}-${d}`] as const));
}

export function describeResult(table: number | null, kind: Entry, p1: string, p2: string): string {
  const t = table === null ? "Bye" : `Table ${table}`;
  if (kind === "p1") return `${t} · ${p1} beats ${p2}.`;
  if (kind === "p2") return `${t} · ${p2} beats ${p1}.`;
  if (kind === "draw") return `${t} · ${p1} and ${p2} draw.`;
  if (kind === "double_loss") return `${t} · ${p1} and ${p2} double loss.`;
  return `${t} cleared`;
}
export const winnerText = (m: Match, p1: string, p2: string) =>
  m.result === "p1" ? `${p1} wins` : m.result === "p2" ? `${p2} wins` : m.result === "draw" ? "a draw" : m.result === "double_loss" ? "a double loss" : "no result";

export function formatClock(ms: number) {
  const total = Math.floor(Math.abs(ms) / 1000);
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
export function clockLabel(ms: number) {
  const total = Math.floor(Math.abs(ms) / 1000);
  return `${Math.floor(total / 60)} minutes ${total % 60} seconds ${ms < 0 ? "over" : "left"}`;
}

export function roundStats(state: EventState, round: Round | undefined) {
  const matches = round?.matches ?? [];
  const counted = matches.filter(m => !(m.p2 === null));
  const unreported = matches.filter(m => m.result === null).length;
  return { total: matches.length, counted: counted.length, unreported, reported: matches.length - unreported };
}
export const allResultsIn = (state: EventState) => state.rounds.every(r => r.matches.every(m => m.result !== null));
export const hasEnteredResult = (round: Round | undefined) => !!round && round.matches.some(m => m.p2 !== null && m.result !== null);
export const formatLabel = (state: EventState) => state.settings.format === "swiss" ? "Swiss" : "Single elimination";
export const roundTitle = (r: Round) => r.stage === "playoff" ? `Round ${r.number} (Playoffs)` : `Round ${r.number}`;

export function pendingReport(m: Match, names: (id: string) => string): { text: string; disagree: boolean } | null {
  if (m.result !== null || m.reports.length === 0 || m.p2 === null) return null;
  const p1 = names(m.p1), p2 = names(m.p2);
  if (m.reports.length >= 2 && m.reports[0]!.result !== m.reports[1]!.result) return { text: "Player reports disagree", disagree: true };
  const r = m.reports[0]!;
  return { text: `${names(r.by)} reported ${winnerText({ ...m, result: r.result }, p1, p2)}`, disagree: false };
}

/** Temporary member IDs live at 9988000000 and up; pick one nobody holds yet. */
export function nextTempId(players: readonly Player[]) {
  const used = new Set(players.map(p => p.memberId).filter((v): v is string => v !== null));
  let n = 9988000001;
  while (used.has(String(n))) n++;
  return String(n);
}

export function standingsThrough(state: EventState, standingsFn: (s: EventState) => Standing[], through: number) {
  return standingsFn({ ...state, rounds: state.rounds.filter(r => r.number <= through) });
}
export function statusText(p: Player) {
  if (p.status === "dropped") return `Dropped R${p.droppedAfterRound ?? 0}`;
  if (p.status === "cut") return "Cut";
  return p.checkedIn ? "Checked in" : "Not checked in";
}

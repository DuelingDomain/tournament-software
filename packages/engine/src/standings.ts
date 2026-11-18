import { competitors, teamSize } from "./competitors.js";
import type { EventState, Match, Standing } from "./types.js";

export function matchPoints(result: Match["result"]): [number, number] {
  switch (result) {
    case "p1": case "bye_win": return [3, 0];
    case "p2": return [0, 3];
    case "draw": return [1, 1];
    default: return [0, 0];
  }
}

interface RecordStats {
  points: number;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  opponents: string[];
}

function swissStats(state: EventState, through: number): Map<string, RecordStats> {
  const stats = new Map<string, RecordStats>(competitors(state).map(p => [p.id, { points: 0, played: 0, wins: 0, losses: 0, draws: 0, opponents: [] }]));
  for (const round of state.rounds) {
    if (round.number > through || (round.stage === "playoff" && state.settings.format !== "single_elim")) continue;
    for (const m of round.matches) {
      const points = matchPoints(m.result);
      for (const [index, id] of [m.p1, m.p2].entries()) {
        if (id === null) continue;
        const s = stats.get(id);
        if (!s) continue;
        s.points += points[index];
        s.played++;
        if (points[index] === 3) s.wins++;
        else if (m.result === "draw") s.draws++;
        else if (m.result !== null) s.losses++;
        const opponent = index === 0 ? m.p2 : m.p1;
        if (opponent !== null) s.opponents.push(opponent);
      }
    }
  }
  return stats;
}

function percent(fraction: number): number {
  // Truncate a fraction to thousandths, then display as percent with one decimal.
  return Math.min(999, Math.floor(fraction * 1000 + 1e-10)) / 10;
}

export function winner(match: Match): string | null {
  if (match.result === "p1" || match.result === "bye_win") return match.p1;
  if (match.result === "p2") return match.p2;
  return null;
}

function playoffFinishes(state: EventState): Map<string, number> {
  const finishes = new Map<string, number>();
  const rounds = state.rounds.filter(r => r.stage === "playoff");
  for (const round of rounds) {
    for (const m of round.matches) {
      const won = winner(m);
      if (won && m.p2 !== null) finishes.set(won === m.p1 ? m.p2 : m.p1, round.matches.length + 1);
    }
    if (round.matches.length === 1) {
      const won = winner(round.matches[0]);
      if (won) finishes.set(won, 1);
    }
  }
  return finishes;
}

export function encodedPoints(row: Pick<Standing, "matchPoints" | "omw" | "oomw">): number {
  return row.matchPoints * 1_000_000 + Math.round(row.omw * 10) * 1_000 + Math.round(row.oomw * 10);
}

export function cutoffTies(rows: readonly Standing[], size: number): { start: number; end: number } | null {
  const cutoff = rows[size - 1], next = rows[size];
  if (!cutoff || !next || encodedPoints(cutoff) !== encodedPoints(next)) return null;
  const points = encodedPoints(cutoff);
  let start = size - 1;
  let end = size + 1;
  while (start > 0 && encodedPoints(rows[start - 1]) === points) start--;
  while (end < rows.length && encodedPoints(rows[end]) === points) end++;
  return { start, end };
}

export function playoffWins(state: EventState, throughRound: number): Map<string, number> {
  const wins = new Map<string, number>();
  if (state.settings.format === "single_elim") return wins;
  for (const round of state.rounds) {
    if (round.stage !== "playoff" || round.number > throughRound) continue;
    for (const match of round.matches) {
      const won = winner(match);
      if (won !== null) wins.set(won, (wins.get(won) ?? 0) + 1);
    }
  }
  return wins;
}

export function compareStandings(a: Standing, b: Standing, wins?: ReadonlyMap<string, number>): number {
  return (b.openDuelingPoints ?? 0) - (a.openDuelingPoints ?? 0)
    || (wins?.get(b.playerId) ?? 0) - (wins?.get(a.playerId) ?? 0)
    || encodedPoints(b) - encodedPoints(a);
}

function cutRounds(state: EventState): Map<string, number> {
  const cut = new Map<string, number>();
  for (const swissCut of state.swissCuts) {
    for (const id of swissCut.cutPlayers) cut.set(id, swissCut.afterRound);
  }
  const bracket = state.rounds.filter(r => r.stage === "playoff");
  const seeded = new Set(state.cut);
  if (bracket[0]) {
    for (const p of competitors(state)) if (!seeded.has(p.id) && !cut.has(p.id)) cut.set(p.id, bracket[0].number - 1);
    for (const round of bracket) {
      for (const m of round.matches) {
        const won = winner(m);
        if (won !== null && m.p2 !== null) cut.set(won === m.p1 ? m.p2 : m.p1, round.number);
      }
    }
  }
  return cut;
}

export interface StandingsOptions {
  throughRound?: number;
  includeDropped?: boolean;
}

export function lastReportedRound(state: EventState): number {
  const pending = state.rounds.find(round => round.matches.some(match => match.result === null));
  return pending ? pending.number - 1 : state.rounds.at(-1)?.number ?? 0;
}

export function standings(state: EventState, options: StandingsOptions = {}): Standing[] {
  const throughRound = options.throughRound ?? lastReportedRound(state);
  const stats = swissStats(state, throughRound);
  const pooled = new Map<string, { numerator: number; denominator: number }>();
  const omw = new Map<string, number>();
  const legacy = state.settings.tiebreak === "legacy";
  const pooledPercent = (numerator: number, denominator: number) =>
    denominator ? Math.min(999, Math.floor(numerator * 1000 / denominator)) / 10 : 0;
  for (const [id, s] of stats) {
    let numerator = 0, denominator = 0, floored = 0;
    for (const opponent of s.opponents) {
      const o = stats.get(opponent);
      if (!o) continue;
      numerator += o.points;
      denominator += o.played * 3;
      floored += Math.max(1 / 3, o.played ? o.points / (o.played * 3) : 0);
    }
    pooled.set(id, { numerator, denominator });
    if (!legacy) omw.set(id, s.opponents.length ? floored / s.opponents.length : 0);
  }
  const wins = playoffWins(state, throughRound);
  const finishes = playoffFinishes({ ...state, rounds: state.rounds.filter(r => r.number <= throughRound) });
  const cuts = options.includeDropped === false ? cutRounds(state) : new Map<string, number>();
  const rows: Standing[] = competitors(state).filter(p => {
    if (options.includeDropped !== false || p.status === "active") return true;
    if (p.status === "cut") return (p.droppedAfterRound ?? cuts.get(p.id) ?? -1) >= throughRound;
    return (p.droppedAfterRound ?? -1) > throughRound;
  }).map(p => {
    const s = stats.get(p.id)!;
    let numerator = 0, denominator = 0, floored = 0;
    for (const opponent of s.opponents) {
      const pool = pooled.get(opponent);
      numerator += pool?.numerator ?? 0;
      denominator += pool?.denominator ?? 0;
      floored += Math.max(1 / 3, omw.get(opponent) ?? 0);
    }
    const pool = pooled.get(p.id)!;
    return {
      rank: 0, playerId: p.id, name: p.name, status: p.status,
      openDuelingPoints: p.openDuelingPoints ?? 0,
      matchPoints: s.points,
      record: { wins: s.wins, losses: s.losses, draws: s.draws },
      omw: legacy ? pooledPercent(pool.numerator, pool.denominator) : percent(omw.get(p.id) ?? 0),
      oomw: legacy ? pooledPercent(numerator, denominator) : percent(s.opponents.length ? floored / s.opponents.length : 0),
      playoffFinish: finishes.get(p.id) ?? null,
    };
  });
  rows.sort((a, b) => compareStandings(a, b, wins));
  rows.forEach((row, i) => {
    const previous = rows[i - 1];
    const tied = previous && (teamSize(state) === 1
      ? compareStandings(previous, row, wins) === 0
      : encodedPoints(previous) === encodedPoints(row));
    row.rank = tied ? previous.rank : i + 1;
  });
  return rows;
}

/** One round for at most two entrants; otherwise the ceiling of log2(n). */
export function suggestRounds(playerCount: number): number {
  return playerCount <= 2 ? 1 : Math.ceil(Math.log2(playerCount));
}

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
  const stats = new Map<string, RecordStats>(state.players.map(p => [p.id, { points: 0, played: 0, wins: 0, losses: 0, draws: 0, opponents: [] }]));
  for (const round of state.rounds) {
    if (round.stage !== "swiss" || round.number > through) continue;
    for (const m of round.matches) {
      if (m.result === null) continue;
      const points = matchPoints(m.result);
      for (const [index, id] of [m.p1, m.p2].entries()) {
        if (id === null) continue;
        const s = stats.get(id);
        if (!s) continue;
        s.points += points[index];
        s.played++;
        if (points[index] === 3) s.wins++;
        else if (m.result === "draw") s.draws++;
        else s.losses++;
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

/** Compare only published ranking keys; equal keys share a rank. Unfinished cut
 * players precede eliminated players, and all cut participants precede non-cut players. */
export function compareStandings(a: Standing, b: Standing, cut: ReadonlySet<string>): number {
  if (cut.has(a.playerId) !== cut.has(b.playerId)) return cut.has(a.playerId) ? -1 : 1;
  if (cut.has(a.playerId)) {
    const finish = (a.playoffFinish ?? 0) - (b.playoffFinish ?? 0);
    if (finish) return finish;
  }
  return b.matchPoints - a.matchPoints || b.omw - a.omw || b.oomw - a.oomw;
}

export function standings(state: EventState): Standing[] {
  const full = swissStats(state, Infinity);
  const unfinished = state.rounds.find(r => r.stage === "swiss" && r.matches.some(m => m.result === null));
  const stats = swissStats(state, unfinished ? unfinished.number - 1 : Infinity);
  const pooled = new Map<string, { numerator: number; denominator: number }>();
  const omw = new Map<string, number>();
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
    omw.set(id, state.settings.tiebreak === "legacy"
      ? (denominator ? numerator / denominator : 0)
      : (s.opponents.length ? floored / s.opponents.length : 0));
  }
  const finishes = playoffFinishes(state);
  const rows: Standing[] = state.players.map(p => {
    const s = stats.get(p.id);
    const record = full.get(p.id);
    let numerator = 0, denominator = 0, floored = 0;
    for (const opponent of s?.opponents ?? []) {
      const pool = pooled.get(opponent);
      numerator += pool?.numerator ?? 0;
      denominator += pool?.denominator ?? 0;
      floored += Math.max(1 / 3, omw.get(opponent) ?? 0);
    }
    // Legacy OOMW(i) = sum_{j in Opp(i)} sum_{k in Opp(j)} MP(k)
    //                  / (3 * sum_{j in Opp(i)} sum_{k in Opp(j)} played(k)).
    // Lists retain repeats at BOTH levels. No intermediate truncation/floor.
    // floor33 instead averages max(1/3, raw floor33 OMW(j)) over Opp(i).
    const oomw = state.settings.tiebreak === "legacy"
      ? (denominator ? numerator / denominator : 0)
      : (s?.opponents.length ? floored / s.opponents.length : 0);
    return {
      rank: 0, playerId: p.id, name: p.name, status: p.status,
      matchPoints: record?.points ?? 0,
      record: { wins: record?.wins ?? 0, losses: record?.losses ?? 0, draws: record?.draws ?? 0 },
      omw: percent(omw.get(p.id) ?? 0), oomw: percent(oomw),
      playoffFinish: finishes.get(p.id) ?? null,
    };
  });
  const cut = new Set(state.cut);
  rows.sort((a, b) => compareStandings(a, b, cut));
  rows.forEach((row, i) => { row.rank = i && compareStandings(rows[i - 1], row, cut) === 0 ? rows[i - 1].rank : i + 1; });
  return rows;
}

/** One round for at most two entrants; otherwise the ceiling of log2(n). */
export function suggestRounds(playerCount: number): number {
  return playerCount <= 2 ? 1 : Math.ceil(Math.log2(playerCount));
}

import { CommandError, type EventState, type Match, type Player, type Round } from "./types.js";
import { randomId, shuffle } from "./rng.js";
import { standings } from "./standings.js";

/** Edmonds' augmenting-path algorithm. Blossom contraction makes feasibility exact
 * even for odd cycles: failure here proves that a rematch-free perfect matching
 * does not exist. Neighbours are visited in increasing points-gap order. */
function maximumMatching(graph: number[][]): number[] {
  const n = graph.length;
  const mate = Array<number>(n).fill(-1);
  const parent = Array<number>(n).fill(-1);
  const base = Array.from({ length: n }, (_, i) => i);
  const used = Array<boolean>(n).fill(false);
  const blossom = Array<boolean>(n).fill(false);
  function ancestor(a: number, b: number): number {
    const seen = Array<boolean>(n).fill(false);
    while (true) {
      a = base[a]; seen[a] = true;
      if (mate[a] === -1) break;
      a = parent[mate[a]];
    }
    while (!seen[base[b]]) b = parent[mate[base[b]]];
    return base[b];
  }
  function mark(v: number, root: number, child: number) {
    while (base[v] !== root) {
      blossom[base[v]] = blossom[base[mate[v]]] = true;
      parent[v] = child;
      child = mate[v];
      v = parent[mate[v]];
    }
  }
  function augment(root: number): boolean {
    used.fill(false); parent.fill(-1);
    base.forEach((_, i) => { base[i] = i; });
    const queue = [root]; used[root] = true;
    for (let head = 0; head < queue.length; head++) {
      const v = queue[head];
      for (const u of graph[v]) {
        if (base[v] === base[u] || mate[v] === u) continue;
        if (u === root || (mate[u] !== -1 && parent[mate[u]] !== -1)) {
          const common = ancestor(v, u);
          blossom.fill(false); mark(v, common, u); mark(u, common, v);
          for (let i = 0; i < n; i++) {
            if (!blossom[base[i]]) continue;
            base[i] = common;
            if (!used[i]) { used[i] = true; queue.push(i); }
          }
        } else if (parent[u] === -1) {
          parent[u] = v;
          if (mate[u] === -1) {
            let end = u;
            while (end !== -1) {
              const prev = parent[end], next = prev === -1 ? -1 : mate[prev];
              mate[end] = prev;
              if (prev !== -1) mate[prev] = end;
              end = next;
            }
            return true;
          }
          const next = mate[u];
          used[next] = true; queue.push(next);
        }
      }
    }
    return false;
  }
  for (let i = 0; i < n; i++) if (mate[i] === -1) augment(i);
  return mate;
}

type Pair = [number, number];

function orderedPairs(mates: number[]): Pair[] {
  return mates.flatMap((m, i): Pair[] => m > i ? [[i, m]] : []);
}

/** Search the points-ordered list with the unconstrained adjacent-pair cost as an
 * admissible lower bound. Usually the very first solution attains that bound.
 * Cap optimization work on large fields; exact blossom feasibility is never capped. */
function minimizeGaps(graph: number[][], points: number[], initial: Pair[]): Pair[] {
  const n = points.length;
  const available = Array<boolean>(n).fill(true);
  const gap = (a: number, b: number) => Math.abs(points[a] - points[b]);
  let best = initial, cost = initial.reduce((sum, [a, b]) => sum + gap(a, b), 0);
  let budget = n <= 18 ? Infinity : 6000;
  const path: Pair[] = [];
  function search(spent: number) {
    if (--budget < 0) return;
    let first = -1, previous = -1, bound = 0;
    for (let i = 0; i < n; i++) {
      if (!available[i]) continue;
      if (first === -1) first = i;
      if (previous === -1) previous = i;
      else { bound += gap(previous, i); previous = -1; }
    }
    if (spent + bound >= cost) return;
    if (first === -1) { best = [...path]; cost = spent; return; }
    available[first] = false;
    for (const other of graph[first]) {
      if (!available[other]) continue;
      available[other] = false; path.push([first, other]);
      search(spent + gap(first, other));
      path.pop(); available[other] = true;
      if (budget < 0 || spent + bound >= cost) break;
    }
    available[first] = true;
  }
  search(0);
  return best.sort((a, b) => a[0] - b[0]);
}

export function assignTables(matches: Match[], players: Player[], startingTable: number, fixed = true): void {
  const byId = new Map(players.map(p => [p.id, p]));
  const reserved = new Set<number>();
  for (const m of matches) {
    m.table = null;
    if (m.p2 === null) continue;
    const a = fixed ? byId.get(m.p1)?.fixedTable : null;
    const b = fixed ? byId.get(m.p2)?.fixedTable : null;
    if (a != null && b != null && a !== b) throw new CommandError("FIXED_TABLE_CONFLICT", "These players require different fixed tables and cannot play each other.");
    const table = a ?? b;
    if (table != null) {
      if (reserved.has(table)) throw new CommandError("FIXED_TABLE_CONFLICT", `More than one match requires table ${table}.`);
      reserved.add(table); m.table = table;
    }
  }
  let table = startingTable;
  for (const m of matches) {
    if (m.p2 === null || m.table !== null) continue;
    while (reserved.has(table)) table++;
    m.table = table; reserved.add(table++);
  }
}

export function makeMatch(p1: string, p2: string | null, number: number, random: () => number, ids: Set<string>, bye: "bye_win" | "bye_loss" = "bye_win"): Match {
  return { id: randomId(random, ids), round: number, table: null, p1, p2,
    result: p2 === null ? bye : null, reports: [], extensionMinutes: 0 };
}

export function pairSwiss(state: EventState, number: number, seed: number, random: () => number, ids: Set<string>): Round {
  const rows = standings(state);
  const scores = new Map(rows.map(s => [s.playerId, s.matchPoints]));
  const active = state.players.filter(p => p.status === "active");
  const groups = new Map<number, Player[]>();
  for (const p of active) {
    const points = scores.get(p.id) ?? 0;
    groups.set(points, [...(groups.get(points) ?? []), p]);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => b - a).flatMap(([, ps]) => shuffle(ps, random));
  const met = new Map(state.players.map(p => [p.id, new Set<string>()]));
  const byes = new Set<string>();
  for (const r of state.rounds.filter(r => r.stage === "swiss")) for (const m of r.matches) {
    if (m.p2 !== null) { met.get(m.p1)?.add(m.p2); met.get(m.p2)?.add(m.p1); }
    else if (m.result === "bye_win") byes.add(m.p1);
  }
  const warnings: string[] = [];
  let byeOptions: (Player | null)[] = [null];
  if (ordered.length % 2) {
    const eligible = ordered.filter(p => !byes.has(p.id));
    const pool = eligible.length ? eligible : ordered;
    const lowest = Math.min(...pool.map(p => scores.get(p.id) ?? 0));
    byeOptions = pool.filter(p => scores.get(p.id) === lowest).reverse();
  }
  let selected: { players: Player[]; pairs: Pair[]; bye: Player | null; rematches: number } | undefined;
  for (const bye of byeOptions) {
    const players = ordered.filter(p => p.id !== bye?.id);
    const points = players.map(p => scores.get(p.id) ?? 0);
    const fixedCounts = new Map<number, number>();
    for (const p of players) if (p.fixedTable !== null) fixedCounts.set(p.fixedTable, (fixedCounts.get(p.fixedTable) ?? 0) + 1);
    const compatible = (a: number, b: number) => {
      const x = players[a].fixedTable, y = players[b].fixedTable;
      // Two occupants of the same fixed table must face one another.
      return (x === null || y === null || x === y)
        && !(x !== null && (fixedCounts.get(x) ?? 0) > (x === y ? 2 : 1))
        && !(y !== null && (fixedCounts.get(y) ?? 0) > (x === y ? 2 : 1));
    };
    const graph = players.map((p, a) => players.flatMap((q, b) => a !== b && compatible(a, b) && !met.get(p.id)?.has(q.id) ? [b] : [])
      .sort((b, c) => Math.abs(points[a] - points[b]) - Math.abs(points[a] - points[c]) || b - c));
    let pairs = orderedPairs(maximumMatching(graph));
    let rematches = players.length / 2 - pairs.length;
    if (rematches === 0) pairs = minimizeGaps(graph, points, pairs);
    else {
      const all = players.map((_, a) => players.flatMap((__, b) => a !== b && compatible(a, b) ? [b] : [])
        .sort((b, c) => Number(met.get(players[a].id)?.has(players[b].id)) - Number(met.get(players[a].id)?.has(players[c].id)) || Math.abs(points[a] - points[b]) - Math.abs(points[a] - points[c]) || b - c));
      // Keep the maximum rematch-free matching when its leftovers are compatible.
      const used = new Set(pairs.flat());
      const rest = players.map((_, i) => i).filter(i => !used.has(i));
      if (rest.every((v, i) => i % 2 || compatible(v, rest[i + 1]))) {
        for (let i = 0; i < rest.length; i += 2) pairs.push([rest[i], rest[i + 1]]);
      } else pairs = orderedPairs(maximumMatching(all));
      if (pairs.length * 2 !== players.length) continue;
      rematches = pairs.filter(([a, b]) => met.get(players[a].id)?.has(players[b].id)).length;
    }
    if (!selected || rematches < selected.rematches) selected = { players, pairs, bye, rematches };
    if (rematches === 0) break;
  }
  if (!selected) throw new CommandError("FIXED_TABLE_CONFLICT", "The active players cannot be paired while honoring their fixed tables.");
  if (selected.rematches) warnings.push("A rematch could not be avoided among the eligible players and fixed tables.");
  if (selected.bye && byes.has(selected.bye.id)) warnings.push("Every active player has already received a bye; a repeat bye was necessary.");
  const matches = selected.pairs.sort((a, b) => a[0] - b[0]).map(([a, b]) => makeMatch(selected.players[a].id, selected.players[b].id, number, random, ids));
  if (selected.bye) matches.push(makeMatch(selected.bye.id, null, number, random, ids));
  assignTables(matches, state.players, state.settings.startingTable);
  return { number, stage: "swiss", seed, startedAt: null, endsAt: null, matches, warnings };
}

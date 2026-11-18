import { competitors, teamSize } from "./competitors.js";
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

function adjacentPairs(count: number): Pair[] {
  return Array.from({ length: Math.floor(count / 2) }, (_, i) => [2 * i, 2 * i + 1]);
}

function repairRematches(order: Player[], score: (p: Player) => number, met: Map<string, Set<string>>, round: number): Player[] | null {
  const original = [...order];
  const firstRepeat = () => {
    for (let i = 0; i + 1 < order.length; i += 2) {
      if (met.get(order[i].id)?.has(order[i + 1].id)) return i;
    }
    return -1;
  };
  let repeat = firstRepeat();
  let budget = 30_000;
  while (repeat !== -1) {
    const target = repeat;
    const points = score(order[target]);
    const visited = new Set([target]);
    const rotate = (eligible: number[], remaining: number): boolean => {
      if (remaining === 0) {
        repeat = firstRepeat();
        return repeat === -1 || repeat > target;
      }
      for (const i of eligible) {
        if (--budget < 0) return false;
        if (visited.has(i)) continue;
        visited.add(i);
        [order[target], order[i]] = [order[i], order[target]];
        if (rotate(eligible, remaining - 1)) return true;
        [order[target], order[i]] = [order[i], order[target]];
        visited.delete(i);
      }
      return false;
    };
    let repaired = false;
    for (let spread = 0; spread < round * 6 && !repaired; spread++) {
      const min = points - Math.floor(spread / 2);
      const max = points + Math.ceil(spread / 2);
      const eligible = order.flatMap((p, i) => i !== target && score(p) >= min && score(p) <= max ? [i] : []);
      for (let length = 1; length <= eligible.length && !repaired; length++) {
        if (length > 8 || budget < 0) return null;
        repaired = rotate(eligible, length);
      }
    }
    if (!repaired) return original;
  }
  return order;
}

function fixedSeatsFit(order: Player[], width: number): boolean {
  const reserved = new Set<number>();
  for (let i = 0; i < order.length; i += 2) {
    const a = order[i].fixedTable, b = order[i + 1]?.fixedTable ?? null;
    if (a !== null && b !== null && a !== b) return false;
    const table = a ?? b;
    if (table === null) continue;
    for (let seat = table; seat < table + width; seat++) {
      if (reserved.has(seat)) return false;
      reserved.add(seat);
    }
  }
  return true;
}

export function assignTables(matches: Match[], players: Player[], startingTable: number, fixed = true, width = 1): void {
  const byId = new Map(players.map(p => [p.id, p]));
  const reserved = new Set<number>();
  for (const m of matches) {
    m.table = null;
    delete m.byeTable;
    const a = fixed ? byId.get(m.p1)?.fixedTable : null;
    const b = fixed && m.p2 !== null ? byId.get(m.p2)?.fixedTable : null;
    if (a != null && b != null && a !== b) throw new CommandError("FIXED_TABLE_CONFLICT", "These players require different fixed tables and cannot play each other.");
    const table = a ?? b;
    if (table != null) {
      if (Array.from({ length: width }, (_, i) => table + i).some(t => reserved.has(t))) throw new CommandError("FIXED_TABLE_CONFLICT", `More than one match requires table ${table}.`);
      for (let i = 0; i < width; i++) reserved.add(table + i);
      if (m.p2 === null) m.byeTable = table;
      else m.table = table;
    }
  }
  let table = startingTable;
  for (const m of matches) {
    if (m.byeTable !== undefined || m.table !== null) continue;
    while (Array.from({ length: width }, (_, i) => table + i).some(t => reserved.has(t))) table++;
    if (m.p2 === null) m.byeTable = table;
    else m.table = table;
    for (let i = 0; i < width; i++) reserved.add(table + i);
    table += width;
  }
}

export function makeMatch(p1: string, p2: string | null, number: number, random: () => number, ids: Set<string>, bye: "bye_win" | "bye_loss" = "bye_win"): Match {
  return { id: randomId(random, ids), round: number, table: null, p1, p2,
    result: p2 === null ? bye : null, reports: [], extensionMinutes: 0 };
}

export function pairSwiss(state: EventState, number: number, seed: number, random: () => number, ids: Set<string>): Round {
  const field = competitors(state);
  const byId = new Map(field.map(p => [p.id, p]));
  const rows = standings(state).filter(row => row.status === "active");
  const scores = new Map(rows.map(s => [s.playerId, s.matchPoints]));
  const score = (p: Player) => scores.get(p.id) ?? 0;
  const met = new Map(field.map(p => [p.id, new Set<string>()]));
  const byes = new Set<string>();
  for (const r of state.rounds.filter(r => r.number < number)) for (const m of r.matches) {
    if (m.p2 !== null) {
      met.get(m.p1)?.add(m.p2);
      met.get(m.p2)?.add(m.p1);
    } else byes.add(m.p1);
  }
  const groups = new Map<number, Player[]>();
  for (const row of rows) {
    const group = groups.get(row.matchPoints) ?? [];
    group.push(byId.get(row.playerId)!);
    groups.set(row.matchPoints, group);
  }
  const ordered = [...groups].sort(([a], [b]) => b - a).flatMap(([, players]) => {
    const group = shuffle(players, random);
    let destination = group.length - 3;
    for (let i = destination - 1; i >= 0 && destination < group.length; i--) {
      if (byes.has(group[i].id)) continue;
      [group[destination], group[i]] = [group[i], group[destination]];
      destination++;
    }
    return group;
  });
  const width = teamSize(state);
  const finalOrder = repairRematches([...ordered], score, met, number);
  const warnings: string[] = [];
  const finish = (players: Player[], pairs: Pair[], bye: Player | null) => {
    if (pairs.some(([a, b]) => met.get(players[a].id)?.has(players[b].id))) {
      warnings.push("A rematch occurred in the generated pairings.");
    }
    if (bye && byes.has(bye.id)) warnings.push("A player has received a repeat bye.");
    const matches = pairs.map(([a, b]) => makeMatch(players[a].id, players[b].id, number, random, ids));
    if (bye) matches.push(makeMatch(bye.id, null, number, random, ids));
    assignTables(matches, field, state.settings.startingTable, true, width);
    return { number, stage: "swiss" as const, seed, startedAt: null, endsAt: null, matches, warnings };
  };
  if (finalOrder && fixedSeatsFit(finalOrder, width)) {
    return finish(finalOrder, adjacentPairs(finalOrder.length), finalOrder.length % 2 ? finalOrder.at(-1)! : null);
  }

  // Use polynomial matching when the rotation search hits its work limit or
  // the proposed pairs cannot share tables without conflicting reservations.
  const byeOptions = ordered.length % 2 ? [...ordered].reverse() : [null];
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
    if (rematches !== 0) {
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
    if (!fixedSeatsFit([...pairs.flat().map(i => players[i]), ...(bye ? [bye] : [])], width)) continue;
    if (!selected || rematches < selected.rematches) selected = { players, pairs, bye, rematches };
    if (rematches === 0) break;
  }
  if (!selected) throw new CommandError("FIXED_TABLE_CONFLICT", "The active players cannot be paired while honoring their fixed tables.");
  return finish(selected.players, selected.pairs.sort((a, b) => a[0] - b[0]), selected.bye);
}

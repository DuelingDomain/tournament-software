import { describe, expect, it } from "vitest";
import { applyCommand, standings, type EventState, type MatchResult } from "../../src/index.js";
import { context, event, fixture, run } from "./fixtures.js";

// Independent small LCG for generated fixtures; the oracle never uses engine RNG/matching.
function generator(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
}

function opponents(s: EventState): Set<string> {
  return new Set(s.rounds.filter(r => r.stage === "swiss").flatMap(r => r.matches.flatMap(m => m.p2 === null ? [] : [key(m.p1, m.p2)])));
}
function key(a: string, b: string): string { return [a, b].sort().join(":"); }

function possible(ids: string[], met: Set<string>): boolean {
  if (!ids.length) return true;
  for (let i = 1; i < ids.length; i++) {
    if (!met.has(key(ids[0], ids[i])) && possible(ids.slice(1).filter((_, j) => j !== i - 1), met)) return true;
  }
  return false;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

describe("Swiss pairing properties", () => {
  it("pairs neighbours within score groups, pairs odd groups down and reserves fixed tables", () => {
    let s = fixture([[[0, null, "bye_win"], [1, null, "bye_win"], [2, null, "bye_win"], [3, null, "bye_loss"], [4, null, "bye_loss"], [5, null, "bye_loss"]]], 6, { startingTable: 7 });
    s = run(s, { type: "UpdatePlayer", playerId: s.players[0].id, fixedTable: 8 });
    const next = run(s, { type: "PairNextRound" }, 1);
    const points = new Map(standings(s).map(r => [r.playerId, r.matchPoints]));
    const matches = next.rounds[1].matches;
    expect(matches.filter(m => points.get(m.p1) !== points.get(m.p2!))).toHaveLength(1);
    expect(matches.find(m => m.p1 === s.players[0].id || m.p2 === s.players[0].id)?.table).toBe(8);
    expect(matches.map(m => m.table).sort()).toEqual([7, 8, 9]);
    expect(points.get(matches[0].p1)).toBe(3);
  });

  it("pairs the two occupants of a fixed table together and rejects impossible seats", () => {
    let s = event(6);
    for (const i of [0, 1]) s = run(s, { type: "UpdatePlayer", playerId: s.players[i].id, fixedTable: 12 });
    const paired = run(s, { type: "PairNextRound" });
    expect(paired.rounds[0].matches.find(m => m.table === 12)).toMatchObject({ p1: expect.any(String), p2: expect.any(String) });
    expect(paired.rounds[0].matches.find(m => m.table === 12)).toSatisfy((m: { p1: string; p2: string }) => [m.p1, m.p2].every(id => s.players.slice(0, 2).some(p => p.id === id)));
    s = run(s, { type: "UpdatePlayer", playerId: s.players[2].id, fixedTable: 12 });
    expect(() => run(s, { type: "PairNextRound" })).toThrow(/fixed tables/);
  });

  it("gives the bye to the final player in score order even after a previous bye", () => {
    const s = fixture([[[0, null, "bye_loss"], [1, null, "bye_win"], [2, null, "bye_win"], [3, null, "bye_win"], [4, null, "bye_win"]]], 5);
    const next = run(s, { type: "PairNextRound" });
    const bye = next.rounds[1].matches.find(m => m.p2 === null)!;
    expect(bye.p1).toBe(s.players[0].id);
    expect(bye.result).toBe("bye_win");
    expect(bye.table).toBeNull();
    expect(bye.byeTable).toBe(3);
  });

  it("warns when the resulting round has a rematch or a repeat bye", () => {
    const s = fixture([[[0, 1, "draw"], [2, null, "bye_win"]], [[0, 2, "draw"], [1, null, "bye_win"]], [[1, 2, "draw"], [0, null, "bye_win"]]], 3);
    const next = run(s, { type: "PairNextRound" });
    expect(next.rounds[3].warnings).toEqual([expect.stringContaining("rematch"), expect.stringContaining("repeat bye")]);
  });

  it("finds a rematch-free perfect matching whenever the exhaustive small-field oracle does", () => {
    for (let seed = 1; seed <= 220; seed++) {
      const random = generator(seed);
      const n = 4 + seed % 7;
      const rounds = Array.from({ length: seed % 11 }, () => {
        const ids = Array.from({ length: n }, (_, i) => i);
        for (let i = n - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
        const matches: [number, number | null, MatchResult][] = [];
        for (let i = 0; i < n; i += 2) matches.push([ids[i], ids[i + 1] ?? null, i + 1 >= n ? "bye_win" : random() < 0.5 ? "p1" : "draw"]);
        return matches;
      });
      const s = fixture(rounds, n);
      const met = opponents(s);
      const ids = s.players.map(p => p.id);
      const exists = n % 2 ? ids.some(bye => possible(ids.filter(id => id !== bye), met)) : possible(ids, met);
      const paired = run(s, { type: "PairNextRound" }, seed).rounds.at(-1)!;
      const repeated = paired.matches.filter(m => m.p2 !== null && met.has(key(m.p1, m.p2)));
      if (exists) expect(repeated, `seed ${seed}`).toHaveLength(0);
      else expect(paired.warnings.some(w => w.includes("rematch")), `seed ${seed}`).toBe(true);
    }
  });

  it("covers 4..512-player fields over eight rounds with random results and drops", () => {
    for (const n of [4, 5, 6, 7, 8, 9, 10, 16, 31, 64, 127, 256, 511, 512]) {
      const random = generator(n);
      let s = event(n);
      // Distinct fixed seats exercise reservations across changing score groups.
      s = run(s, { type: "UpdatePlayer", playerId: s.players[0].id, fixedTable: 500 });
      s = run(s, { type: "UpdatePlayer", playerId: s.players[1].id, fixedTable: 501 });
      for (let round = 0; round < 8; round++) {
        if (round && s.players.filter(p => p.status === "active").length > 4 && random() < 0.8) {
          const pool = s.players.filter(p => p.status === "active");
          s = run(s, { type: "DropPlayer", playerId: pool[Math.floor(random() * pool.length)].id });
        }
        const active = s.players.filter(p => p.status === "active");
        const old = structuredClone(s);
        const paired = run(deepFreeze(s), { type: "PairNextRound" }, n * 100 + round);
        expect(s).toEqual(old);
        expect(paired).toEqual(run(s, { type: "PairNextRound" }, n * 100 + round));
        const current = paired.rounds.at(-1)!;
        const ids = current.matches.flatMap(m => m.p2 === null ? [m.p1] : [m.p1, m.p2]);
        expect([...ids].sort()).toEqual(active.map(p => p.id).sort());
        expect(new Set(ids).size).toBe(active.length);
        const tables = current.matches.filter(m => m.p2 !== null).map(m => m.table);
        expect(new Set(tables).size).toBe(tables.length);
        for (const p of active.filter(p => p.fixedTable !== null)) {
          const m = current.matches.find(m => m.p1 === p.id || m.p2 === p.id)!;
          if (m.p2 !== null) expect(m.table).toBe(p.fixedTable);
        }
        s = paired;
        for (const m of current.matches) if (m.result === null) m.result = random() < 0.15 ? "double_loss" : random() < 0.25 ? "draw" : random() < 0.5 ? "p1" : "p2";
      }
    }
  }, 20_000);

  it("pairs 512 players in less than one second", () => {
    const s = event(512);
    const start = performance.now();
    const paired = applyCommand(s, { type: "PairNextRound" }, context);
    const elapsed = performance.now() - start;
    expect(paired.rounds[0].matches).toHaveLength(256);
    expect(elapsed).toBeLessThan(1000);
  });
});

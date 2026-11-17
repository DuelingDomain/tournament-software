import { describe, expect, it } from "vitest";
import { CommandError, standings } from "../../src/index.js";
import { event, fixture, run, scoreAll } from "./fixtures.js";

describe("bracket golden fixtures", () => {
  it.each([
    [4, [[1, 4], [2, 3]]],
    [8, [[1, 8], [4, 5], [2, 7], [3, 6]]],
    [16, [[1, 16], [8, 9], [4, 13], [5, 12], [2, 15], [7, 10], [3, 14], [6, 11]]],
    [6, [[1, null], [4, 5], [2, null], [3, 6]]],
  ])("seeds a %i-player bracket in standard order", (n, expected) => {
    const s = run(event(n), { type: "CutToPlayoff", size: n });
    expect(s.rounds[0].matches.map(m => [s.cut.indexOf(m.p1) + 1, m.p2 === null ? null : s.cut.indexOf(m.p2) + 1])).toEqual(expected);
    expect(s.rounds[0].matches.filter(m => m.p2 === null).every(m => m.result === "bye_win" && m.table === null)).toBe(true);
  });

  it("breaks a tie across the cut reproducibly, with an exact full-tie override", () => {
    const s = event(8);
    const a = run(s, { type: "CutToPlayoff", size: 4 }, 123);
    expect(a).toEqual(run(s, { type: "CutToPlayoff", size: 4 }, 123));
    expect(a.cut).not.toEqual(run(s, { type: "CutToPlayoff", size: 4 }, 456).cut);
    const reverse = s.players.map(p => p.id).reverse();
    expect(run(s, { type: "CutToPlayoff", size: 4, tieOrder: reverse }).cut).toEqual(reverse.slice(0, 4));
    expect(() => run(s, { type: "CutToPlayoff", size: 4, tieOrder: reverse.slice(0, 4) })).toThrow(CommandError);
    expect(() => run(s, { type: "CutToPlayoff", size: 4, tieOrder: Array(8).fill(reverse[0]) })).toThrow(CommandError);
  });

  it("takes only active players and requires all Swiss results", () => {
    let s = fixture([[[0, 1, "p1"], [2, 3, null]]]);
    expect(() => run(s, { type: "CutToPlayoff", size: 2 })).toThrow(/outstanding result/);
    s = scoreAll(s); s = run(s, { type: "DropPlayer", playerId: s.players[0].id });
    const cut = run(s, { type: "CutToPlayoff", size: 2 });
    expect(cut.cut).not.toContain(s.players[0].id);
    expect(cut.players[0].status).toBe("dropped");
    expect(cut.players.filter(p => p.status === "cut")).toHaveLength(1);
  });

  it("advances adjacent winners, preserves bracket tables, and derives 1,2,3,5 finishes", () => {
    let s = run(event(8), { type: "CutToPlayoff", size: 8 });
    const first = s.rounds[0];
    expect(() => run(s, { type: "PairNextRound" })).toThrow(/outstanding result/);
    s = scoreAll(s); s = run(s, { type: "PairNextRound" });
    expect(s.rounds[1].matches.map(m => [m.p1, m.p2, m.table])).toEqual([
      [first.matches[0].p1, first.matches[1].p1, 1], [first.matches[2].p1, first.matches[3].p1, 2],
    ]);
    s = scoreAll(s); s = run(s, { type: "PairNextRound" }); s = scoreAll(s);
    expect(standings(s).map(r => r.playoffFinish)).toEqual([1, 2, 3, 3, 5, 5, 5, 5]);
    expect(s.phase).toBe("playoff");
    expect(() => run(s, { type: "PairNextRound" })).toThrow(/final is decided/);
    const complete = run(s, { type: "CompleteEvent" });
    expect(complete.phase).toBe("complete");
    expect(run(complete, { type: "ReopenEvent" }).phase).toBe("playoff");
  });

  it("cancels the first playoff round, restores the cut field and clears cut", () => {
    let s = fixture([[[0, 1, "p1"], [2, 3, "p1"]], [[0, 2, "p1"], [1, 3, "draw"]]]);
    s = run(s, { type: "CutToPlayoff", size: 2 }); s = scoreAll(s);
    s = run(s, { type: "CancelRound" });
    expect([s.phase, s.cut, s.rounds.length]).toEqual(["swiss", [], 2]);
    expect(s.players.every(p => p.status === "active")).toBe(true);
  });

  it("cancelling a later round preserves earlier eliminations", () => {
    let s = run(event(8), { type: "CutToPlayoff", size: 8 });
    const earlierLosers = s.rounds[0].matches.map(m => m.p2);
    s = scoreAll(s); s = run(s, { type: "PairNextRound" }); s = scoreAll(s);
    const cancelledLosers = s.rounds[1].matches.map(m => m.p2);
    s = run(s, { type: "CancelRound" });
    expect(s.players.filter(p => earlierLosers.includes(p.id)).every(p => p.status === "cut")).toBe(true);
    expect(s.players.filter(p => cancelledLosers.includes(p.id)).every(p => p.status === "active")).toBe(true);
    s = run(s, { type: "PairNextRound" });
    expect(s.rounds[1].matches.flatMap(m => [m.p1, m.p2]).some(id => earlierLosers.includes(id))).toBe(false);
  });

  it.each(["draw", "double_loss"] as const)("refuses playoff %s", result => {
    const s = run(event(), { type: "CutToPlayoff", size: 4 });
    expect(() => run(s, { type: "EnterResult", matchId: s.rounds[0].matches[0].id, result })).toThrow(/must have a winner/);
    expect(() => run(s, { type: "ReportResult", playerId: s.rounds[0].matches[0].p1, matchId: s.rounds[0].matches[0].id, result })).toThrow(/must have a winner/);
  });

  it("advances two adjacent auto-scored byes without aborting", () => {
    let s = run(event(5), { type: "CutToPlayoff", size: 5 });
    expect(s.rounds[0].matches.slice(2).map(m => m.result)).toEqual(["bye_win", "bye_win"]);
    s = scoreAll(s); s = run(s, { type: "PairNextRound" });
    expect(s.rounds[1].matches).toHaveLength(2);
    expect(s.rounds[1].matches[1].p1).toBe(s.cut[1]);
    expect(s.rounds[1].matches[1].p2).toBe(s.cut[2]);
  });

  it("starts single elimination with a reproducible random bracket and padded byes", () => {
    const source = event(6, { format: "single_elim", startingTable: 10 });
    const s = run(source, { type: "PairNextRound" }, 90);
    expect(s).toEqual(run(source, { type: "PairNextRound" }, 90));
    expect(s.cut).not.toEqual(source.players.map(p => p.id));
    expect(s.rounds[0].matches.filter(m => m.p2 === null).map(m => m.p1)).toEqual([s.cut[0], s.cut[1]]);
    expect(s.rounds[0].matches.filter(m => m.p2 !== null).map(m => m.table)).toEqual([10, 11]);
    expect(standings(s).every(r => r.matchPoints === 0)).toBe(true);
    expect(run(s, { type: "CancelRound" }).phase).toBe("registration");
  });

  it("repairs untouched playoff rounds using a new seed while preserving a Swiss cut's seeding", () => {
    let s = run(event(6), { type: "CutToPlayoff", size: 6 });
    const first = s.rounds[0].matches.map(m => [m.p1, m.p2]);
    s = run(s, { type: "RepairRound" }, 33);
    expect(s.rounds[0].seed).toBe(33);
    expect(s.rounds[0].matches.map(m => [m.p1, m.p2])).toEqual(first);
    s = run(scoreAll(s), { type: "PairNextRound" });
    const later = s.rounds[1].matches.map(m => [m.p1, m.p2]);
    s = run(s, { type: "RepairRound" }, 44);
    expect(s.rounds[1].matches.map(m => [m.p1, m.p2])).toEqual(later);
  });
});

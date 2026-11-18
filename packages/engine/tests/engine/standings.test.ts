import { describe, expect, it } from "vitest";
import { standings, suggestRounds } from "../../src/index.js";
import { event, fixture, run } from "./fixtures.js";

describe("hand-computed Swiss standings", () => {
  it.each([
    ["p1", [3, 0], [{ wins: 1, losses: 0, draws: 0 }, { wins: 0, losses: 1, draws: 0 }]],
    ["p2", [0, 3], [{ wins: 0, losses: 1, draws: 0 }, { wins: 1, losses: 0, draws: 0 }]],
    ["draw", [1, 1], [{ wins: 0, losses: 0, draws: 1 }, { wins: 0, losses: 0, draws: 1 }]],
    ["double_loss", [0, 0], [{ wins: 0, losses: 1, draws: 0 }, { wins: 0, losses: 1, draws: 0 }]],
  ] as const)("scores %s", (result, points, records) => {
    const s = fixture([[[0, 1, result]]], 2);
    const rows = standings(s);
    s.players.forEach((p, i) => {
      const row = rows.find(r => r.playerId === p.id);
      expect(row?.matchPoints).toBe(points[i]);
      expect(row?.record).toEqual(records[i]);
    });
  });

  it("counts bye wins and losses as played, with no phantom opponent", () => {
    const s = fixture([[[0, null, "bye_win"], [1, null, "bye_loss"]]], 2);
    const rows = standings(s);
    expect(rows.map(r => [r.matchPoints, r.record, r.omw, r.oomw])).toEqual([
      [3, { wins: 1, losses: 0, draws: 0 }, 0, 0], [0, { wins: 0, losses: 1, draws: 0 }, 0, 0],
    ]);
  });

  const twoRounds = () => fixture([[[0, 1, "p1"], [2, 3, "draw"]], [[0, 2, "p1"], [1, 3, "p1"]]]);
  it("uses legacy pooled OMW and pooled OOMW with thousandth truncation", () => {
    const s = twoRounds();
    const rows = standings(s);
    expect(s.players.map(p => {
      const r = rows.find(r => r.playerId === p.id)!;
      return [r.matchPoints, r.omw, r.oomw];
    })).toEqual([[6, 33.3, 58.3], [3, 58.3, 33.3], [1, 58.3, 33.3], [1, 33.3, 58.3]]);
  });

  it("floor33 averages floored individual percentages at both levels", () => {
    const s = twoRounds(); s.settings.tiebreak = "floor33";
    const rows = standings(s);
    expect(s.players.map(p => {
      const r = rows.find(r => r.playerId === p.id)!;
      return [r.omw, r.oomw];
    })).toEqual([[41.6, 66.6], [66.6, 41.6], [66.6, 41.6], [41.6, 66.6]]);
  });

  it("pools unequal records, includes dropped opponents and their byes, and caps 100%", () => {
    const s = fixture([[[0, 1, "p1"], [2, 3, "p1"]], [[0, 2, "p1"], [1, null, "bye_win"]]]);
    s.players[3].status = "dropped";
    const rows = standings(s);
    // C's opponents A (6/6) and D (0/3): 6/9, not average(100%,0%).
    // A's opponents B (bye win included: 3/6), C (3/6): 6/12.
    // C's OOMW pools A's 6/12 and D's 3/6: 9/18.
    expect(s.players.map(p => {
      const r = rows.find(r => r.playerId === p.id)!;
      return [r.omw, r.oomw, r.status];
    })).toEqual([[50, 80, "active"], [99.9, 50, "active"], [66.6, 50, "active"], [50, 66.6, "dropped"]]);
  });

  it("retains repeated opponents in both pooled lists", () => {
    const s = fixture([[[0, 1, "p1"], [2, 3, "p1"]], [[0, 1, "p2"], [2, 3, "p1"]], [[0, 2, "draw"], [1, 3, "p1"]]]);
    const a = standings(s).find(r => r.playerId === s.players[0].id)!;
    // Opp(A) = B,B,C: (6+6+7)/27. Opp(B)=[A,A,D], Opp(C)=[D,D,A].
    expect([a.matchPoints, a.omw, a.oomw]).toEqual([4, 70.3, 24.6]);
  });

  it("uses the selected round for points, tiebreaks, and dropped-player visibility", () => {
    const s = fixture([[[0, 1, "p1"], [2, 3, "p1"]], [[0, 2, "p1"], [1, 3, null]]]);
    const a = s.players[0].id;
    const b = s.players[1].id;
    Object.assign(s.players[0], { status: "dropped", droppedAfterRound: 2 });
    expect(standings(s).find(row => row.playerId === a)).toMatchObject({ matchPoints: 6, omw: 25, oomw: 50 });
    expect(standings(s).find(row => row.playerId === b)).toMatchObject({ omw: 50, record: { wins: 0, draws: 0, losses: 1 } });
    expect(standings(s, { throughRound: 1, includeDropped: false }).find(row => row.playerId === a))
      .toMatchObject({ matchPoints: 3, omw: 0 });
    expect(standings(s, { includeDropped: false })[0]).toMatchObject({ playerId: s.players[2].id, rank: 1 });
  });

  it("assigns competition ranks 1,2,2,4 using the published truncated keys", () => {
    const s = fixture([[[0, null, "bye_win"], [1, null, "bye_win"], [2, null, "bye_win"], [3, null, "bye_loss"]],
      [[0, null, "bye_win"], [1, null, "bye_loss"], [2, null, "bye_loss"], [3, null, "bye_loss"]]]);
    expect(standings(s).map(r => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it("does not add Swiss points or records for playoff results", () => {
    const s = fixture([[[0, 1, "p1"], [2, 3, "draw"]]]);
    s.rounds.push({ ...s.rounds[0], number: 2, stage: "playoff", matches: [{ ...s.rounds[0].matches[0], id: "final", round: 2, result: "p2" }] });
    s.cut = [s.players[0].id, s.players[1].id]; s.phase = "playoff";
    const rows = standings(s);
    expect(rows.map(r => [r.playerId, r.matchPoints, r.playoffFinish])).toEqual([
      [s.players[1].id, 0, 1], [s.players[0].id, 3, 2], [s.players[2].id, 1, null], [s.players[3].id, 1, null],
    ]);
  });

  it("recomputes after a past Swiss correction without changing later pairings", () => {
    let s = fixture([[[0, 1, "p1"], [2, 3, "draw"]]]);
    s = run(s, { type: "PairNextRound" });
    const paired = structuredClone(s.rounds[1]);
    s = run(s, { type: "EnterResult", matchId: "r1m1", result: "p2" });
    expect(s.rounds[1]).toEqual(paired);
    expect(standings(s).find(r => r.playerId === s.players[1].id)?.matchPoints).toBe(3);
  });

  it.each([[0, 1], [1, 1], [2, 1], [3, 2], [8, 3], [9, 4], [512, 9]])("suggests %i players → %i rounds", (n, expected) => {
    expect(suggestRounds(n)).toBe(expected);
  });

  it("starts with no records and no tiebreakers", () => {
    expect(standings(event()).map(r => [r.rank, r.matchPoints, r.omw, r.oomw])).toEqual(Array.from({ length: 4 }, () => [1, 0, 0, 0]));
  });
});

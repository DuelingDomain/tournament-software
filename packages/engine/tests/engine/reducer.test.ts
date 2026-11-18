import { describe, expect, it } from "vitest";
import { applyCommand, CommandError, createEvent, DEFAULT_INFRACTIONS, playerView, publicView, standings } from "../../src/index.js";
import { context, event, fixture, run, scoreAll } from "./fixtures.js";

describe("commands and audience views", () => {
  it("backfills every paired round including the current one, and waits until next round", () => {
    let s = scoreAll(run(event(), { type: "PairNextRound" }));
    s = run(s, { type: "PairNextRound" });
    s = run(s, { type: "AddPlayers", players: [{ userId: 5, name: "Late arrival" }] });
    const p = s.players[4];
    expect(p.enteredRound).toBe(3);
    expect(s.rounds.map(r => r.matches.find(m => m.p1 === p.id))).toEqual([
      expect.objectContaining({ result: "bye_loss", p2: null, table: null }), expect.objectContaining({ result: "bye_loss", p2: null, table: null }),
    ]);
    expect(standings(s).find(r => r.playerId === p.id)?.record).toEqual({ wins: 0, losses: 2, draws: 0 });
    s = run(s, { type: "RepairRound" }, 190);
    expect(s.rounds[1].matches.filter(m => m.p1 === p.id || m.p2 === p.id)).toHaveLength(1);
    expect(s.rounds[1].matches.find(m => m.p1 === p.id)?.result).toBe("bye_loss");
    s = run(scoreAll(s), { type: "PairNextRound" });
    expect(s.rounds[2].matches.some(m => m.p1 === p.id || m.p2 === p.id)).toBe(true);
  });

  it("drops a loser and records the current round without changing points", () => {
    let s = run(event(), { type: "PairNextRound" }); const m = s.rounds[0].matches[0];
    s = run(s, { type: "EnterResult", matchId: m.id, result: "p1", drop: "loser" });
    expect(s.players.find(p => p.id === m.p2)).toMatchObject({ status: "dropped", droppedAfterRound: 1 });
    s = run(scoreAll(s), { type: "PairNextRound" });
    expect(s.rounds[1].matches.every(m2 => m2.p1 !== m.p2 && m2.p2 !== m.p2)).toBe(true);
    expect(standings(s).find(r => r.playerId === m.p2)?.matchPoints).toBe(0);
  });

  it.each(["draw", "double_loss"] as const)("drop loser for %s drops both", result => {
    let s = run(event(), { type: "PairNextRound" }); const m = s.rounds[0].matches[0];
    s = run(s, { type: "EnterResult", matchId: m.id, result, drop: "loser" });
    expect(s.players.filter(p => p.id === m.p1 || p.id === m.p2).every(p => p.status === "dropped")).toBe(true);
  });

  it.each(["bye_loss", "bye_win", "next_round"] as const)("undrops with %s only in the current round", option => {
    let s = run(event(), { type: "DropPlayer", playerId: event().players[0].id });
    const id = s.players[0].id;
    s = run(s, { type: "PairNextRound" });
    const count = s.rounds[0].matches.length;
    s = run(s, { type: "UndropPlayer", playerId: id, option });
    expect(s.players[0]).toMatchObject({ status: "active", droppedAfterRound: null });
    expect(s.rounds[0].matches).toHaveLength(count + (option === "next_round" ? 0 : 1));
    if (option !== "next_round") expect(s.rounds[0].matches.at(-1)).toMatchObject({ p1: id, p2: null, result: option });
  });

  it("repairs with a new seed, deleting results and pending reports while regenerating automatic byes", () => {
    const s = run(event(5), { type: "PairNextRound" });
    expect(() => run(s, { type: "RepairRound" })).toThrow(/new seed/);
    const repaired = run(s, { type: "RepairRound" }, 88);
    expect(repaired.rounds[0].seed).toBe(88);
    let entered = run(repaired, { type: "EnterResult", matchId: repaired.rounds[0].matches[0].id, result: "p1" });
    const pending = repaired.rounds[0].matches[1];
    entered = run(entered, { type: "ReportResult", matchId: pending.id, playerId: pending.p1, result: "p2" });
    const before = structuredClone(entered);
    const again = run(entered, { type: "RepairRound", round: 1 }, 99);
    expect(again.rounds).toHaveLength(1);
    expect(again.rounds[0].matches.filter(m => m.p2 !== null).every(m => m.result === null && m.reports.length === 0)).toBe(true);
    expect(again.rounds[0].matches.filter(m => m.p2 === null)).toEqual([expect.objectContaining({ result: "bye_win" })]);
    expect(standings(again).map(r => r.matchPoints).sort()).toEqual([0, 0, 0, 0, 3]);
    expect(again.rounds[0].matches.every(m => !entered.rounds[0].matches.some(old => old.id === m.id))).toBe(true);
    expect(entered).toEqual(before);
  });

  it("refuses to re-pair an earlier round once a later round exists", () => {
    const s = run(scoreAll(run(event(), { type: "PairNextRound" })), { type: "PairNextRound" });
    const before = structuredClone(s);
    expect(() => run(s, { type: "RepairRound", round: 1 }, 88)).toThrow(expect.objectContaining({ code: "CURRENT_ROUND_ONLY" }));
    expect(s).toEqual(before);
    expect(run(s, { type: "RepairRound", round: 2 }, 88).rounds[0]).toEqual(s.rounds[0]);
  });

  it.each(["swiss", "single_elim"] as const)("requires two active players to start %s", format => {
    for (const count of [0, 1]) {
      const s = event(count, { format });
      expect(() => run(s, { type: "PairNextRound" })).toThrow(expect.objectContaining({ code: count ? "NOT_ENOUGH_PLAYERS" : "NO_PLAYERS" }));
      expect(s.rounds).toEqual([]);
    }
    expect(run(event(2, { format }), { type: "PairNextRound" }).rounds[0].matches).toHaveLength(1);
  });

  it("counts active players rather than registered players before advancing Swiss", () => {
    let s = fixture([[[0, 1, "p1"], [2, 3, "p1"]]]);
    for (const p of s.players.slice(1)) s = run(s, { type: "DropPlayer", playerId: p.id });
    expect(() => run(s, { type: "PairNextRound" })).toThrow(expect.objectContaining({ code: "NOT_ENOUGH_PLAYERS" }));
    expect(s.rounds).toHaveLength(1);
  });

  it("keeps next-round undrops outside the current roster during manual edits", () => {
    let s = event(5);
    const id = s.players[0].id;
    s = run(s, { type: "DropPlayer", playerId: id });
    s = run(s, { type: "PairNextRound" });
    s = run(s, { type: "UndropPlayer", playerId: id, option: "next_round" });
    const m = s.rounds[0].matches[0];
    s = run(s, { type: "SetPairing", matchId: m.id, p1: m.p2!, p2: m.p1 });
    expect(s.rounds[0].matches.every(m => m.p1 !== id && m.p2 !== id)).toBe(true);
    expect(() => scoreAll(s)).toThrow(expect.objectContaining({ code: "unpaired_players" }));
    s = run(s, { type: "AddByeMatch", playerId: id, result: "bye_loss" });
    s = run(scoreAll(s), { type: "PairNextRound" });
    expect(s.rounds[1].matches.some(m => m.p1 === id || m.p2 === id)).toBe(true);
  });

  it("leaves deeply frozen inputs and commands unchanged for successful and rejected edits", () => {
    function freeze(value: unknown): void {
      if (!value || typeof value !== "object") return;
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    }
    const s = run(event(), { type: "PairNextRound" });
    const before = structuredClone(s);
    const command = { type: "UpdatePlayer", playerId: s.players[0].id, notes: "Desk note" } satisfies Parameters<typeof applyCommand>[1];
    const commandBefore = structuredClone(command);
    freeze(s); freeze(command);
    const edited = run(s, command);
    expect(edited.players[0].notes).toBe("Desk note");
    expect(s).toEqual(before); expect(command).toEqual(commandBefore);
    expect(() => run(s, { type: "SetPairing", matchId: s.rounds[0].matches[0].id, p1: s.players[0].id, p2: s.players[0].id })).toThrow(CommandError);
    expect(s).toEqual(before);
  });

  it("starts, shifts and extends timers from the supplied clock", () => {
    let s = run(event(), { type: "PairNextRound" });
    expect(() => run(s, { type: "AdjustTimer", deltaMinutes: 1 })).toThrow(/Start the round timer/);
    s = run(s, { type: "StartTimer" });
    expect(s.rounds[0]).toMatchObject({ startedAt: context.now, endsAt: "2026-11-16T12:50:00.000Z" });
    s = run(s, { type: "AdjustTimer", deltaMinutes: -5 });
    s = run(s, { type: "ExtendMatch", matchId: s.rounds[0].matches[0].id, minutes: 3 });
    expect(s.rounds[0].endsAt).toBe("2026-11-16T12:45:00.000Z");
    expect(s.rounds[0].matches[0].extensionMinutes).toBe(3);
  });

  it("holds one report pending, settles agreement, and reopens disagreement", () => {
    let s = run(event(), { type: "PairNextRound" }); const m = s.rounds[0].matches[0];
    s = run(s, { type: "ReportResult", playerId: m.p1, matchId: m.id, result: "p1" });
    expect(s.rounds[0].matches[0].result).toBeNull();
    expect(playerView(s, m.p2!, 3).currentMatch).toMatchObject({ myReport: null, opponentReport: "p1" });
    s = run(s, { type: "ReportResult", playerId: m.p2!, matchId: m.id, result: "p1" });
    expect(s.rounds[0].matches[0].result).toBe("p1");
    s = run(s, { type: "ReportResult", playerId: m.p1, matchId: m.id, result: "p2" });
    expect(s.rounds[0].matches[0]).toMatchObject({ result: null, reports: expect.any(Array) });
    expect(s.rounds[0].matches[0].reports).toHaveLength(2);
    s = run(s, { type: "EnterResult", matchId: m.id, result: "draw" });
    expect(s.rounds[0].matches[0].reports).toEqual([]);
    expect(() => run(s, { type: "ReportResult", playerId: m.p1, matchId: m.id, result: "p1" })).toThrow(/Staff have already/);
  });

  it("rejects reporting another player's match or a past round", () => {
    let s = run(event(), { type: "PairNextRound" }); const m = s.rounds[0].matches[0];
    const outsider = s.rounds[0].matches[1].p1;
    expect(() => run(s, { type: "ReportResult", playerId: outsider, matchId: m.id, result: "p1" })).toThrow(/own match/);
    s = run(scoreAll(s), { type: "PairNextRound" });
    expect(() => run(s, { type: "ReportResult", playerId: m.p1, matchId: m.id, result: "p1" })).toThrow(/current-round/);
  });

  it("swaps and reverses unscored pairings, refusing duplicates, omissions and scored edits", () => {
    let s = run(event(), { type: "PairNextRound" });
    const [a, b] = s.rounds[0].matches;
    s = run(s, { type: "SwapPlayers", a: a.p1, b: b.p1 });
    expect(s.rounds[0].matches.map(m => m.p1)).toEqual([b.p1, a.p1]);
    const m = s.rounds[0].matches[0];
    expect(() => run(s, { type: "SetPairing", matchId: m.id, p1: a.p1, p2: m.p2 })).toThrow(/exactly once/);
    expect(() => run(s, { type: "SetPairing", matchId: m.id, p1: m.p1, p2: null })).toThrow(/exactly once/);
    s = run(s, { type: "SetPairing", matchId: m.id, p1: m.p2!, p2: m.p1 });
    s = run(s, { type: "EnterResult", matchId: m.id, result: "p1" });
    expect(() => run(s, { type: "SwapPlayers", a: m.p1, b: a.p1 })).toThrow(/Clear the result/);
  });

  it("adds generic default penalties without changing results or points", () => {
    let s = fixture([[[0, 1, "p1"], [2, 3, "draw"]]]);
    const before = standings(s);
    expect(DEFAULT_INFRACTIONS).toHaveLength(12);
    s = run(s, { type: "AddPenalty", playerId: s.players[0].id, infractionId: "slow_play", notes: "Private judging note" });
    expect(s.penalties[0].penalty).toBe("warning");
    expect(standings(s)).toEqual(before);
    expect(s.rounds[0].matches.map(m => m.result)).toEqual(["p1", "draw"]);
    s = run(s, { type: "RemovePenalty", penaltyId: s.penalties[0].id });
    expect(s.penalties).toEqual([]);
  });

  it("projects initials and excludes all private fields, including nested bracket and history", () => {
    let s = event(4, { publicNames: "initials" });
    s = run(s, { type: "UpdatePlayer", playerId: s.players[0].id, name: "Sam Taylor", memberId: "12345678", notes: "private-player-note" });
    s = run(s, { type: "UpdatePlayer", playerId: s.players[1].id, name: "Cher" });
    s = run(s, { type: "AddStaff", userId: 99, name: "Private staff name", role: "judge" });
    s = run(s, { type: "AddPenalty", playerId: s.players[0].id, infractionId: "slow_play", notes: "private-penalty" });
    s = run(s, { type: "CutToPlayoff", size: 4 });
    const view = publicView(s, 7);
    expect(view.standings.find(r => r.playerId === s.players[0].id)?.name).toBe("Sam T.");
    expect(view.standings.find(r => r.playerId === s.players[1].id)?.name).toBe("Cher");
    expect(view.bracket).toHaveLength(1);
    const own = playerView(s, s.players[0].id, 7);
    expect(own.me.name).toBe("Sam Taylor");
    expect(own.event).toEqual(view);
    const secretKeys = new Set(["userId", "notes", "memberId", "penalties", "staff", "reports"]);
    function check(value: unknown): void {
      if (!value || typeof value !== "object") return;
      for (const [key, nested] of Object.entries(value)) { expect(secretKeys.has(key)).toBe(false); check(nested); }
    }
    check(view); check(own);
    expect(JSON.stringify(view)).not.toContain("Sam Taylor");
    view.standings[0].record.wins = 100;
    expect(standings(s).every(r => r.record.wins === 0)).toBe(true);
  });

  it("completes empty events, blocks edits while complete, and uses CommandError codes", () => {
    const complete = run(event(0), { type: "CompleteEvent" });
    expect(complete.completedAt).toBe(context.now);
    expect(() => run(complete, { type: "AddPlayers", players: [] })).toThrow(CommandError);
    expect(run(complete, { type: "ReopenEvent" }).phase).toBe("registration");
    try { run(event(), { type: "CancelRound" }); throw new Error("Expected rejection"); }
    catch (e) { expect(e).toMatchObject({ name: "CommandError", code: "NO_ROUND" }); }
  });

  it("requires temporary person IDs to be replaced before finalization, including dropped and cut entries", () => {
    for (const status of ["active", "dropped", "cut"] as const) {
      let s = fixture([[[0, 1, "p1"], [2, 3, "p1"]]]);
      s = run(s, { type: "UpdatePlayer", playerId: s.players[1].id, memberId: "9999000000" });
      if (status === "dropped") s = run(s, { type: "DropPlayer", playerId: s.players[1].id });
      if (status === "cut") s = run(s, { type: "SwissCut", mode: "min_points", value: 1 });
      const before = structuredClone(s);
      expect(() => run(s, { type: "CompleteEvent" })).toThrow(expect.objectContaining({ code: "TEMPORARY_MEMBER_IDS" }));
      expect(s).toEqual(before);
      s = run(s, { type: "UpdatePlayer", playerId: s.players[1].id, memberId: "12345673" });
      expect(run(s, { type: "CompleteEvent" }).completedAt).toBe(context.now);
    }
  });

  it.each([false, true])("refuses finalization with unreported matches when requireMemberId is %s", requireMemberId => {
    let s = run(event(), { type: "PairNextRound" });
    s = run(s, { type: "UpdateSettings", settings: { requireMemberId } });
    expect(() => run(s, { type: "CompleteEvent" })).toThrow(expect.objectContaining({ code: "MISSING_RESULTS" }));
  });

  it("isolates defaults and settings, and retains all seed bits in ids", () => {
    const settings = { name: "Test", infractions: structuredClone(DEFAULT_INFRACTIONS) };
    const s = createEvent(settings, context);
    settings.infractions[0].label = "Edited outside";
    expect(s.settings.infractions[0].label).toBe("Slow play");
    s.settings.infractions[0].label = "Edited event";
    expect(DEFAULT_INFRACTIONS[0].label).toBe("Slow play");
    const other = applyCommand(createEvent({ name: "Test" }, context), { type: "AddPlayers", players: [{ userId: 1, name: "Test" }] }, { ...context, seed: context.seed + 2 ** 32 });
    expect(other.players[0].id).not.toBe(event(1).players[0].id);
  });
});

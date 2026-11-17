import { describe, expect, it } from "vitest";
import { integrity, standings } from "../../src/index.js";
import { event, fixture, run, scoreAll } from "./fixtures.js";

describe("account entries and staff", () => {
  it("adds multiple unlinked entries without relaxing uniqueness for real accounts", () => {
    const original = event(1);
    original.settings.requireMemberId = true;
    const added = run(original, { type: "AddPlayers", players: [
      { userId: null, name: " Test Player 01 ", memberId: "9999000000" },
      { userId: null, name: "Test Player 02", memberId: "9999000001" },
    ] });
    expect(added.players.slice(1)).toMatchObject([
      { userId: null, name: "Test Player 01", memberId: "9999000000", status: "active" },
      { userId: null, name: "Test Player 02", memberId: "9999000001", status: "active" },
    ]);
    expect(new Set(added.players.map(p => p.id)).size).toBe(3);
    expect(original.players).toHaveLength(1);
    expect(() => run(added, { type: "AddPlayers", players: [
      { userId: null, name: "Unclaimed", memberId: "9999000002" },
      { userId: 1, name: "Duplicate", memberId: "101" },
    ] })).toThrow(expect.objectContaining({ code: "duplicate_account" }));
    expect(added.players).toHaveLength(3);
  });

  it("requires unique accounts atomically, normalizes member IDs and only warns about checksums", () => {
    const s = event(1);
    s.settings.requireMemberId = true;
    expect(() => run(s, { type: "AddPlayers", players: [{ userId: 2, name: "Missing" }] })).toThrow(expect.objectContaining({ code: "member_id_required" }));
    const added = run(s, { type: "AddPlayers", players: [{ userId: 2, name: " Entrant ", memberId: "00 1234-5678" }] });
    expect(added.players[1]).toMatchObject({ userId: 2, name: "Entrant", memberId: "12345678" });
    expect(integrity(added).memberIdWarnings).toEqual([{ playerId: added.players[1].id, memberId: "12345678", problem: "check_digit" }]);
    for (const players of [[{ userId: 1, name: "Duplicate" }], [{ userId: 3, name: "A" }, { userId: 3, name: "B" }]]) {
      expect(() => run(event(1), { type: "AddPlayers", players })).toThrow(expect.objectContaining({ code: "duplicate_account" }));
    }
    expect(s.players).toHaveLength(1);
  });

  it("claims only unlinked imported entries and refuses accounts already entered", () => {
    const s = event(2);
    s.players[0].userId = null;
    expect(() => run(s, { type: "LinkPlayerAccount", playerId: s.players[0].id, userId: 2 })).toThrow(expect.objectContaining({ code: "duplicate_account" }));
    const linked = run(s, { type: "LinkPlayerAccount", playerId: s.players[0].id, userId: 3 });
    expect(linked.players[0].userId).toBe(3);
    expect(s.players[0].userId).toBeNull();
    expect(() => run(linked, { type: "LinkPlayerAccount", playerId: s.players[0].id, userId: 4 })).toThrow(expect.objectContaining({ code: "ACCOUNT_ALREADY_LINKED" }));
  });

  it("adds staff accounts, changes roles and refuses duplicate staff accounts", () => {
    let s = run(event(), { type: "AddStaff", userId: 10, name: "Judge", role: "judge" });
    expect(() => run(s, { type: "AddStaff", userId: 10, name: "Duplicate", role: "staff" })).toThrow(expect.objectContaining({ code: "duplicate_account" }));
    s = run(s, { type: "SetStaffRole", staffId: s.staff[0].id, role: "head_judge" });
    expect(s.staff[0]).toMatchObject({ userId: 10, name: "Judge", role: "head_judge" });
    expect(() => run(s, { type: "SetStaffRole", staffId: "missing", role: "organizer" })).toThrow(expect.objectContaining({ code: "STAFF_NOT_FOUND" }));
  });

  it("disables late entry without closing staff registration commands", () => {
    const s = event(2, { registrationOpen: false, allowLateEntry: false });
    expect(s.players).toHaveLength(2);
    expect(() => run(run(s, { type: "PairNextRound" }), { type: "AddPlayers", players: [{ userId: 3, name: "Late" }] })).toThrow(expect.objectContaining({ code: "LATE_ENTRY_CLOSED" }));
  });
});

describe("re-entry and manual seats", () => {
  it("re-enrolls with losses for every missing round, preserving actual history", () => {
    let s = fixture([[[0, 1, "p1"], [2, 3, "p1"]], [[1, 2, "draw"], [3, null, "bye_win"]], [[1, 3, null], [2, null, "bye_win"]]]);
    const p = s.players[0]; p.status = "dropped"; p.droppedAfterRound = 1;
    s = run(s, { type: "ReEnroll", playerId: p.id });
    expect(s.players[0]).toMatchObject({ status: "active", droppedAfterRound: null });
    expect(s.rounds.map(r => r.matches.find(m => m.p1 === p.id || m.p2 === p.id)?.result)).toEqual(["p1", "bye_loss", "bye_loss"]);
    expect(standings(s).find(r => r.playerId === p.id)?.record).toEqual({ wins: 1, losses: 2, draws: 0 });
  });

  it("swaps into an unscored dropped player's seat and leaves that player unseated", () => {
    let s = fixture([[[0, 1, null], [2, 3, null]]], 5);
    const [a, , , , returning] = s.players;
    s = run(s, { type: "DropPlayer", playerId: a.id });
    s = run(s, { type: "DropPlayer", playerId: returning.id });
    const original = structuredClone(s);
    s = run(s, { type: "UndropPlayer", playerId: returning.id, option: "swap_with_dropped", swapWith: a.id });
    expect(s.rounds[0].matches[0]).toMatchObject({ p1: returning.id, p2: s.players[1].id, result: null });
    expect(s.players[0].status).toBe("dropped");
    expect(s.players[4].status).toBe("active");
    expect(integrity(s).unpairedActive).toEqual([]);
    const scored = { ...original, rounds: structuredClone(original.rounds) };
    scored.rounds[0].matches[0].result = "p1";
    expect(() => run(scored, { type: "UndropPlayer", playerId: returning.id, option: "swap_with_dropped", swapWith: a.id })).toThrow(expect.objectContaining({ code: "RESULT_ALREADY_ENTERED" }));
  });

  it("replaces a current bye with a new two-player table and removes its automatic points", () => {
    let s = event(4);
    const p = s.players[0];
    s = run(s, { type: "DropPlayer", playerId: p.id });
    s = run(s, { type: "PairNextRound" });
    const bye = s.rounds[0].matches.find(m => m.p2 === null)!;
    s = run(s, { type: "UndropPlayer", playerId: p.id, option: "take_bye" });
    expect(s.rounds[0].matches.some(m => m.id === bye.id)).toBe(false);
    expect(s.rounds[0].matches.at(-1)).toMatchObject({ p1: p.id, p2: bye.p1, result: null, table: 2 });
    expect(standings(s).every(r => r.matchPoints === 0)).toBe(true);
  });

  it("splits and recreates matches, blocking results and advancement until all active players have seats", () => {
    let s = fixture([[[0, 1, null], [2, 3, null]]]);
    const [a, b] = s.rounds[0].matches;
    s = run(s, { type: "SplitMatch", matchId: a.id });
    expect(integrity(s).unpairedActive).toEqual([s.players[0].id, s.players[1].id]);
    for (const command of [
      { type: "EnterResult", matchId: b.id, result: "p1" },
      { type: "ReportResult", playerId: b.p1, matchId: b.id, result: "p1" },
      { type: "PairNextRound" },
    ] as const) expect(() => run(s, command)).toThrow(expect.objectContaining({ code: "unpaired_players" }));
    s = run(s, { type: "CreateMatch", p1: a.p2!, p2: a.p1, table: 8 });
    expect(s.rounds[0].matches.at(-1)).toMatchObject({ p1: a.p2, p2: a.p1, table: 8, result: null });
    expect(() => run(s, { type: "CreateMatch", p1: a.p1, p2: null })).toThrow(expect.objectContaining({ code: "PLAYER_ALREADY_PAIRED" }));
    s = scoreAll(s);
    expect(() => run(s, { type: "SplitMatch", matchId: b.id })).toThrow(expect.objectContaining({ code: "RESULT_ALREADY_ENTERED" }));
    expect(run(s, { type: "PairNextRound" }).rounds).toHaveLength(2);
  });

  it("adds either kind of bye and lets CreateMatch create a bye", () => {
    let s = fixture([[[0, 1, null], [2, 3, null]]]);
    const m = s.rounds[0].matches[0];
    s = run(s, { type: "SplitMatch", matchId: m.id });
    s = run(s, { type: "AddByeMatch", playerId: m.p1, result: "bye_loss" });
    s = run(s, { type: "CreateMatch", p1: m.p2!, p2: null });
    expect(s.rounds[0].matches.slice(1).map(m => [m.table, m.result])).toEqual([[null, "bye_loss"], [null, "bye_win"]]);
    expect(standings(s).find(r => r.playerId === m.p2)?.matchPoints).toBe(3);
  });
});

describe("Swiss cuts and integrity", () => {
  it("cuts below a points threshold, undoes only the last cut, and locks undo after pairing even if cancelled", () => {
    const original = fixture([[[0, 1, "p1"], [2, 3, "draw"]]]);
    let s = run(original, { type: "SwissCut", mode: "min_points", value: 1 });
    expect(s.players.map(p => p.status)).toEqual(["active", "cut", "active", "active"]);
    expect(s.swissCuts[0]).toMatchObject({ afterRound: 1, mode: "min_points", value: 1, cutPlayers: [s.players[1].id] });
    s = run(s, { type: "SwissCut", mode: "min_points", value: 3 });
    s = run(s, { type: "UndoSwissCut" });
    expect(s.players.map(p => p.status)).toEqual(["active", "cut", "active", "active"]);
    expect(run(s, { type: "UndoSwissCut" })).toEqual(original);
    const cancelledCutRound = run(run(s, { type: "CancelRound" }), { type: "UndoSwissCut" });
    expect(cancelledCutRound.players.every(p => p.status === "active")).toBe(true);
    expect(cancelledCutRound.swissCuts).toEqual([]);
    s = run(s, { type: "PairNextRound" });
    expect(s.rounds[1].matches.flatMap(m => [m.p1, m.p2])).not.toContain(s.players[1].id);
    s = run(s, { type: "CancelRound" });
    expect(() => run(s, { type: "UndoSwissCut" })).toThrow(expect.objectContaining({ code: "SWISS_CUT_LOCKED" }));
  });

  it("keeps exactly top X with seeded ties or an explicit full-tie order", () => {
    const s = fixture([[[0, 1, "draw"], [2, 3, "draw"]]]);
    const command = { type: "SwissCut", mode: "top", value: 2 } as const;
    expect(run(s, command, 123)).toEqual(run(s, command, 123));
    const kept = (seed: number) => run(s, command, seed).players.filter(p => p.status === "active").map(p => p.id);
    expect(kept(123)).toHaveLength(2);
    expect(kept(123)).not.toEqual(kept(456));
    const order = s.players.map(p => p.id).reverse();
    expect(run(s, { ...command, tieOrder: order }).players.map(p => p.status)).toEqual(["cut", "cut", "active", "active"]);
    expect(() => run(s, { ...command, tieOrder: order.slice(0, 2) })).toThrow(expect.objectContaining({ code: "INVALID_TIE_ORDER" }));
  });

  it("reports Swiss repeats, duplicate seats, current unpaired players and normalized member-ID duplicates", () => {
    const s = fixture([[[0, 1, "p1"], [2, 3, "draw"]], [[1, 0, null], [0, 2, null]]]);
    s.players[0].memberId = "0012345673"; s.players[1].memberId = "12345673";
    s.players[2].memberId = "12345678"; s.players[3].memberId = "9999000000";
    expect(integrity(s)).toEqual({
      repeatMatches: [{ a: [s.players[0].id, s.players[1].id].sort()[0], b: [s.players[0].id, s.players[1].id].sort()[1], rounds: [1, 2] }],
      pairedTwiceInRound: [{ round: 2, playerId: s.players[0].id }], unpairedActive: [s.players[3].id],
      memberIdWarnings: [{ playerId: s.players[2].id, memberId: "12345678", problem: "check_digit" },
        { playerId: s.players[0].id, memberId: "12345673", problem: "duplicate" }, { playerId: s.players[1].id, memberId: "12345673", problem: "duplicate" }],
    });
    s.rounds[1].stage = "playoff";
    expect(integrity(s).repeatMatches).toEqual([]);
  });
});

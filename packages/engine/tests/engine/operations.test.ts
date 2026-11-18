import { expect, it } from "vitest";
import { applyCommand, integrity, printData, publicView } from "../../src/index.js";
import { context, event, fixture, run } from "./fixtures.js";

it("records successful commands with actor and timestamp without mutating inputs or exposing logs publicly", () => {
  const state = event(2);
  const before = structuredClone(state);
  const next = applyCommand(state, { type: "PairNextRound" }, { ...context, actor: "42" });
  expect(next.activityLog?.at(-1)).toMatchObject({ actor: "42", at: context.now, action: "PairNextRound", command: { type: "PairNextRound" } });
  expect(state).toEqual(before);
  expect(publicView(next, 1)).not.toHaveProperty("activityLog");
  expect(() => run(state, { type: "CancelRound" })).toThrow();
  expect(state).toEqual(before);
  let logged = next;
  for (let i = 0; i < 101; i++) logged = run(logged, { type: "SetCheckedIn", playerId: state.players[0].id, checkedIn: true });
  expect(logged.activityLog).toHaveLength(100);
});

it("provides staff print rows for unreported matches across rounds, pair-downs, byes and penalties", () => {
  let state = fixture([[[0, 1, "p1"], [2, 3, "p1"], [4, null, "bye_win"]], [[0, 1, null], [2, 4, "draw"], [3, null, "bye_win"]]], 5);
  state = run(state, { type: "AddPenalty", playerId: state.players[1].id, infractionId: state.settings.infractions[0].id, judge: "Sample Judge", round: 2 });
  const data = printData(state);
  expect(data.unreportedMatches.map(m => [m.round, m.p1.name, m.p2?.name])).toEqual([[2, state.players[0].name, state.players[1].name]]);
  expect(data.pairedDownPlayers).toContainEqual(expect.objectContaining({ round: 2, playerId: state.players[0].id, points: 3, opponentPoints: 0 }));
  expect(data.pairedDownPlayers.some(p => p.isBye)).toBe(true);
  expect(data.penalties[0]).toMatchObject({ player: { name: state.players[1].name }, infraction: state.settings.infractions[0].label, judge: "Sample Judge" });
});

it("repairs an undrop with an available opponent and swaps with a former opponent", () => {
  let state = fixture([[[0, 1, "p1"], [2, 3, "draw"]], [[1, 2, null], [3, null, "bye_win"]]], 4);
  const returning = state.players[0].id;
  state = run(state, { type: "DropPlayer", playerId: returning });
  const swapped = run(state, { type: "UndropPlayer", playerId: returning, option: "swap_previous_opponent" });
  expect(swapped.players[1].status).toBe("dropped");
  expect(swapped.rounds[1].matches[0]).toMatchObject({ p1: returning, p2: state.players[2].id });
  const shifted = run(state, { type: "UndropPlayer", playerId: returning, option: "repair" });
  expect(shifted.rounds[1].matches[0]).toMatchObject({ p1: returning, p2: state.players[2].id, result: null });
  expect(shifted.rounds[1].matches.at(-1)).toMatchObject({ p1: state.players[1].id, p2: null, result: "bye_win" });
  const split = run(state, { type: "SplitMatch", matchId: state.rounds[1].matches[0].id });
  const repaired = run(split, { type: "UndropPlayer", playerId: returning, option: "repair" });
  expect(repaired.rounds[1].matches.at(-1)).toMatchObject({ p1: returning, p2: state.players[1].id, result: null });
});

it("chain shifts an undrop through descending point groups using the command seed and preserving reported matches", () => {
  const template = fixture([
    [[0, 1, "p1"], [2, 3, "p1"], [4, 5, "p1"], [6, 7, "draw"], [8, null, "bye_win"], [9, null, "bye_win"], [10, null, "bye_win"]],
    [[0, 2, "p1"], [4, 8, "p1"], [6, 1, "draw"], [3, 5, "double_loss"], [7, null, "bye_loss"], [9, null, "bye_win"], [10, null, "bye_win"]],
    [[4, 8, null], [2, 6, null], [1, 7, null], [3, 5, "p1"], [9, 10, null]],
  ], 11);

  for (const size of [1, 3] as const) {
    let state = event(11 * size, { playerStructure: size, startingTable: 10 });
    if (size > 1) state = run(state, { type: "AddTeams", teams: Array.from({ length: 11 }, (_, i) => ({
      name: `Team ${i + 1}`, memberIds: state.players.slice(i * size, (i + 1) * size).map(p => p.id),
    })) });
    const field = size === 1 ? state.players : state.teams;
    const ids = field.map(p => p.id);
    const remap = new Map(template.players.map((p, i) => [p.id, ids[i]]));
    state.phase = "swiss";
    state.rounds = template.rounds.map(r => ({ ...structuredClone(r), matches: r.matches.map((m, i) => ({
      ...structuredClone(m), p1: remap.get(m.p1)!, p2: m.p2 === null ? null : remap.get(m.p2)!,
      table: m.p2 === null ? null : 10 + i * size,
    })) }));
    state = run(state, size === 1 ? { type: "DropPlayer", playerId: ids[0] } : { type: "DropTeam", teamId: ids[0] });
    state = run(state, { type: "StartTimer" });
    state = run(state, { type: "ExtendMatch", matchId: "r3m1", minutes: 5 });
    const command = size === 1
      ? { type: "UndropPlayer" as const, playerId: ids[0], option: "repair" as const }
      : { type: "UndropTeam" as const, teamId: ids[0], option: "repair" as const };

    for (const protectedResult of [true, false]) {
      const input = structuredClone(state);
      if (!protectedResult) {
        const pending = input.rounds[2].matches[3];
        pending.result = null;
        pending.reports = [{ by: ids[3], result: "p1", at: context.now }];
      }
      const before = structuredClone(input);
      const next = run(input, command, 42);
      const matches = next.rounds[2].matches;
      expect(matches[0]).toEqual({ ...before.rounds[2].matches[0], p2: ids[0] });
      expect(matches[1]).toEqual({ ...before.rounds[2].matches[1], p2: ids[8] });
      const tie = matches[2];
      expect([tie.p1, tie.p2]).toContain(ids[6]);
      const retained = tie.p1 === ids[6] ? tie.p2 : tie.p1;
      expect([ids[1], ids[7]]).toContain(retained);
      const displaced = retained === ids[1] ? ids[7] : ids[1];
      expect(matches[3]).toEqual(before.rounds[2].matches[3]);
      // After the first displacement, this table is above the carried player's group.
      expect(matches[4]).toEqual(before.rounds[2].matches[4]);
      expect(matches.at(-1)).toMatchObject({ p1: displaced, p2: null, result: "bye_win", reports: [], table: null });
      expect(matches).toHaveLength(6);
      expect(matches.map(m => m.table)).toEqual([10, 10 + size, 10 + 2 * size, 10 + 3 * size, 10 + 4 * size, null]);
      expect(next.rounds.slice(0, 2)).toEqual(before.rounds.slice(0, 2));
      expect({ ...next.rounds[2], matches: [] }).toEqual({ ...before.rounds[2], matches: [] });
      expect(next.schemaVersion).toBe(before.schemaVersion);
      expect(next.activityLog?.at(-1)).toEqual({ actor: context.actor, at: context.now, action: command.type, command });
      expect(next.players.every(p => p.status === "active")).toBe(true);
      expect(integrity(next)).toMatchObject({ unpairedActive: [], pairedTwiceInRound: [] });
      expect(run(input, command, 42)).toEqual(next);
      expect(input).toEqual(before);
      // A different seed can choose the other equal-score seat.
      const tieOpponents = new Set(Array.from({ length: 8 }, (_, seed) => {
        const m = run(input, command, seed).rounds[2].matches[2];
        return m.p1 === ids[6] ? m.p2 : m.p1;
      }));
      expect(tieOpponents).toEqual(new Set([ids[1], ids[7]]));
    }

    // An unreported bye ends the cascade; an already scored bye is preserved.
    const withBye = structuredClone(state);
    const bye = withBye.rounds[2].matches[3];
    const protectedBye = { ...structuredClone(bye), id: "scored-bye", p1: ids[5], p2: null, table: null, result: "bye_win" as const };
    Object.assign(bye, { p2: null, table: null, result: null });
    withBye.rounds[2].matches.push(protectedBye);
    const ended = run(withBye, command, 42);
    const terminal = ended.rounds[2].matches.find(m => m.id === bye.id)!;
    expect(terminal).toMatchObject({ p1: ids[3], p2: expect.any(String), result: null, table: 10 + 3 * size });
    expect([ids[1], ids[7]]).toContain(terminal.p2);
    expect(ended.rounds[2].matches.find(m => m.id === protectedBye.id)).toEqual(protectedBye);
    expect(ended.rounds[2].matches).toHaveLength(withBye.rounds[2].matches.length);
    expect(integrity(ended)).toMatchObject({ unpairedActive: [], pairedTwiceInRound: [] });

    for (const blockedBy of ["conflicting_seats", "occupied_table"]) {
      const blocked = structuredClone(withBye);
      const blockedField = size === 1 ? blocked.players : blocked.teams;
      if (blockedBy === "conflicting_seats") {
        blockedField[8].fixedTable = 10;
        blockedField[3].fixedTable = 10 + 7 * size;
      } else blockedField[3].fixedTable = 10;
      const preserved = structuredClone(blocked.rounds[2].matches);
      const repaired = run(blocked, command, 42);
      const repairedMatches = repaired.rounds[2].matches;
      expect(repairedMatches.find(m => m.id === bye.id)).toEqual(preserved[3]);
      expect(repairedMatches.find(m => m.id === protectedBye.id)).toEqual(protectedBye);
      expect(repairedMatches).toHaveLength(preserved.length + 1);
      expect(repairedMatches.at(-1)).toMatchObject({ result: "bye_win", p2: null, table: null });
      if (blockedBy === "conflicting_seats") {
        expect(repairedMatches.at(-1)?.p1).toBe(ids[8]);
        expect(repairedMatches[1]).toEqual(preserved[1]);
        expect(repairedMatches[2]).toEqual(preserved[2]);
      }
      expect(integrity(repaired)).toMatchObject({ unpairedActive: [], pairedTwiceInRound: [] });
    }
  }
});

import { expect, it } from "vitest";
import { applyCommand, integrity, previewCommand, printData, publicView } from "../../src/index.js";
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

it("repairs an undrop through the selected score groups, including an existing bye", () => {
  const state = fixture([
    [[0, null, "bye_win"], [1, null, "bye_win"], [2, 3, "double_loss"], [4, 5, "double_loss"], [6, null, "bye_loss"], [7, null, "bye_win"]],
    [[1, 2, "p1"], [3, 4, null], [5, 6, null], [7, null, "bye_win"]],
  ], 8);
  const ids = state.players.map(p => p.id);
  Object.assign(state.players[0], { status: "dropped", droppedAfterRound: 1 });
  const command = { type: "UndropPlayer", playerId: ids[0], option: "repair" } as const;
  const before = structuredClone(state);
  const repaired = run(state, command, 42);
  const matches = repaired.rounds[1].matches;
  expect(matches[0]).toMatchObject({ p1: ids[1], p2: ids[0], result: null });
  expect(matches[1]).toMatchObject({ p1: ids[4], p2: null, result: null });
  expect(matches[2]).toEqual(before.rounds[1].matches[2]);
  expect(matches[3]).toMatchObject({ id: "r2m4", p1: ids[7], p2: ids[2], result: null });
  expect(matches[4]).toMatchObject({ p1: ids[3], p2: null, result: "bye_win" });
  expect(integrity(repaired)).toMatchObject({ unpairedActive: [], pairedTwiceInRound: [] });
  expect(state).toEqual(before);
  expect(previewCommand(state, command, { ...context, seed: 42 })).toHaveLength(4);

  const terminalBye = structuredClone(state);
  terminalBye.rounds[1].matches = [terminalBye.rounds[1].matches[0], terminalBye.rounds[1].matches[3]];
  const ended = run(terminalBye, command, 42).rounds[1].matches;
  expect(ended).toHaveLength(2);
  expect(ended[1]).toMatchObject({ p1: ids[7], p2: ids[2], result: null });
});

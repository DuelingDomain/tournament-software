import { expect, it } from "vitest";
import { applyCommand, printData, publicView } from "../../src/index.js";
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

it("repairs an undrop with an unpaired opponent or bye and swaps with a former opponent", () => {
  let state = fixture([[[0, 1, "p1"], [2, 3, "draw"]], [[1, 2, null], [3, null, "bye_win"]]], 4);
  const returning = state.players[0].id;
  state = run(state, { type: "DropPlayer", playerId: returning });
  const swapped = run(state, { type: "UndropPlayer", playerId: returning, option: "swap_previous_opponent" });
  expect(swapped.players[1].status).toBe("dropped");
  expect(swapped.rounds[1].matches[0]).toMatchObject({ p1: returning, p2: state.players[2].id });
  const bye = run(state, { type: "UndropPlayer", playerId: returning, option: "repair" });
  expect(bye.rounds[1].matches.at(-1)).toMatchObject({ p1: returning, p2: null, result: "bye_win" });
  const split = run(state, { type: "SplitMatch", matchId: state.rounds[1].matches[0].id });
  const repaired = run(split, { type: "UndropPlayer", playerId: returning, option: "repair" });
  expect(repaired.rounds[1].matches.at(-1)).toMatchObject({ p1: returning, p2: state.players[1].id, result: null });
});

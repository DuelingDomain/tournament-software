import { expect, it } from "vitest";
import { standings } from "../../src/index.js";
import { event, run, scoreAll } from "./fixtures.js";

it("adjusts manual points in Open Dueling as the first ranking key without changing match results", () => {
  let state = scoreAll(run(event(4, { format: "open_dueling", style: "open_dueling" }), { type: "PairNextRound" }));
  const match = state.rounds[0].matches[0];
  const before = structuredClone(state.rounds);
  state = run(state, { type: "AdjustPoints", playerId: match.p2!, delta: 2 });
  expect(standings(state)[0]).toMatchObject({ playerId: match.p2, openDuelingPoints: 2, matchPoints: 0 });
  state = run(state, { type: "AdjustPoints", playerId: match.p2!, delta: -3 });
  expect(standings(state).at(-1)).toMatchObject({ playerId: match.p2, openDuelingPoints: -1 });
  expect(state.rounds).toEqual(before);
  expect(() => run(event(), { type: "AdjustPoints", playerId: "missing", delta: 1 })).toThrow(expect.objectContaining({ code: "OPEN_DUELING_ONLY" }));
});

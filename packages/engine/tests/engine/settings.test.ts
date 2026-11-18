import { expect, it } from "vitest";
import { createEvent } from "../../src/index.js";
import { context, event, run } from "./fixtures.js";

it("uses the same tournament settings at creation and update, locking roster size after enrollment", () => {
  let state = createEvent({ name: "Morning Cup", style: "sealed", format: "open_dueling", playerStructure: 3,
    startsAt: "2026-12-01T10:30:00Z", location: "Community Hall" }, context);
  expect(state.settings).toMatchObject({ style: "sealed", format: "open_dueling", playerStructure: 3 });
  state = run(state, { type: "UpdateSettings", settings: { name: "Evening Cup", style: "traditional", playerStructure: 2 } });
  state = run(state, { type: "AddStaff", userId: 1, name: "Sample Judge", position: "assistant_head_judge" });
  expect(state.staff[0]).toMatchObject({ role: "head_judge", position: "assistant_head_judge" });
  state = run(state, { type: "SetStaffPosition", staffId: state.staff[0].id, position: "event_manager" });
  expect(state.staff[0]).toMatchObject({ role: "staff", position: "event_manager" });
  state = run(state, { type: "AddPlayers", players: [{ userId: null, name: "Sample Player" }] });
  state = run(state, { type: "AddPenalty", playerId: state.players[0].id, infractionId: state.settings.infractions[0].id, judge: state.staff[0].id });
  const staffId = state.staff[0].id;
  state = run(state, { type: "UpdateSettings", settings: {}, staff: [{ userId: 1, name: "Sample Judge", position: "event_manager" }] });
  expect(state.staff[0].id).toBe(staffId);
  expect(state.penalties[0].judge).toBe(state.staff[0].id);
  expect(() => run(state, { type: "UpdateSettings", settings: { playerStructure: 1 } })).toThrow(expect.objectContaining({ code: "PLAYER_STRUCTURE_LOCKED" }));
  const paired = run(event(2), { type: "PairNextRound" });
  expect(run(paired, { type: "UpdateSettings", settings: { format: "open_dueling", style: "sealed" } }).settings).toMatchObject({ format: "open_dueling", style: "sealed" });
  expect(() => createEvent({ name: "Invalid", style: "other" as never }, context)).toThrow();
});

import { expect, it } from "vitest";
import { createEvent } from "../../src/index.js";
import { context, run } from "./fixtures.js";

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
  expect(() => run(state, { type: "UpdateSettings", settings: { playerStructure: 1 } })).toThrow(expect.objectContaining({ code: "PLAYER_STRUCTURE_LOCKED" }));
  expect(() => createEvent({ name: "Invalid", style: "other" as never }, context)).toThrow();
});

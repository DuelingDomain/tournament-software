import { expect, it } from "vitest";
import { createEvent, standings } from "../../src/index.js";
import { parseLegacyTournament, serializeLegacyTournament } from "../../src/legacy/index.js";
import { context, run, scoreAll } from "../engine/fixtures.js";

it("round-trips ordered teams, results, byes, settings, manual points and staff positions", () => {
  let state = createEvent({ name: "Team File Cup", playerStructure: 2, style: "open_dueling", format: "open_dueling",
    startsAt: "2026-12-01T12:45:00Z", location: "Example Hall", locationDetails: { id: "example-location", name: "Example Hall", address1: "1 Sample Road", address2: "Room 1", city: "Sample City", state: "ST", postal: "00000", country: "Sample", phone: "000", website: "https://example.test" } }, context);
  state = run(state, { type: "AddPlayers", players: Array.from({ length: 6 }, (_, i) => ({ userId: null, name: `Example Member ${i + 1}`, memberId: String(101 + i) })) });
  state = run(state, { type: "AddTeams", teams: [0, 1, 2].map(i => ({ name: `Sample Team ${i + 1}`, memberIds: state.players.slice(i * 2, i * 2 + 2).map(p => p.id).reverse() })) });
  state = run(state, { type: "AddStaff", userId: 12, name: "Example Staff", position: "assistant_head_judge" });
  state = scoreAll(run(state, { type: "PairNextRound" }));
  state = run(state, { type: "AdjustPoints", playerId: state.teams[0].id, delta: 7 });
  state = run(state, { type: "AddPenalty", playerId: state.players[0].id, infractionId: state.settings.infractions[0].id, judge: state.staff[0].id });
  expect(() => run(state, { type: "UpdatePlayer", playerId: state.players[1].id, memberId: state.teams[1].id }))
    .toThrow(expect.objectContaining({ code: "INVALID_MEMBER_ID" }));
  state.players[1].memberId = state.teams[1].id; // An older saved roster could contain this collision.
  const xml = serializeLegacyTournament(state);
  expect(xml).toContain("<TournamentTeam>");
  expect(xml).toContain("<XmlStaffPositionCode>03</XmlStaffPositionCode>");
  const restored = parseLegacyTournament(xml, context).state;
  expect(restored.settings).toMatchObject({ style: "open_dueling", format: "open_dueling", playerStructure: 2, startsAt: "2026-12-01T12:45:00.000Z", locationDetails: state.settings.locationDetails });
  expect(restored.teams.map(t => [t.id, t.name, t.memberIds.map(id => restored.players.find(p => p.id === id)?.name)])).toEqual(state.teams.map(t => [t.id, t.name, t.memberIds.map(id => state.players.find(p => p.id === id)?.name)]));
  expect(restored.rounds[0].matches.map(m => [m.p1, m.p2, m.result, m.table])).toEqual(state.rounds[0].matches.map(m => [m.p1, m.p2, m.result, m.table]));
  expect(standings(restored).map(s => [s.name, s.matchPoints, s.openDuelingPoints])).toEqual(standings(state).map(s => [s.name, s.matchPoints, s.openDuelingPoints]));
  expect(restored.penalties[0].playerId).toBe(restored.players.find(p => p.memberId === "101")?.id);
  expect(serializeLegacyTournament(restored)).toContain("<XmlStaffPositionCode>03</XmlStaffPositionCode>");
  expect(restored.staff).toEqual([]);
  expect(restored.penalties[0].judge).toBe("Example Staff");
  expect(parseLegacyTournament(serializeLegacyTournament(restored), context).state.penalties[0].judge).toBe("Example Staff");
});

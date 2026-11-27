import { expect, it } from "vitest";
import { createEvent, integrity, playerView, publicView, standings } from "../../src/index.js";
import { context, run, scoreAll } from "./fixtures.js";

function teamEvent(size: 2 | 3 | 4 | 5 = 3, count = 5) {
  let state = createEvent({ name: "Team Cup", playerStructure: size, startingTable: 10 }, context);
  state = run(state, { type: "AddStaff", userId: 100, name: "Desk", role: "organizer" });
  state = run(state, { type: "AddPlayers", players: Array.from({ length: size * count }, (_, i) => ({ userId: i + 1, name: `Member ${i + 1}`, memberId: String(101 + i) })) });
  return run(state, { type: "AddTeams", teams: Array.from({ length: count }, (_, i) => ({ name: `Team ${i + 1}`, memberIds: state.players.slice(i * size, (i + 1) * size).map(p => p.id) })) });
}

it("enrolls ordered team rosters with unique team IDs and supports team drop, re-enroll and undrop", () => {
  let state = teamEvent();
  expect(state.teams.map(t => t.id)).toEqual(["9988000000", "9988000001", "9988000002", "9988000003", "9988000004"]);
  expect(state.teams[0].memberIds).toEqual(state.players.slice(0, 3).map(p => p.id));
  expect(() => run(state, { type: "UpdatePlayer", playerId: state.players[0].id, memberId: state.players[3].memberId })).toThrow(expect.objectContaining({ code: "MEMBER_ALREADY_ON_TEAM" }));
  expect(() => run(state, { type: "LinkPlayerAccount", playerId: state.teams[0].id, userId: 999 })).toThrow(expect.objectContaining({ code: "PLAYER_NOT_FOUND" }));
  const penalized = run(state, { type: "AddPenalty", playerId: state.teams[0].id, infractionId: state.settings.infractions[0].id });
  expect(run(penalized, { type: "RemoveTeam", teamId: state.teams[0].id }).penalties).toEqual([]);
  expect(() => run(state, { type: "AddTeams", teams: [{ name: "Duplicate", memberIds: state.teams[0].memberIds }] })).toThrow(expect.objectContaining({ code: "MEMBER_ALREADY_ON_TEAM" }));
  expect(() => run(state, { type: "UpdateTeam", teamId: state.teams[0].id, memberIds: [state.players[0].id] })).toThrow(expect.objectContaining({ code: "INVALID_TEAM_SIZE" }));
  state = run(state, { type: "DropTeam", teamId: state.teams[4].id });
  state = scoreAll(run(state, { type: "PairNextRound" }));
  state = run(state, { type: "ReEnrollTeam", teamId: state.teams[4].id });
  expect(state.rounds[0].matches.find(m => m.p1 === state.teams[4].id)?.result).toBe("bye_loss");
  state = run(state, { type: "DropTeam", teamId: state.teams[4].id });
  state = run(state, { type: "PairNextRound" });
  state = run(state, { type: "UndropTeam", teamId: state.teams[4].id, option: "bye_win" });
  expect(state.teams[4].status).toBe("active");
  expect(state.rounds[1].matches.find(m => m.p1 === state.teams[4].id)?.result).toBe("bye_win");
  state = run(state, { type: "AddTeams", teams: [{ teamId: state.teams[4].id, name: "Renamed", memberIds: [...state.teams[4].memberIds].reverse() }] });
  expect(state.teams).toHaveLength(5);
  expect(state.teams[4].name).toBe("Renamed");
});

it("pairs and ranks teams with table blocks, team byes, member reports and team-aware audience views", () => {
  let state = run(teamEvent(), { type: "PairNextRound" });
  expect(state.rounds[0].matches.map(m => m.table)).toEqual([10, 13, null]);
  expect(integrity(state).unpairedActive).toEqual([]);
  const match = state.rounds[0].matches[0];
  const left = state.teams.find(t => t.id === match.p1)!;
  const right = state.teams.find(t => t.id === match.p2)!;
  for (const [i, id] of left.memberIds.entries()) expect(playerView(state, id, 1).currentMatch).toMatchObject({ table: match.table, myTable: match.table! + i });
  expect(publicView(state, 1).teams[0]).toMatchObject({ id: state.teams[0].id, name: state.teams[0].name });
  expect(publicView(state, 1).currentRound?.matches[0]).toMatchObject({ p1: left.name, tables: [10, 11, 12], p1Members: left.memberIds.map(id => expect.objectContaining({ id })) });
  state = run(state, { type: "ReportResult", playerId: left.memberIds[0], matchId: match.id, result: "p1" });
  state = run(state, { type: "ReportResult", playerId: left.memberIds[1], matchId: match.id, result: "p1" });
  expect(state.rounds[0].matches[0].result).toBeNull();
  state = run(state, { type: "ReportResult", playerId: right.memberIds[0], matchId: match.id, result: "p1" });
  expect(state.rounds[0].matches[0].result).toBe("p1");
  expect(standings(state)).toHaveLength(5);
  expect(playerView(state, left.memberIds[2], 1).me.standing?.matchPoints).toBe(0);
  expect(playerView(scoreAll(state), left.memberIds[2], 1).me.standing?.matchPoints).toBe(3);
  for (const size of [2, 4, 5] as const) {
    let elimination = teamEvent(size, 3);
    elimination = run(elimination, { type: "UpdateSettings", settings: { format: "single_elim" } });
    elimination = scoreAll(run(elimination, { type: "PairNextRound" }));
    elimination = run(elimination, { type: "PairNextRound" });
    expect(elimination.rounds[1].matches).toHaveLength(1);
    expect(elimination.rounds[1].matches[0].table).toBe(10);
    expect(run(scoreAll(elimination), { type: "CompleteEvent" }).phase).toBe("complete");
  }
});

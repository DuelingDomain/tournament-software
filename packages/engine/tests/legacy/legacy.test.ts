import { describe, expect, it } from "vitest";
import { parseLegacyPlayerList, parseLegacyTournament, serializeLegacyPlayerList, serializeLegacyTournament } from "../../src/legacy/index.js";
import { standings, type EventState } from "../../src/index.js";
import { context, event, fixture, run, scoreAll } from "../engine/fixtures.js";
import { playerListXml, tournamentXml } from "./fixtures.js";

function observable(state: EventState) {
  const name = (id: string | null) => state.players.find(p => p.id === id)?.name ?? null;
  return {
    players: state.players.map(p => [p.name, p.status, p.droppedAfterRound, p.fixedTable, p.notes]).sort(),
    rounds: state.rounds.map(r => [r.number, r.stage, r.matches.map(m => [name(m.p1), name(m.p2), m.result, m.table])]),
  };
}

describe("legacy tournament files", () => {
  it("reads the documented element layout, recomputes scores and handles byes, drops, placeholders, staff and penalties", () => {
    const { state, players, warnings } = parseLegacyTournament(tournamentXml, context);
    expect(state.settings).toMatchObject({ name: "Evening & Friends", location: "Community Hall", startsAt: "2026-11-16T18:30:00.000Z", startingTable: 7 });
    expect(state.phase).toBe("swiss");
    expect(state.players.map(p => [p.name, p.memberId, p.userId, p.status, p.droppedAfterRound])).toEqual([
      ["Ada Stone", "12345673", null, "active", null], ["Bea Reed", "2", null, "dropped", 1],
      ["Cal Vale", "9999000000", null, "active", null], ["(n/a)", "42", null, "dropped", 2],
    ]);
    expect(players[0]).toMatchObject({ memberId: "12345673", firstName: "Ada", lastName: "Stone", playerId: state.players[0].id });
    expect(state.rounds.map(r => [r.number, r.stage, r.matches.map(m => m.result)])).toEqual([[1, "swiss", ["p1", "bye_win"]], [2, "swiss", ["draw", "bye_loss", "bye_win"]]]);
    expect(standings(state).map(r => [r.name, r.matchPoints, r.record])).toEqual([
      ["Cal Vale", 4, { wins: 1, losses: 0, draws: 1 }], ["Ada Stone", 4, { wins: 1, losses: 0, draws: 1 }],
      ["(n/a)", 3, { wins: 1, losses: 0, draws: 0 }], ["Bea Reed", 0, { wins: 0, losses: 2, draws: 0 }],
    ]);
    expect(state.staff).toEqual([]);
    expect(warnings).toContain("Legacy staff member Robin Judge was not imported; select a staff account to add them.");
    expect(warnings.some(w => w.includes("42") && w.includes("placeholder"))).toBe(true);
    expect(state.penalties.map(p => [p.penalty, p.judge, p.notes])).toEqual([["game_loss", "Robin Judge", "Checked <cards>"], ["warning", null, null]]);
    expect(state.settings.infractions.find(i => i.id === state.penalties[0].infractionId)?.label).toBe("UnrecognizedMinor");
  });

  it.each([
    ["<PlayerStructure>02</PlayerStructure>", "team"],
    ["<TournamentPlayers><TournamentTeam/></TournamentPlayers>", "team"],
    ["<TournamentStyleCode>04</TournamentStyleCode>", "Open Dueling"],
    ["<Structure>OpenDueling</Structure>", "Open Dueling"],
    ["<Format>Open</Format>", "Open Dueling"],
  ])("refuses unsupported event %s", (fields, message) => {
    expect(() => parseLegacyTournament(`<Tournament>${fields}</Tournament>`, context)).toThrow(expect.objectContaining({ code: "unsupported_legacy_event", message: expect.stringContaining(message) }));
  });

  it("accepts old staff wrappers and date field ordering without importing staff accounts", () => {
    const xml = `<Tournament><Name>Old</Name><Structure>Swiss</Structure><PlayerStructure>Individual</PlayerStructure>
      <ReferenceDateTime>02/01/2003</ReferenceDateTime><Date>16/11/2026</Date><Time>09:05</Time>
      <HeadJudge><Player><ID>1</ID><FirstName>Head</FirstName></Player></HeadJudge>
      <Organizer><Player><ID>2</ID><FirstName>Host</FirstName></Player></Organizer>
      <ScoreKeeper><Player><ID>3</ID><FirstName>Desk</FirstName></Player></ScoreKeeper>
      <Judges><PlayerList><Player><ID>4</ID><FirstName>Floor</FirstName></Player></PlayerList></Judges></Tournament>`;
    const imported = parseLegacyTournament(xml, context);
    expect(imported.state.settings.startsAt).toBe("2026-11-16T09:05:00.000Z");
    expect(imported.warnings).toHaveLength(4);
    expect(imported.state.staff).toEqual([]);
  });

  it("detects playoff stages and obtains the cut from the first playoff round", () => {
    const xml = tournamentXml.replace("<PlayoffRound>0</PlayoffRound>", "<PlayoffRound>2</PlayoffRound>").replace("<Finalized>False</Finalized>", "<Finalized>True</Finalized>");
    const { state } = parseLegacyTournament(xml, context);
    expect(state.rounds.map(r => r.stage)).toEqual(["swiss", "playoff"]);
    expect(state.cut).toEqual([state.players[0].id, state.players[2].id, state.players[1].id, state.players[3].id]);
    expect(state.phase).toBe("complete");
    expect(standings(state).find(s => s.playerId === state.players[0].id)?.matchPoints).toBe(3);
  });

  it("round-trips documented players, rounds, results and drops", () => {
    const parsed = parseLegacyTournament(tournamentXml, context);
    const xml = serializeLegacyTournament(parsed.state, { eventId: "X99-004213", playerNames: Object.fromEntries(parsed.players.map(p => [p.playerId, p])) });
    expect(xml).toContain("<ID>0012345673</ID>");
    expect(xml).toContain("<Name>Evening &amp; Friends</Name>");
    const restored = parseLegacyTournament(xml, context).state;
    expect(observable(restored)).toEqual(observable(parsed.state));
    expect(restored.players.map(p => p.memberId).sort()).toEqual(["12345673", "2", "42", "9999000000"].sort());
  });

  it("round-trips an engine playoff with every two-player result and both bye outcomes", () => {
    let s = fixture([[[0, 1, "p1"], [2, 3, "p2"], [4, 5, "draw"], [6, 7, "double_loss"]],
      [[0, null, "bye_win"], [1, null, "bye_loss"], [2, 3, "p2"], [4, 5, "p1"], [6, 7, "p1"]]], 8);
    s.players.forEach((p, i) => { p.memberId = String(i + 1); });
    s = run(s, { type: "DropPlayer", playerId: s.players[7].id });
    s = run(s, { type: "CutToPlayoff", size: 4 });
    s = scoreAll(s);
    s = run(s, { type: "PairNextRound" });
    const xml = serializeLegacyTournament(s);
    const restored = parseLegacyTournament(xml, context).state;
    // Engine cut statuses have no drop-round field; the file records the round of elimination.
    for (const p of s.players) if (p.status === "cut") p.droppedAfterRound = s.cut.includes(p.id) ? 3 : 2;
    expect(observable(restored)).toEqual(observable(s));
  });

  it("allocates unique temporary IDs above reserved IDs and escapes names and notes", () => {
    const s = event(4);
    s.players[0].memberId = "9999000000";
    s.players[1].memberId = "12345673";
    s.players[2].memberId = "0012345673";
    s.players[3].name = `A & B <C> "D"`;
    const { state } = parseLegacyTournament(serializeLegacyTournament(s), context);
    expect(state.players.map(p => p.memberId)).toEqual(["12345673", "9999000000", "9999000001", "9999000002"]);
    expect(state.players.find(p => p.name === s.players[3].name)).toBeDefined();
  });

  it.each(["<Other/>", "<Tournament>", "<Other/><Tournament/>", "<Tournament/><Tournament/>", '<!DOCTYPE Tournament [<!ENTITY x "a">]><Tournament/>']) ("rejects malformed or unsupported XML", xml => {
    expect(() => parseLegacyTournament(xml, context)).toThrow(expect.objectContaining({ code: "invalid_legacy_xml" }));
  });
});

describe("legacy player list", () => {
  it("accepts serializer namespaces, singleton nodes, padded or plain IDs and escaped names", () => {
    expect(parseLegacyPlayerList(playerListXml)).toEqual([
      { memberId: "12345673", firstName: "Ada & Jo", lastName: "Stone" }, { memberId: "2", firstName: "Bea", lastName: "Reed" },
    ]);
    expect(parseLegacyPlayerList("<PlayerList><Player><FirstName>Solo</FirstName><ID>0000000042</ID></Player></PlayerList>")).toEqual([{ memberId: "42", firstName: "Solo", lastName: "" }]);
  });

  it("serializes plain member IDs in last-name order with an independent expected layout", () => {
    const xml = serializeLegacyPlayerList([{ memberId: "0012345673", firstName: "Ada & Jo", lastName: "Stone" }, { memberId: "2", firstName: "Bea", lastName: "Reed" }]);
    expect(xml).toBe('<?xml version="1.0" encoding="utf-8"?>\n<PlayerList>\n\t<Player>\n\t\t<FirstName>Bea</FirstName>\n\t\t<LastName>Reed</LastName>\n\t\t<ID>2</ID>\n\t</Player>\n\t<Player>\n\t\t<FirstName>Ada &amp; Jo</FirstName>\n\t\t<LastName>Stone</LastName>\n\t\t<ID>12345673</ID>\n\t</Player>\n</PlayerList>\n');
    expect(() => parseLegacyPlayerList("<Tournament/>")).toThrow(expect.objectContaining({ code: "invalid_legacy_xml" }));
  });
});

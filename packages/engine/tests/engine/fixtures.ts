import { applyCommand, createEvent, type Command, type EventSettings, type EventState, type MatchResult, type Round } from "../../src/index.js";

export const context = { now: "2026-11-16T12:00:00.000Z", seed: 123456789012345, actor: "desk" };

export function event(n = 4, settings: Partial<EventSettings> = {}): EventState {
  return applyCommand(createEvent({ name: "Community tournament", ...settings }, context), {
    type: "AddPlayers", players: Array.from({ length: n }, (_, i) => ({ userId: i + 1, name: `Player ${i + 1}` })),
  }, context);
}

export function run(state: EventState, command: Command, seed = context.seed): EventState {
  return applyCommand(state, command, { ...context, seed });
}

type FixtureMatch = [number, number | null, MatchResult | null];
export function fixture(rounds: FixtureMatch[][], n = 4, settings: Partial<EventSettings> = {}): EventState {
  const state = event(n, settings);
  state.phase = "swiss";
  state.rounds = rounds.map((matches, i): Round => ({ number: i + 1, stage: "swiss", seed: i, startedAt: null, endsAt: null, warnings: [],
    matches: matches.map(([a, b, result], j) => ({ id: `r${i + 1}m${j + 1}`, round: i + 1, table: b === null ? null : j + 1,
      p1: state.players[a].id, p2: b === null ? null : state.players[b].id, result, reports: [], extensionMinutes: 0 })),
  }));
  return state;
}

export function scoreAll(state: EventState, result: "p1" | "draw" = "p1"): EventState {
  for (const m of state.rounds.at(-1)?.matches ?? []) if (m.result === null) state = run(state, { type: "EnterResult", matchId: m.id, result });
  return state;
}

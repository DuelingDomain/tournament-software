import { applyCommand } from "./reducer.js";
import type { Command, CommandContext, EventState, MatchPlayerChange } from "./types.js";

/** Preview participant changes with the same validation and seed as execution. */
export function previewCommand(state: EventState, command: Command, ctx: CommandContext): MatchPlayerChange[] {
  const next = applyCommand(state, command, ctx);
  const before = new Map(state.rounds.flatMap(r => r.matches.map(m => [m.id, m] as const)));
  const after = new Map(next.rounds.flatMap(r => r.matches.map(m => [m.id, m] as const)));
  const changes: MatchPlayerChange[] = [];
  for (const matchId of new Set([...before.keys(), ...after.keys()])) {
    const previous = before.get(matchId) ?? null;
    const current = after.get(matchId) ?? null;
    if (previous && current && previous.p1 === current.p1 && previous.p2 === current.p2) continue;
    changes.push(structuredClone({ matchId, before: previous, after: current }));
  }
  return changes;
}

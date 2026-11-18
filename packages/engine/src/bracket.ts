import { competitors, teamSize } from "./competitors.js";
import { CommandError, type EventState, type Round } from "./types.js";
import { assignTables, makeMatch } from "./pairing.js";
import { winner } from "./standings.js";

/** Recursively reflect seeds: 8 slots become 1,8,4,5,2,7,3,6. */
function seedOrder(size: number): number[] {
  let seeds = [1];
  while (seeds.length < size) {
    const total = seeds.length * 2 + 1;
    seeds = seeds.flatMap(s => [s, total - s]);
  }
  return seeds;
}

export function initialBracket(state: EventState, entrants: string[], seed: number, random: () => number, ids: Set<string>): Round {
  if (!entrants.length) throw new CommandError("NO_PLAYERS", "Add at least one player before starting the bracket.");
  const number = (state.rounds.at(-1)?.number ?? 0) + 1;
  const size = Math.max(2, 2 ** Math.ceil(Math.log2(entrants.length)));
  const slots = seedOrder(size).map(s => entrants[s - 1] ?? null);
  const matches = [];
  for (let i = 0; i < slots.length; i += 2) {
    const a = slots[i], b = slots[i + 1];
    // Empty slots advance nothing; never construct a match with a missing p1.
    if (a === null && b === null) continue;
    matches.push(makeMatch(a ?? b!, a === null ? null : b, number, random, ids));
  }
  assignTables(matches, competitors(state), state.settings.startingTable, false, teamSize(state));
  return { number, stage: "playoff", seed, matches, startedAt: null, endsAt: null, warnings: [] };
}

export function advanceBracket(state: EventState, seed: number, random: () => number, ids: Set<string>): Round {
  const previous = state.rounds.at(-1);
  if (!previous || previous.stage !== "playoff") throw new CommandError("NO_BRACKET", "There is no playoff bracket to advance.");
  if (previous.matches.some(m => m.result === null)) throw new CommandError("MISSING_RESULTS", "Enter every result before advancing the bracket.");
  if (previous.matches.length <= 1) throw new CommandError("BRACKET_FINISHED", "The final is decided. Complete the event to finish.");
  const number = previous.number + 1;
  const matches = [];
  for (let i = 0; i < previous.matches.length; i += 2) {
    const a = winner(previous.matches[i]);
    const b = previous.matches[i + 1] ? winner(previous.matches[i + 1]) : null;
    if (a === null && b === null) continue;
    matches.push(makeMatch(a ?? b!, a === null ? null : b, number, random, ids));
  }
  assignTables(matches, competitors(state), state.settings.startingTable, false, teamSize(state));
  return { number, stage: "playoff", seed, matches, startedAt: null, endsAt: null, warnings: [] };
}

/** Only bracket participants are updated; independently dropped players stay dropped. */
export function refreshEliminations(state: EventState): void {
  const eliminated = new Set<string>();
  for (const r of state.rounds.filter(r => r.stage === "playoff")) for (const m of r.matches) {
    const won = winner(m);
    if (won && m.p2 !== null) eliminated.add(won === m.p1 ? m.p2 : m.p1);
  }
  for (const p of competitors(state)) if (state.cut.includes(p.id) && p.status !== "dropped") {
    p.status = eliminated.has(p.id) ? "cut" : "active";
  }
}

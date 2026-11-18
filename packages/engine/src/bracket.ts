import { competitors, teamSize } from "./competitors.js";
import { CommandError, type EventState, type Match, type Round } from "./types.js";
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
  assignTables(matches, competitors(state), state.settings.startingTable, true, teamSize(state));
  return { number, stage: "playoff", seed, matches, startedAt: null, endsAt: null, warnings: [] };
}

export function bracketMatchesInOrder(matches: readonly Match[]): Match[] {
  const ordered = [...matches];
  if (ordered.every(m => (m.table ?? m.byeTable) !== undefined)) {
    ordered.sort((a, b) => (a.table ?? a.byeTable!) - (b.table ?? b.byeTable!));
  }
  return ordered;
}

export function advanceBracket(state: EventState, seed: number, random: () => number, ids: Set<string>): Round {
  const previous = state.rounds.at(-1);
  if (!previous || previous.stage !== "playoff") throw new CommandError("NO_BRACKET", "There is no playoff bracket to advance.");
  if (previous.matches.some(m => m.result === null)) throw new CommandError("MISSING_RESULTS", "Enter every result before advancing the bracket.");
  if (previous.matches.length <= 1) throw new CommandError("BRACKET_FINISHED", "The final is decided. Complete the event to finish.");
  const number = previous.number + 1;
  const active = new Set(competitors(state).filter(p => p.status === "active").map(p => p.id));
  const advancing = bracketMatchesInOrder(previous.matches).map(match => {
    const id = winner(match);
    return id !== null && active.has(id) ? id : null;
  });
  const matches = [];
  for (let i = 0; i < advancing.length; i += 2) {
    const a = advancing[i], b = advancing[i + 1] ?? null;
    if (a === null && b === null) throw new CommandError("EMPTY_BRACKET_MATCH", "Two feeder matches have no active winner.");
    const match = makeMatch(a ?? b!, a === null ? null : b, number, random, ids);
    match.result = null;
    matches.push(match);
  }
  assignTables(matches, competitors(state), state.settings.startingTable, true, teamSize(state));
  return { number, stage: "playoff", seed, matches, startedAt: null, endsAt: null, warnings: [] };
}

/** Apply results from the affected matches so a later report cannot rewrite earlier eliminations. */
export function updateEliminations(state: EventState, matches: Match[], reset = false): void {
  const statuses = new Map<string, "active" | "cut">();
  for (const match of matches) {
    const won = reset ? null : winner(match);
    statuses.set(match.p1, won !== null && won !== match.p1 ? "cut" : "active");
    if (match.p2 !== null) statuses.set(match.p2, won !== null && won !== match.p2 ? "cut" : "active");
  }
  const seeded = new Set(state.cut);
  for (const p of competitors(state)) {
    const status = statuses.get(p.id);
    if (status && p.status !== "dropped" && seeded.has(p.id)) p.status = status;
  }
}

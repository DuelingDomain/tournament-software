import type { InfractionDef } from "./types.js";

export const DEFAULT_INFRACTIONS: InfractionDef[] = [
  { id: "slow_play", label: "Slow play", defaultPenalty: "warning" },
  { id: "conduct_minor", label: "Unsporting conduct – minor", defaultPenalty: "warning" },
  { id: "deck_problem", label: "Deck problem", defaultPenalty: "game_loss" },
  { id: "extra_look", label: "Looking at extra cards", defaultPenalty: "warning" },
  { id: "extra_draw", label: "Drawing extra cards", defaultPenalty: "game_loss" },
  { id: "rule_violation", label: "Game rule violation", defaultPenalty: "warning" },
  { id: "maintain_state", label: "Failure to maintain game state", defaultPenalty: "warning" },
  { id: "communication", label: "Communication policy violation", defaultPenalty: "warning" },
  { id: "tardiness", label: "Tardiness", defaultPenalty: "game_loss" },
  { id: "outside_help", label: "Outside assistance", defaultPenalty: "match_loss" },
  { id: "marked_cards", label: "Marked cards", defaultPenalty: "game_loss" },
  { id: "cheating", label: "Cheating", defaultPenalty: "disqualification" },
];

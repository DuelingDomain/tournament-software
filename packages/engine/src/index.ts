import type { ScorekeeperEngine } from "./types.js";
import { applyCommand, createEvent } from "./reducer.js";
import { standings, suggestRounds } from "./standings.js";
import { playerView, publicView } from "./views.js";
import { integrity } from "./integrity.js";

export { applyCommand, createEvent, standings, suggestRounds, playerView, publicView, integrity };
export * from "./member-id.js";
export { DEFAULT_INFRACTIONS } from "./defaults.js";
export * from "./types.js";
export * from "./staff.js";
export * from "./competitors.js";

export const engine: ScorekeeperEngine = { createEvent, applyCommand, standings, suggestRounds, publicView, playerView, integrity };

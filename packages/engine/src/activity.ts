import type { ActivityEntry, Command, CommandContext, EventState } from "./types.js";

/** Append only on a state copy that will be committed with its successful action. */
export function recordActivity(state: EventState, action: ActivityEntry["action"], ctx: CommandContext, command?: Command): void {
  state.activityLog = [...(state.activityLog ?? []), { actor: ctx.actor, at: ctx.now, action,
    ...(command ? { command: structuredClone(command) } : {}) }].slice(-100);
}

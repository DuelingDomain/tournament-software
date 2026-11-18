import { CommandError, type StaffAssignment, type StaffPosition, type StaffRole } from "./types.js";

export const POSITION_ROLES: Record<StaffPosition, StaffRole> = {
  organizer: "organizer", head_judge: "head_judge", assistant_head_judge: "head_judge",
  floor_judge_team_lead: "judge", floor_judge: "judge", scorekeeper: "scorekeeper",
  event_manager: "staff", event_staff: "staff",
};
export const ROLE_POSITIONS: Record<StaffRole, StaffPosition> = {
  organizer: "organizer", head_judge: "head_judge", judge: "floor_judge", scorekeeper: "scorekeeper", staff: "event_staff",
};
export function staffAssignment(entry: Pick<StaffAssignment, "role" | "position">): { role: StaffRole; position: StaffPosition } {
  const position = entry.position ?? (entry.role && ROLE_POSITIONS[entry.role]);
  if (!position || !Object.hasOwn(POSITION_ROLES, position)) throw new CommandError("INVALID_POSITION", "Choose a staff position or role.");
  const role = POSITION_ROLES[position];
  if (entry.role !== undefined && role !== entry.role) throw new CommandError("INVALID_POSITION", "The staff position and role must agree.");
  return { role, position };
}

export const STAFF_POSITIONS: StaffPosition[] = ["organizer", "head_judge", "assistant_head_judge", "floor_judge_team_lead", "floor_judge", "scorekeeper", "event_manager", "event_staff"];
export function staffPositionCode(position: StaffPosition): string { return String(STAFF_POSITIONS.indexOf(position) + 1).padStart(2, "0"); }

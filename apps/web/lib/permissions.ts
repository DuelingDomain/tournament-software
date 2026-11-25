import { staffAssignment, type Command, type EventState, type StaffRole } from "@dd-tournament/engine";
import type { EventRecord } from "./db";
import { HttpError } from "./http";

export function viewerRole(event: EventRecord, userId: number): StaffRole | null {
  return event.ownerUserId === userId ? "organizer" : event.state.staff.find(s => s.userId === userId)?.role ?? null;
}
export function requireStaff(event: EventRecord, userId: number): StaffRole {
  const role = viewerRole(event, userId);
  if (!role) throw new HttpError(403, "forbidden_role");
  return role;
}
const roundAndPlayer = ["organizer", "head_judge", "scorekeeper"] satisfies StaffRole[];
const judging = ["organizer", "head_judge", "judge"] satisfies StaffRole[];
const staffAdmin = ["organizer", "head_judge"] satisfies StaffRole[];
const permissions: Record<Command["type"], readonly StaffRole[]> = {
  UpdateSettings: roundAndPlayer, AddPlayers: [...roundAndPlayer, "staff"], UpdatePlayer: roundAndPlayer,
  LinkPlayerAccount: roundAndPlayer, ReEnroll: roundAndPlayer, RemovePlayer: roundAndPlayer,
  SetCheckedIn: [...roundAndPlayer, "staff"], AddStaff: staffAdmin, SetStaffRole: staffAdmin, SetStaffPosition: staffAdmin, RemoveStaff: staffAdmin,
  AddTeams: roundAndPlayer, UpdateTeam: roundAndPlayer, RemoveTeam: roundAndPlayer, ReEnrollTeam: roundAndPlayer, UndropTeam: roundAndPlayer, DropTeam: [...roundAndPlayer, "judge"],
  PairNextRound: roundAndPlayer, RepairRound: roundAndPlayer, CancelRound: roundAndPlayer, SwapPlayers: roundAndPlayer,
  SetPairing: roundAndPlayer, SplitMatch: roundAndPlayer, CreateMatch: roundAndPlayer, AddByeMatch: roundAndPlayer,
  StartTimer: roundAndPlayer, AdjustTimer: roundAndPlayer, ExtendMatch: [...roundAndPlayer, "judge"],
  AdjustPoints: roundAndPlayer, EnterResult: [...roundAndPlayer, "judge"], ReportResult: roundAndPlayer, DropPlayer: [...roundAndPlayer, "judge"],
  UndropPlayer: roundAndPlayer, CutToPlayoff: roundAndPlayer, SwissCut: roundAndPlayer, UndoSwissCut: roundAndPlayer,
  CompleteEvent: roundAndPlayer, ReopenEvent: roundAndPlayer, AddPenalty: judging, RemovePenalty: judging,
};
export function requireCommand(event: EventRecord, viewerUserId: number, command: Command) {
  const role = requireStaff(event, viewerUserId);
  if (!permissions[command.type].includes(role)) throw new HttpError(403, "forbidden_role");
  if (command.type === "EnterResult" && command.swapPlayers && !permissions.SwapPlayers.includes(role)) throw new HttpError(403, "forbidden_role");
  const owner = event.ownerUserId;
  // The owner is the organizer when listed. Nobody else becomes one (an organizer saved by older code keeps the role).
  const organizerOk = (userId: number, isOrganizer: boolean) => userId === owner ? isOrganizer : !isOrganizer || event.state.staff.some(s => s.userId === userId && s.role === "organizer");
  if (command.type === "UpdateSettings" && command.staff) {
    if (role !== "organizer" && role !== "head_judge") throw new HttpError(403, "forbidden_role");
    if (command.staff.length === 0) throw new HttpError(400, "staff_required");
    if (command.staff.some(s => !organizerOk(s.userId, staffAssignment(s).role === "organizer"))) throw new HttpError(403, "forbidden_role");
    if (viewerUserId !== owner && event.state.staff.some(s => s.userId === owner) && !command.staff.some(s => s.userId === owner)) throw new HttpError(403, "forbidden_role");
    if (role === "head_judge") {
      const organizers = event.state.staff.filter(s => s.role === "organizer");
      if (organizers.some(s => !command.staff!.some(n => n.userId === s.userId && n.name === s.name && staffAssignment(n).role === "organizer"))
        || command.staff.some(n => staffAssignment(n).role === "organizer" && !organizers.some(s => s.userId === n.userId))) throw new HttpError(403, "forbidden_role");
    }
  }
  if (role === "head_judge") {
    const target = "staffId" in command ? event.state.staff.find(s => s.id === command.staffId) : undefined;
    if (target?.role === "organizer" || (command.type === "AddStaff" && staffAssignment(command).role === "organizer") || (command.type === "SetStaffPosition" && command.position === "organizer") || (command.type === "SetStaffRole" && command.role === "organizer")) throw new HttpError(403, "forbidden_role");
  }
  if ("staffId" in command) {
    const target = event.state.staff.find(s => s.id === command.staffId);
    // Only the owner removes the owner's own row; no one edits it. The list never goes empty.
    if (target?.userId === owner && (command.type !== "RemoveStaff" || viewerUserId !== owner)) throw new HttpError(403, "forbidden_role");
    if (command.type === "RemoveStaff" && target && event.state.staff.length <= 1) throw new HttpError(400, "staff_required");
  }
}
export function requireImport(event: EventRecord, userId: number) {
  if (!["organizer", "head_judge", "scorekeeper"].includes(requireStaff(event, userId))) throw new HttpError(403, "forbidden_role");
}
export function requireDummyData(event: EventRecord, userId: number) {
  const role = requireStaff(event, userId);
  if (role !== "organizer" && role !== "head_judge") throw new HttpError(403, "forbidden_role");
}
export function joinReason(state: EventState, memberId: string | null): "closed" | "member_id_required" | "late_entry_closed" | undefined {
  if (!state.settings.registrationOpen || state.phase === "playoff" || state.phase === "complete") return "closed";
  if (state.phase !== "registration" && !state.settings.allowLateEntry) return "late_entry_closed";
  if (state.settings.requireMemberId && !memberId) return "member_id_required";
}

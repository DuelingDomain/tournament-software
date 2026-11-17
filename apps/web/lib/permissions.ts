import type { Command, EventState, StaffRole } from "@dd-tournament/engine";
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
  SetCheckedIn: [...roundAndPlayer, "staff"], AddStaff: staffAdmin, SetStaffRole: staffAdmin, RemoveStaff: staffAdmin,
  PairNextRound: roundAndPlayer, RepairRound: roundAndPlayer, CancelRound: roundAndPlayer, SwapPlayers: roundAndPlayer,
  SetPairing: roundAndPlayer, SplitMatch: roundAndPlayer, CreateMatch: roundAndPlayer, AddByeMatch: roundAndPlayer,
  StartTimer: roundAndPlayer, AdjustTimer: roundAndPlayer, ExtendMatch: [...roundAndPlayer, "judge"],
  EnterResult: [...roundAndPlayer, "judge"], ReportResult: roundAndPlayer, DropPlayer: [...roundAndPlayer, "judge"],
  UndropPlayer: roundAndPlayer, CutToPlayoff: roundAndPlayer, SwissCut: roundAndPlayer, UndoSwissCut: roundAndPlayer,
  CompleteEvent: roundAndPlayer, ReopenEvent: roundAndPlayer, AddPenalty: judging, RemovePenalty: judging,
};
export function requireCommand(event: EventRecord, userId: number, command: Command) {
  const role = requireStaff(event, userId);
  if (!permissions[command.type].includes(role)) throw new HttpError(403, "forbidden_role");
  if (role === "head_judge") {
    const target = "staffId" in command ? event.state.staff.find(s => s.id === command.staffId) : undefined;
    if (target?.role === "organizer" || ("role" in command && command.role === "organizer")) throw new HttpError(403, "forbidden_role");
  }
  if ("staffId" in command && event.state.staff.find(s => s.id === command.staffId)?.userId === event.ownerUserId)
    throw new HttpError(403, "forbidden_role");
}
export function requireImport(event: EventRecord, userId: number) {
  if (!["organizer", "head_judge", "scorekeeper"].includes(requireStaff(event, userId))) throw new HttpError(403, "forbidden_role");
}
export function joinReason(state: EventState, memberId: string | null): "closed" | "member_id_required" | "late_entry_closed" | undefined {
  if (!state.settings.registrationOpen || state.phase === "playoff" || state.phase === "complete") return "closed";
  if (state.phase !== "registration" && !state.settings.allowLateEntry) return "late_entry_closed";
  if (state.settings.requireMemberId && !memberId) return "member_id_required";
}

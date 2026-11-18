import type { Command, StaffRole } from "@dd-tournament/engine";

// Mirror of the server's role matrix (lib/permissions.ts). The server is the authority;
// this only decides which controls to show or disable.
const manage: StaffRole[] = ["organizer", "head_judge", "scorekeeper"];
const judging: StaffRole[] = ["organizer", "head_judge", "judge"];
const staffAdmin: StaffRole[] = ["organizer", "head_judge"];
const PERMISSIONS: Record<Command["type"], readonly StaffRole[]> = {
  UpdateSettings: manage, AddPlayers: [...manage, "staff"], UpdatePlayer: manage, LinkPlayerAccount: manage,
  ReEnroll: manage, RemovePlayer: manage, SetCheckedIn: [...manage, "staff"],
  AddStaff: staffAdmin, SetStaffRole: staffAdmin, SetStaffPosition: staffAdmin, RemoveStaff: staffAdmin,
  AddTeams: manage, UpdateTeam: manage, RemoveTeam: manage, ReEnrollTeam: manage, UndropTeam: manage, DropTeam: [...manage, "judge"],
  PairNextRound: manage, RepairRound: manage, CancelRound: manage, SwapPlayers: manage, SetPairing: manage,
  SplitMatch: manage, CreateMatch: manage, AddByeMatch: manage, StartTimer: manage, AdjustTimer: manage,
  ExtendMatch: [...manage, "judge"], EnterResult: [...manage, "judge"], ReportResult: manage,
  DropPlayer: [...manage, "judge"], UndropPlayer: manage, CutToPlayoff: manage, SwissCut: manage, UndoSwissCut: manage,
  CompleteEvent: manage, ReopenEvent: manage, AddPenalty: judging, RemovePenalty: judging,
};
export function can(role: StaffRole, type: Command["type"]) { return PERMISSIONS[type].includes(role); }
export const canImport = (role: StaffRole) => manage.includes(role);
export const canEditDiscord = (role: StaffRole) => role === "organizer";
export const ROLE_LABEL: Record<StaffRole, string> = {
  organizer: "Organizer", head_judge: "Head judge", judge: "Judge", scorekeeper: "Scorekeeper", staff: "Staff",
};
export const ROLES: StaffRole[] = ["organizer", "head_judge", "judge", "scorekeeper", "staff"];

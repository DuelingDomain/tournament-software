import type { EventFormat, EventSettings, EventStyle, PlayerStructure, StaffPosition, StaffRole } from "@dd-tournament/engine";

export const POSITIONS: StaffPosition[] = ["organizer", "head_judge", "assistant_head_judge", "floor_judge_team_lead", "floor_judge", "scorekeeper", "event_manager", "event_staff"];
export const POSITION_LABEL: Record<StaffPosition, string> = {
  organizer: "Organizer", head_judge: "Head Judge", assistant_head_judge: "Assistant Head Judge", floor_judge_team_lead: "Floor Judge - Team Lead",
  floor_judge: "Floor Judge", scorekeeper: "Scorekeeper", event_manager: "Event Manager", event_staff: "Event Staff",
};
/** Mirror of the server's position-to-role table; used only to show a person's position when none is stored. */
export const POSITION_OF_ROLE: Record<StaffRole, StaffPosition> = { organizer: "organizer", head_judge: "head_judge", judge: "floor_judge", scorekeeper: "scorekeeper", staff: "event_staff" };

export const STYLES: { value: EventStyle; label: string }[] = [
  { value: "advanced", label: "Advanced" }, { value: "traditional", label: "Traditional" }, { value: "sealed", label: "Sealed" }, { value: "open_dueling", label: "Open Dueling" },
];
export const PAIRINGS: { value: EventFormat; label: string }[] = [
  { value: "swiss", label: "Swiss" }, { value: "single_elim", label: "Single Elimination" }, { value: "open_dueling", label: "Open Dueling" },
];
export const STRUCTURES: { value: PlayerStructure; label: string }[] = [
  { value: 1, label: "Individual" }, { value: 2, label: "Tag Dueling" }, { value: 3, label: "Three-Player Team" }, { value: 4, label: "Four-Player Team" }, { value: 5, label: "Five-Player Team" },
];
export const structureLabel = (n: number) => STRUCTURES.find(s => s.value === n)?.label ?? "Individual";
export const pairingLabel = (f: EventFormat) => PAIRINGS.find(p => p.value === f)?.label ?? "Swiss";

export const CUTS = [0, 2, 4, 8, 16, 32, 64];
export const DEFAULT_SETTINGS: Pick<EventSettings, "style" | "format" | "playerStructure" | "plannedRounds" | "topCut" | "tiebreak" | "startingTable" | "roundMinutes" | "publicNames" | "registrationOpen" | "requireMemberId" | "allowLateEntry"> = {
  style: "advanced", format: "swiss", playerStructure: 1, plannedRounds: null, topCut: 0, tiebreak: "legacy", startingTable: 1, roundMinutes: 50,
  publicNames: "full", registrationOpen: true, requireMemberId: false, allowLateEntry: true,
};

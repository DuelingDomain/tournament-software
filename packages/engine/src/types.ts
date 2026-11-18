// Scorekeeper contract. A whole event is one JSON document (EventState).
// Every change is a Command applied by the pure reducer `applyCommand`.
// No database, clock or Math.random inside the engine: the service passes
// `now` and a seed in CommandContext. Views strip secrets for each audience.

export type PlayerId = string; // short random id, stable for the event
export type MatchId = string;

export type TiebreakMode = "floor33" | "legacy"; // floor33: each opponent's win% counts at least 33.3%
export type EventFormat = "swiss" | "single_elim" | "open_dueling";
export type EventPhase = "registration" | "swiss" | "playoff" | "complete";

export type MatchResult =
  | "p1" | "p2" | "draw" | "double_loss" // two-player results
  | "bye_win" | "bye_loss";             // one-player results (p2 null)

export type EventStyle = "advanced" | "traditional" | "sealed" | "open_dueling";
export type PlayerStructure = 1 | 2 | 3 | 4 | 5;
export interface Location {
  id: string; name: string; address1: string; address2: string; city: string;
  state: string; postal: string; country: string; phone: string; website: string;
}

export interface EventSettings {
  name: string;
  format: EventFormat;
  style: EventStyle;
  playerStructure: PlayerStructure;
  locationId: string | null;
  locationDetails: Location | null;
  /** Planned Swiss rounds; null = organizer decides as they go. */
  plannedRounds: number | null;
  /** 0 = no cut. Otherwise 2, 4, 8, 16, 32 or 64. */
  topCut: number;
  tiebreak: TiebreakMode;
  startingTable: number; // default 1
  roundMinutes: number;  // default 50
  location: string | null;
  startsAt: string | null; // ISO
  /** Organizer's IANA time zone for local file exports. Defaults to UTC. */
  timeZone?: string;
  /** Infraction list the organizer can edit; generic defaults from the engine. */
  infractions: InfractionDef[];
  publicNames: "full" | "initials"; // how names appear on the public page
  /** Players can join themselves while phase = registration (signed-in accounts only). */
  registrationOpen: boolean;
  /** Require a member ID (the legacy 10-digit player number) to enter. */
  requireMemberId: boolean;
  /** Late entry allowed after round 1 is paired. */
  allowLateEntry: boolean;
}

export interface InfractionDef { id: string; label: string; defaultPenalty: Penalty }
export type Penalty = "caution" | "warning" | "game_loss" | "match_loss" | "disqualification";

export interface Player {
  id: PlayerId;
  /** DuelingDomain users.id; null for unclaimed legacy imports and dummy entries. */
  userId: number | null;
  name: string; // display name snapshot at entry; staff may edit
  /** Legacy 10-digit player number stored as digits without leading zeros
   *  (padding is display/export only). Validated with the check digit as a warning, never a block. */
  memberId: string | null;
  status: "active" | "dropped" | "cut";
  droppedAfterRound: number | null;
  enteredRound: number; // 1 for normal entry; >1 for late entry
  fixedTable: number | null; // accessibility seat, required in Swiss and preferred in playoffs
  openDuelingPoints?: number;
  checkedIn: boolean;
  notes: string | null;
}

/** Team IDs occupy the reserved numeric team range; member IDs remain person IDs. */
export interface Team extends Player { memberIds: PlayerId[] }
export interface TeamEntry { teamId?: string; name: string; memberIds: PlayerId[] }
export type UndropOption = "bye_loss" | "bye_win" | "next_round" | "swap_with_dropped" | "take_bye" | "repair" | "swap_previous_opponent";

export interface Match {
  id: MatchId;
  round: number;
  table: number | null; // null for byes
  byeTable?: number; // reserved table number for file exchange and bracket order
  p1: PlayerId;
  p2: PlayerId | null;
  result: MatchResult | null; // null = unreported
  /** Player self-reports awaiting confirmation (see ReportResult). */
  reports: { by: PlayerId; result: MatchResult; at: string }[];
  extensionMinutes: number;
}

/** Participant edits and cleared results. Creation has before null and removal has after null. */
export interface MatchPlayerChange {
  matchId: MatchId;
  before: Match | null;
  after: Match | null;
}

export interface Round {
  number: number; // 1-based across the whole event
  stage: "swiss" | "playoff";
  seed: number; // pairing seed, recorded for audit/reproduction
  startedAt: string | null; // timer start
  /** When the round was paired; absent on events created before it was recorded and on imports. */
  pairedAt?: string;
  endsAt: string | null;
  matches: Match[];
  /** Set when pairing could not avoid a rematch or a repeat bye; shown as a warning. */
  warnings: string[];
}

export interface PenaltyEntry {
  id: string;
  playerId: PlayerId;
  round: number | null;
  infractionId: string;
  penalty: Penalty;
  judge: string | null;
  notes: string | null;
  at: string;
}

export type StaffRole = "organizer" | "head_judge" | "judge" | "scorekeeper" | "staff";
export type StaffPosition = "organizer" | "head_judge" | "assistant_head_judge" | "floor_judge_team_lead" | "floor_judge" | "scorekeeper" | "event_manager" | "event_staff";
export interface StaffAssignment { userId: number; name: string; role?: StaffRole; position?: StaffPosition }
/** Staff are DuelingDomain accounts. The event owner is always an organizer. */
export interface StaffMember { id: string; userId: number; name: string; role: StaffRole; position?: StaffPosition }

export interface EventState {
  schemaVersion: 1;
  settings: EventSettings;
  phase: EventPhase;
  players: Player[];
  teams: Team[];
  playerStructureLocked?: boolean;
  activityLog?: ActivityEntry[];
  rounds: Round[];
  /** Players who made the cut, in seed order. Empty until CutToPlayoff. */
  cut: PlayerId[];
  /** Day-2 style cuts that continue Swiss (min points or top X). History kept for undo. */
  swissCuts: { afterRound: number; mode: "min_points" | "top"; value: number; cutPlayers: PlayerId[];
    /** Cleared when cancellation rolls back to this cut's boundary. */
    roundPairedAfter?: boolean }[];
  penalties: PenaltyEntry[];
  staff: StaffMember[];
  /** Event number from a tournament file (letter, two digits, dash, six digits); kept only so the file can be written back. */
  legacyEventId?: string;
  legacyStaff?: { memberId: string | null; name: string; position: StaffPosition }[];
  createdAt: string;
  completedAt: string | null;
}

export interface Standing {
  rank: number; // shared ranks: 1, 2, 2, 4
  playerId: PlayerId;
  name: string;
  status: Player["status"];
  openDuelingPoints?: number;
  matchPoints: number;
  record: { wins: number; losses: number; draws: number };
  /** Percentages 0..100 with one decimal, already truncated the documented way. */
  omw: number;
  oomw: number;
  playoffFinish: number | null; // 1 = winner, 2 = finalist, 3 = semifinal loser (shared), ...
}

export interface CommandContext { now: string; seed: number; actor: string }

export type Command =
  // Setup
  | { type: "UpdateSettings"; settings: Partial<Omit<EventSettings, "format">> & { format?: EventFormat }; staff?: StaffAssignment[] }
  | { type: "AddPlayers"; players: { userId: number | null; name: string; memberId?: string | null }[] } // service resolves accounts; late entry after R1 = bye losses for every round already paired, including the current one; duplicate non-null userId refused
  | { type: "UpdatePlayer"; playerId: PlayerId; name?: string; memberId?: string | null; fixedTable?: number | null; notes?: string | null }
  | { type: "LinkPlayerAccount"; playerId: PlayerId; userId: number } // claim an imported entry
  | { type: "ReEnroll"; playerId: PlayerId } // dropped player re-enters: bye losses for every missed round incl. current (legacy re-enroll)
  | { type: "RemovePlayer"; playerId: PlayerId } // registration only
  | { type: "SetCheckedIn"; playerId: PlayerId; checkedIn: boolean }
  | ({ type: "AddStaff" } & StaffAssignment)
  | { type: "SetStaffPosition"; staffId: string; position: StaffPosition }
  | { type: "SetStaffRole"; staffId: string; role: StaffRole }
  | { type: "RemoveStaff"; staffId: string }
  | { type: "AddTeams"; teams: TeamEntry[] }
  | { type: "UpdateTeam"; teamId: string; name?: string; memberIds?: PlayerId[]; fixedTable?: number | null }
  | { type: "RemoveTeam"; teamId: string }
  | { type: "DropTeam"; teamId: string }
  | { type: "ReEnrollTeam"; teamId: string }
  | { type: "UndropTeam"; teamId: string; option: UndropOption; swapWith?: PlayerId }
  // Rounds
  | { type: "PairNextRound" } // Swiss round, first playoff round is via CutToPlayoff, later playoff rounds advance the bracket
  | { type: "RepairRound"; round?: number } // deletes current results and re-pairs; an explicit earlier round is refused
  | { type: "CancelRound" }   // delete the current round; cancelling the first playoff round undoes the cut
  | { type: "SwapPlayers"; a: PlayerId; b: PlayerId } // manual pairing edit in the current round
  | { type: "SetPairing"; matchId: MatchId; p1: PlayerId; p2: PlayerId | null } // manual edit; p2 null = bye
  | { type: "SplitMatch"; matchId: MatchId } // current round: both players become unpaired (must be re-paired before results)
  | { type: "CreateMatch"; p1: PlayerId; p2: PlayerId | null; table?: number | null } // current round; pairs unpaired players
  | { type: "AddByeMatch"; playerId: PlayerId; result: "bye_win" | "bye_loss" } // current round
  | { type: "StartTimer"; minutes?: number }
  | { type: "AdjustTimer"; deltaMinutes: number }
  | { type: "ExtendMatch"; matchId: MatchId; minutes: number }
  | { type: "AdjustPoints"; playerId: PlayerId; delta: number }
  // Results
  | { type: "EnterResult"; matchId: MatchId; result: MatchResult | null; drop?: "loser" | "both" | "none"; swapPlayers?: boolean } // set swapPlayers for a result correction
  | { type: "ReportResult"; playerId: PlayerId; matchId: MatchId; result: MatchResult } // player self-report: applied when both agree; a disagreement stays pending for staff
  | { type: "DropPlayer"; playerId: PlayerId }
  | { type: "UndropPlayer"; playerId: PlayerId; option: UndropOption; swapWith?: PlayerId } // current-round re-entry and pairing options
  // Cut and finish
  | { type: "CutToPlayoff"; size?: number; tieOrder?: PlayerId[] } // tieOrder lets the organizer override the seeded tie-break at the cut line
  | { type: "SwissCut"; mode: "min_points" | "top"; value: number; tieOrder?: PlayerId[]; pairNext?: true } // Day-2 cut; optionally pairs the next round atomically
  | { type: "UndoSwissCut" }
  | { type: "CompleteEvent" }
  | { type: "ReopenEvent" }
  // Judging
  | { type: "AddPenalty"; playerId: PlayerId; infractionId: string; penalty?: Penalty; round?: number | null; judge?: string | null; notes?: string | null }
  | { type: "RemovePenalty"; penaltyId: string };

export type CommandType = Command["type"];
export interface ActivityEntry { actor: string; at: string; action: CommandType | "CreateEvent" | "ImportTournament" | "ImportPlayers"; command?: Command }
export interface PrintableCompetitor {
  id: string; name: string; memberId: string | null;
  members: { id: string; name: string; memberId: string | null; position: number }[];
}
export interface PrintMatch {
  id: string; round: number; stage: Round["stage"]; table: number | null; tables: number[];
  p1: PrintableCompetitor; p2: PrintableCompetitor | null; result: MatchResult | null; extensionMinutes: number;
}
export interface PrintData {
  matches: PrintMatch[];
  pairingsByTeam: { round: number; matchId: string; table: number | null; tables: number[]; team: PrintableCompetitor; opponent: PrintableCompetitor | null; result: MatchResult | null }[];
  unreportedMatches: PrintMatch[];
  pairedDownPlayers: { round: number; matchId: string; table: number | null; playerId: string; name: string; points: number;
    opponentId: string | null; opponentName: string | null; opponentPoints: number | null; isBye: boolean }[];
  penalties: (Omit<PenaltyEntry, "judge"> & { player: PrintableCompetitor; infraction: string; judge: string | null })[];
}

export class CommandError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "CommandError"; }
}

// ---- Views (what each audience receives) ----

export interface PublicMatchView {
  id: MatchId; table: number | null; p1: string; p2: string | null; // display names (initials if publicNames = initials)
  p1Id: PlayerId; p2Id: PlayerId | null;
  tables: number[];
  p1Members: { id: PlayerId; name: string }[]; p2Members: { id: PlayerId; name: string }[];
  result: MatchResult | null; p1Points: number; p2Points: number | null;
}

export interface PublicView {
  name: string; format: EventFormat; phase: EventPhase; location: string | null; startsAt: string | null;
  plannedRounds: number | null; topCut: number; tiebreak: TiebreakMode;
  playerStructure: PlayerStructure; style: EventStyle; teamCount: number;
  teams: { id: string; name: string; status: Player["status"]; members: { id: string; name: string }[] }[];
  playerCount: number;
  currentRound: { number: number; stage: "swiss" | "playoff"; startedAt: string | null; endsAt: string | null; matches: PublicMatchView[] } | null;
  standings: Standing[]; // names already public-formatted
  bracket: { round: number; matches: PublicMatchView[] }[]; // playoff rounds only
  version: number;
}

export interface IntegrityReport {
  repeatMatches: { a: PlayerId; b: PlayerId; rounds: number[] }[]; // players who met more than once
  pairedTwiceInRound: { round: number; playerId: PlayerId }[];
  unpairedActive: PlayerId[]; // current round
  memberIdWarnings: { playerId: PlayerId; memberId: string; problem: "check_digit" | "duplicate" }[];
}

export interface DeskView {
  state: EventState; standings: Standing[]; suggestedRounds: number; version: number;
  integrity: IntegrityReport;
  printData: PrintData;
  links: { public: string; desk: string; join: string };
  /** The signed-in viewer's role on this event. */
  viewerRole: StaffRole;
  /** Account id of the event owner (set by the service). */
  ownerUserId?: number;
  /** Staff-only account details per player (from the service, not the engine). */
  accounts: Record<PlayerId, { userId: number | null; username: string | null; discordUserId: string | null; discordUsername: string | null }>;
}

export interface PlayerView {
  event: PublicView;
  me: { id: PlayerId; name: string; status: Player["status"]; standing: Standing | null; teamId: string | null };
  currentMatch: (PublicMatchView & { myTable: number | null; myReport: MatchResult | null; opponentReport: MatchResult | null }) | null;
  history: { round: number; opponent: string | null; result: "win" | "loss" | "draw" | "double_loss" | "bye_win" | "bye_loss" | null }[];
}

// ---- Engine entry points (implemented in ./index.ts) ----
export interface ScorekeeperEngine {
  createEvent(settings: Partial<EventSettings> & { name: string }, ctx: CommandContext): EventState;
  applyCommand(state: EventState, command: Command, ctx: CommandContext): EventState; // throws CommandError; never mutates input
  previewCommand(state: EventState, command: Command, ctx: CommandContext): MatchPlayerChange[];
  standings(state: EventState, options?: import("./standings.js").StandingsOptions): Standing[];
  suggestRounds(playerCount: number): number;
  publicView(state: EventState, version: number): PublicView;
  integrity(state: EventState): IntegrityReport;
  playerView(state: EventState, playerId: PlayerId, version: number): PlayerView;
}

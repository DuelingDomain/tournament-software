import { z } from "zod";
import type { Command, EventSettings } from "@dd-tournament/engine";

export const userId = z.number().int().positive().safe();
const id = z.string().min(1).max(128);
const name = z.string().trim().min(1).max(200);
const memberId = z.string().max(64).nullable();
const penalty = z.enum(["caution", "warning", "game_loss", "match_loss", "disqualification"]);
export const role = z.enum(["organizer", "head_judge", "judge", "scorekeeper", "staff"]);
export const position = z.enum(["organizer", "head_judge", "assistant_head_judge", "floor_judge_team_lead", "floor_judge", "scorekeeper", "event_manager", "event_staff"]);
export const staffSchema = z.strictObject({ userId, name, role: role.optional(), position: position.optional() });
export const locationFields = z.strictObject({ name, address1: z.string().max(500).default(""), address2: z.string().max(500).default(""),
  city: z.string().max(200).default(""), state: z.string().max(200).default(""), postal: z.string().max(100).default(""),
  country: z.string().max(200).default(""), phone: z.string().max(100).default(""), website: z.string().max(500).default("") });
export const result = z.enum(["p1", "p2", "draw", "double_loss", "bye_win", "bye_loss"]);
const expectedVersion = z.number().int().positive().safe();
export const dummyDataSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("players"), count: z.number().int().min(1).max(256), expectedVersion }),
  z.strictObject({ action: z.literal("results"), expectedVersion }),
]);
export type DummyData = z.infer<typeof dummyDataSchema>;
export const settingsSchema = z.strictObject({
  name, format: z.enum(["swiss", "single_elim", "open_dueling"]),
  style: z.enum(["advanced", "traditional", "sealed", "open_dueling"]), playerStructure: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  locationId: id.nullable(), locationDetails: locationFields.extend({ id }).nullable(), plannedRounds: z.number().int().min(1).max(100).nullable(),
  topCut: z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(8), z.literal(16), z.literal(32), z.literal(64)]),
  tiebreak: z.enum(["floor33", "legacy"]), startingTable: z.number().int().min(1).max(100000),
  roundMinutes: z.number().positive().max(1440), location: z.string().max(500).nullable(), startsAt: z.iso.datetime({ offset: true }).nullable(),
  infractions: z.array(z.strictObject({ id, label: name, defaultPenalty: penalty })).max(100),
  publicNames: z.enum(["full", "initials"]), registrationOpen: z.boolean(), requireMemberId: z.boolean(), allowLateEntry: z.boolean(),
}) satisfies z.ZodType<EventSettings>;
export const partialSettings = settingsSchema.partial();
const playerId = { playerId: id };
const matchId = { matchId: id };
const undropOption = z.enum(["bye_loss", "bye_win", "next_round", "swap_with_dropped", "take_bye", "repair", "swap_previous_opponent"]);
const teamEntry = z.strictObject({ teamId: id.optional(), name, memberIds: z.array(id).min(2).max(5) });
export const commandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("UpdateSettings"), settings: partialSettings, staff: z.array(staffSchema).max(100).optional() }),
  z.strictObject({ type: z.literal("AddPlayers"), players: z.array(z.strictObject({ userId, name, memberId: memberId.optional() })).min(1).max(500) }),
  z.strictObject({ type: z.literal("UpdatePlayer"), ...playerId, name: name.optional(), memberId: memberId.optional(), fixedTable: z.number().int().positive().nullable().optional(), notes: z.string().max(2000).nullable().optional() }),
  z.strictObject({ type: z.literal("LinkPlayerAccount"), ...playerId, userId }),
  z.strictObject({ type: z.literal("ReEnroll"), ...playerId }),
  z.strictObject({ type: z.literal("RemovePlayer"), ...playerId }),
  z.strictObject({ type: z.literal("SetCheckedIn"), ...playerId, checkedIn: z.boolean() }),
  z.strictObject({ type: z.literal("AddStaff"), ...staffSchema.shape }),
  z.strictObject({ type: z.literal("SetStaffPosition"), staffId: id, position }),
  z.strictObject({ type: z.literal("SetStaffRole"), staffId: id, role }),
  z.strictObject({ type: z.literal("RemoveStaff"), staffId: id }),
  z.strictObject({ type: z.literal("AddTeams"), teams: z.array(teamEntry).min(1).max(500) }),
  z.strictObject({ type: z.literal("UpdateTeam"), teamId: id, name: name.optional(), memberIds: z.array(id).min(2).max(5).optional(), fixedTable: z.number().int().positive().nullable().optional() }),
  z.strictObject({ type: z.literal("RemoveTeam"), teamId: id }),
  z.strictObject({ type: z.literal("DropTeam"), teamId: id }),
  z.strictObject({ type: z.literal("ReEnrollTeam"), teamId: id }),
  z.strictObject({ type: z.literal("UndropTeam"), teamId: id, option: undropOption, swapWith: id.optional() }),
  z.strictObject({ type: z.literal("PairNextRound") }),
  z.strictObject({ type: z.literal("RepairRound"), round: z.number().int().positive().optional() }),
  z.strictObject({ type: z.literal("CancelRound") }),
  z.strictObject({ type: z.literal("SwapPlayers"), a: id, b: id }),
  z.strictObject({ type: z.literal("SetPairing"), ...matchId, p1: id, p2: id.nullable() }),
  z.strictObject({ type: z.literal("SplitMatch"), ...matchId }),
  z.strictObject({ type: z.literal("CreateMatch"), p1: id, p2: id.nullable(), table: z.number().int().positive().nullable().optional() }),
  z.strictObject({ type: z.literal("AddByeMatch"), ...playerId, result: z.enum(["bye_win", "bye_loss"]) }),
  z.strictObject({ type: z.literal("StartTimer"), minutes: z.number().positive().max(1440).optional() }),
  z.strictObject({ type: z.literal("AdjustTimer"), deltaMinutes: z.number().min(-1440).max(1440) }),
  z.strictObject({ type: z.literal("ExtendMatch"), ...matchId, minutes: z.number().min(0).max(1440) }),
  z.strictObject({ type: z.literal("AdjustPoints"), ...playerId, delta: z.number().int().safe() }),
  z.strictObject({ type: z.literal("EnterResult"), ...matchId, result: result.nullable(), drop: z.enum(["loser", "both", "none"]).optional() }),
  z.strictObject({ type: z.literal("ReportResult"), ...playerId, ...matchId, result }),
  z.strictObject({ type: z.literal("DropPlayer"), ...playerId }),
  z.strictObject({ type: z.literal("UndropPlayer"), ...playerId, option: undropOption, swapWith: id.optional() }),
  z.strictObject({ type: z.literal("CutToPlayoff"), size: z.number().int().min(2).max(64).optional(), tieOrder: z.array(id).max(10000).optional() }),
  z.strictObject({ type: z.literal("SwissCut"), mode: z.enum(["min_points", "top"]), value: z.number().int().nonnegative(), tieOrder: z.array(id).max(10000).optional(), pairNext: z.literal(true).optional() }),
  z.strictObject({ type: z.literal("UndoSwissCut") }),
  z.strictObject({ type: z.literal("CompleteEvent") }),
  z.strictObject({ type: z.literal("ReopenEvent") }),
  z.strictObject({ type: z.literal("AddPenalty"), ...playerId, infractionId: id, penalty: penalty.optional(), round: z.number().int().positive().nullable().optional(), judge: z.string().max(200).nullable().optional(), notes: z.string().max(2000).nullable().optional() }),
  z.strictObject({ type: z.literal("RemovePenalty"), penaltyId: id }),
]) satisfies z.ZodType<Command>;
export const tournamentUserSchema = z.strictObject({ id: userId, username: name, displayName: name,
  discordUserId: z.string().max(100).nullable(), discordUsername: z.string().max(200).nullable(), memberId });
export type TournamentUser = z.infer<typeof tournamentUserSchema>;

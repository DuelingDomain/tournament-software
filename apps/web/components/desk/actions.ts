import { isTemporaryMemberId, type DeskView, type StaffRole } from "@dd-tournament/engine";
import { allResultsIn, competitorLabel, competitors, hasEnteredResult, isTeamEvent } from "./helpers";
import type { PairInfo } from "./pairings-panel";
import { can } from "./roles";

export type Panel = "players" | "pairings" | "standings";
export type DialogKind = "timer" | "cut" | "undrop" | "change" | "manual" | "print" | "keys" | "integrity" | "history" | "notes" | "dummy-players" | "settings" | "judging" | "drop" | "reenroll" | "seats" | "log";
export type ConfirmKind = "repair" | "cancel" | "finish" | "reopen";
export type MenuName = "File" | "Tournament" | "Players" | "Pairings" | "Standings" | "Help";
export const MENUS: MenuName[] = ["File", "Tournament", "Players", "Pairings", "Standings", "Help"];
export type PrintKind = "pairings" | "pairings-by-player" | "pairings-by-team" | "slips" | "standings" | "players" | "brackets" | "unreported" | "paired-down" | "penalties";
export type ExportKind = "tournament" | "players-xml" | "players.csv" | "standings.csv" | "matches.csv";

export interface Action {
  id: string; label: string; menu: MenuName; keys?: string; enabled: boolean; reason?: string; run: () => void; separatorBefore?: boolean;
  /** Menu group heading: items sharing a group sit under one non-interactive heading. */
  group?: string;
}
export interface Handlers {
  go: (panel: Panel) => void; open: (dialog: DialogKind) => void; confirm: (kind: ConfirmKind) => void;
  print: (kind: PrintKind) => void; download: (kind: ExportKind) => void; importFile: (kind: "tournament" | "players" | "team-players") => void;
  pair: () => void; palette: () => void; home: () => void; dummyResults: () => void;
}

/** Everything the F9 button needs: label, whether it can run now, and a one-line why when it cannot. */
export function pairInfo(desk: DeskView, role: StaffRole, run: () => void): PairInfo {
  const { state } = desk;
  const rounds = state.rounds;
  const playoff = state.phase === "playoff";
  const label = playoff ? "Pair Next Playoff Round" : `Pair Round ${rounds.length + 1}`;
  const active = competitors(state).filter(p => p.status === "active").length;
  const unreported = rounds.flatMap(r => r.matches).filter(m => m.result === null).length;
  let note = "";
  if (state.phase === "complete") note = "The tournament is finished.";
  else if (!can(role, "PairNextRound")) note = "Your role cannot pair rounds.";
  else if (unreported > 0) note = `${unreported} unreported ${unreported === 1 ? "match" : "matches"}. Enter every result first.`;
  else if (playoff && rounds.at(-1)?.matches.length === 1) note = "The final is reported. Finalize the tournament from the Tournament menu.";
  else if (active < 2) note = isTeamEvent(state) ? "Enroll at least two active teams." : "Enroll at least two active players.";
  return { label, enabled: note === "", note: note || (rounds.length === 0 ? "Pairs everyone enrolled and starts the timer when you set it." : "Pairs by points, avoiding repeat opponents."), run };
}

export function buildActions(desk: DeskView, role: StaffRole, h: Handlers): Action[] {
  const { state } = desk;
  const rounds = state.rounds;
  const finished = state.phase === "complete";
  const hasRounds = rounds.length > 0;
  const current = rounds.at(-1);
  const pair = pairInfo(desk, role, h.pair);
  const reason = (cmd: Parameters<typeof can>[1], extra?: string | false) =>
    finished ? "The tournament is finished." : !can(role, cmd) ? "Your role cannot do this." : extra || undefined;
  const a = (id: string, label: string, menu: MenuName, run: () => void, opts: Partial<Action> = {}): Action => {
    const why = opts.reason;
    return { id, label, menu, run, enabled: !why, ...opts, reason: why };
  };
  const team = isTeamEvent(state);
  const who = competitorLabel(state);
  const all = competitors(state);
  const hasDropped = all.some(p => p.status === "dropped");
  const hasActive = all.some(p => p.status === "active");
  const cutWhy = reason("CutToPlayoff", state.settings.format !== "swiss" ? "Single elimination has no Swiss cut." : !hasRounds ? "Pair a round first." : state.phase === "playoff" ? "Playoffs have started." : !allResultsIn(state) ? "Enter every result first." : undefined);
  const repairWhy = reason("RepairRound", !hasRounds ? "Pair a round first." : undefined);
  const unreportedAny = rounds.flatMap(r => r.matches).filter(m => m.result === null).length;
  const tempIds = state.players.filter(p => p.memberId !== null && isTemporaryMemberId(p.memberId)).length;
  const finishWhy = reason("CompleteEvent", state.phase === "registration" ? "Pair a round first."
    : unreportedAny > 0 ? "Unable to finalize a tournament with unreported matches."
    : state.settings.requireMemberId && tempIds > 0 ? "Temporary IDs must be replaced before finalizing." : undefined);

  const dummyAllowed = role === "organizer" || role === "head_judge";
  const unreportedNow = (current?.matches ?? []).filter(m => m.result === null).length;
  const playoffRounds = rounds.some(r => r.stage === "playoff");
  const noPlayers = state.players.length === 0 ? "No players yet." : undefined;
  const noCompetitors = all.length === 0 ? (team ? "No teams yet." : "No players yet.") : undefined;
  const teamOnly = team ? undefined : "This tournament is not a team event.";
  const list: Action[] = [
    // File
    a("open", "Open Tournament…", "File", () => h.importFile("tournament"), { keys: "Ctrl+O", reason: reason("UpdateSettings") }),
    a("home", "Close Tournament", "File", h.home),
    a("log", "Show Recent Log Entries…", "File", () => h.open("log")),
    a("save", "Save Tournament", "File", () => h.download("tournament"), { keys: "Ctrl+S", separatorBefore: true }),
    a("import-players", "Import Players (AllPlayers XML)…", "File", () => h.importFile("players"), { reason: reason("AddPlayers", state.phase !== "registration" && "Players import during registration only.") }),
    a("import-team-players", "Import Team Player List…", "File", () => h.importFile("team-players"), { reason: reason("AddPlayers", team ? "Team player lists import into a tournament with individual players." : state.phase !== "registration" && "Players import during registration only.") }),
    a("export-players", "Export Players (XML)", "File", () => h.download("players-xml"), { separatorBefore: true }),
    a("export-players-csv", "Export Players (CSV)", "File", () => h.download("players.csv")),
    a("export-standings-csv", "Export Standings (CSV)", "File", () => h.download("standings.csv")),
    a("export-matches-csv", "Export Matches (CSV)", "File", () => h.download("matches.csv")),

    // Tournament
    a("settings", "Update Settings…", "Tournament", () => h.open("settings")),
    a("print-batch", "Batch Printing…", "Tournament", () => h.open("print"), { keys: "Ctrl+P" }),
    a("cut", "Cut to Playoffs…", "Tournament", () => h.open("cut"), { keys: "F11", reason: cutWhy, separatorBefore: true }),
    a("timer", "Round Timer…", "Tournament", () => h.open("timer"), { reason: reason("StartTimer", !hasRounds && "Pair a round first.") }),
    a("judging", "Judging: Penalties…", "Tournament", () => h.open("judging"), { reason: can(role, "AddPenalty") || can(role, "RemovePenalty") ? undefined : "Your role cannot record penalties." }),
    finished
      ? a("reopen", "Reopen Tournament", "Tournament", () => h.confirm("reopen"), { separatorBefore: true, reason: can(role, "ReopenEvent") ? undefined : "Your role cannot do this." })
      : a("finish", "Finalize Tournament…", "Tournament", () => h.confirm("finish"), { separatorBefore: true, reason: finishWhy }),
    ...(dummyAllowed ? [
      a("dummy-players", "Generate Dummy Data: Add Test Players…", "Tournament", () => h.open("dummy-players"), { group: "Generate Dummy Data", separatorBefore: true,
        reason: state.phase !== "registration" ? "Test players can only be added during registration." : undefined }),
      a("dummy-results", hasRounds ? `Generate Dummy Data: Random Results for Round ${current!.number}` : "Generate Dummy Data: Random Results", "Tournament", h.dummyResults, { group: "Generate Dummy Data",
        reason: finished ? "The tournament is finished." : !hasRounds ? "Pair a round first." : unreportedNow === 0 ? "Every match in this round already has a result." : undefined }),
    ] : []),

    // Players
    a("go-players", "View Players", "Players", () => h.go("players"), { keys: "F1" }),
    a("find", "Find Player", "Players", () => { h.go("players"); window.setTimeout(() => window.dispatchEvent(new Event("dk:focus-find")), 30); }, { keys: "Ctrl+F" }),
    a("notes", "Player Notes and Penalties…", "Players", () => h.open("notes"), { keys: "Ctrl+K", reason: noPlayers }),
    a("history", `${who} Match History…`, "Players", () => h.open("history"), { keys: "Ctrl+M", reason: noCompetitors }),
    a("drop", `Drop ${who}…`, "Players", () => h.open("drop"), { separatorBefore: true, reason: reason(team ? "DropTeam" : "DropPlayer", !hasActive && `No active ${who.toLowerCase()}s to drop.`) }),
    a("reenroll", `Re-Enroll ${who}…`, "Players", () => h.open("reenroll"), { reason: reason(team ? "ReEnrollTeam" : "ReEnroll", !hasDropped && "Nobody has dropped.") }),
    a("undrop", `Undrop ${who} Wizard…`, "Players", () => h.open("undrop"), { reason: reason(team ? "UndropTeam" : "UndropPlayer", !hasDropped && "Nobody has dropped.") }),
    a("seats", "Assigned Seats…", "Players", () => h.open("seats"), { reason: reason(team ? "UpdateTeam" : "UpdatePlayer", noCompetitors) }),
    a("print-players", team ? "Print Team List" : "Print Player List", "Players", () => h.print("players"), { keys: "F4", separatorBefore: true, reason: noPlayers }),
    a("print-penalties", "Print Penalties", "Players", () => h.print("penalties"), { reason: state.penalties.length === 0 ? "No penalties have been recorded." : undefined }),

    // Pairings
    a("go-pairings", "View Pairings", "Pairings", () => h.go("pairings"), { keys: "F2" }),
    a("pair", pair.label, "Pairings", pair.run, { keys: "F9", reason: pair.enabled ? undefined : pair.note, separatorBefore: true }),
    a("repair", "Re-Pair Round", "Pairings", () => h.confirm("repair"), { keys: "F10", reason: repairWhy }),
    a("manual", "Manual Pairings…", "Pairings", () => h.open("manual"), { reason: reason("SwapPlayers", !hasRounds && "Pair a round first.") }),
    a("cancel", "Cancel Round", "Pairings", () => h.confirm("cancel"), { keys: "F12", reason: reason("CancelRound", !hasRounds && "Nothing to cancel.") }),
    a("change", "Change Match Result Wizard…", "Pairings", () => h.open("change"), { reason: reason("EnterResult", !hasRounds && "Pair a round first.") }),
    a("integrity", "Verify Pairings…", "Pairings", () => h.open("integrity")),
    a("print-pairings", team ? "Print Pairings (by team)" : "Print Pairings (by player)", "Pairings", () => h.print("pairings-by-player"), { keys: "F5", separatorBefore: true, reason: hasRounds ? undefined : "Pair a round first." }),
    a("print-pairings-table", "Print Pairings (by table)", "Pairings", () => h.print("pairings"), { reason: hasRounds ? undefined : "Pair a round first." }),
    a("print-pairings-team", "Print Pairings by Team", "Pairings", () => h.print("pairings-by-team"), { reason: teamOnly ?? (hasRounds ? undefined : "Pair a round first.") }),
    a("print-unreported", "Print Unreported Matches", "Pairings", () => h.print("unreported"), { reason: hasRounds ? (unreportedAny === 0 ? "Every match has a result." : undefined) : "Pair a round first." }),
    a("print-paired-down", "Print Paired-down Players", "Pairings", () => h.print("paired-down"), { reason: hasRounds ? undefined : "Pair a round first." }),
    a("print-brackets", "Print Brackets", "Pairings", () => h.print("brackets"), { keys: "F6", reason: playoffRounds ? undefined : "No playoff has been paired yet." }),
    a("print-slips", "Print Result Slips", "Pairings", () => h.print("slips"), { keys: "F7", reason: hasRounds ? undefined : "Pair a round first." }),

    // Standings
    a("go-standings", "View Standings", "Standings", () => h.go("standings"), { keys: "F3" }),
    a("print-standings", "Print Standings", "Standings", () => h.print("standings"), { keys: "F8" }),

    a("keys", "Keyboard Reference", "Help", () => h.open("keys")),
    a("palette", "Command Palette", "Help", h.palette, { keys: "Ctrl+." }),
  ];
  return list;
}

/** Keys the desk intercepts, mapped to an action id. Checked in order. */
export function actionForKey(e: KeyboardEvent): string | null {
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl && !e.altKey && !e.shiftKey) {
    switch (e.key) {
      case "F1": return "go-players"; case "F2": return "go-pairings"; case "F3": return "go-standings";
      case "F4": return "print-players"; case "F5": return "print-pairings"; case "F6": return "print-brackets";
      case "F7": return "print-slips"; case "F8": return "print-standings";
      case "F9": return "pair"; case "F10": return "repair"; case "F11": return "cut"; case "F12": return "cancel";
    }
  }
  if (ctrl && !e.altKey && !e.shiftKey) {
    switch (e.key.toLowerCase()) {
      case "f": return "find"; case "k": return "notes"; case "m": return "history";
      case "p": return "print-batch"; case "s": return "save"; case "o": return "open"; case ".": return "palette";
    }
  }
  return null;
}

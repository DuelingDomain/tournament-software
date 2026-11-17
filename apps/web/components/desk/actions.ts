import type { DeskView, StaffRole } from "@dd-tournament/engine";
import { allResultsIn, hasEnteredResult } from "./helpers";
import type { PairInfo } from "./pairings-panel";
import { can } from "./roles";

export type Panel = "players" | "pairings" | "standings" | "judging" | "settings";
export type DialogKind = "timer" | "cut" | "undrop" | "change" | "manual" | "print" | "keys" | "integrity" | "history" | "notes" | "dummy-players";
export type ConfirmKind = "repair" | "cancel" | "finish" | "reopen";
export type MenuName = "File" | "Tournament" | "Players" | "Pairings" | "Standings" | "Help";
export const MENUS: MenuName[] = ["File", "Tournament", "Players", "Pairings", "Standings", "Help"];
export type PrintKind = "pairings" | "pairings-by-player" | "slips" | "standings" | "players" | "brackets";
export type ExportKind = "tournament" | "players-xml" | "players.csv" | "standings.csv" | "matches.csv";

export interface Action {
  id: string; label: string; menu: MenuName; keys?: string; enabled: boolean; reason?: string; run: () => void; separatorBefore?: boolean;
  /** Menu group heading: items sharing a group sit under one non-interactive heading. */
  group?: string;
}
export interface Handlers {
  go: (panel: Panel) => void; open: (dialog: DialogKind) => void; confirm: (kind: ConfirmKind) => void;
  print: (kind: PrintKind) => void; download: (kind: ExportKind) => void; importFile: (kind: "tournament" | "players") => void;
  pair: () => void; palette: () => void; home: () => void; dummyResults: () => void;
}

/** Everything the F9 button needs: label, whether it can run now, and a one-line why when it cannot. */
export function pairInfo(desk: DeskView, role: StaffRole, run: () => void): PairInfo {
  const { state } = desk;
  const rounds = state.rounds;
  const playoff = state.phase === "playoff";
  const label = playoff ? "Pair Next Playoff Round" : `Pair Round ${rounds.length + 1}`;
  const active = state.players.filter(p => p.status === "active").length;
  const unreported = rounds.flatMap(r => r.matches).filter(m => m.result === null).length;
  let note = "";
  if (state.phase === "complete") note = "The event is finished.";
  else if (!can(role, "PairNextRound")) note = "Your role cannot pair rounds.";
  else if (unreported > 0) note = `${unreported} unreported ${unreported === 1 ? "match" : "matches"}. Enter every result first.`;
  else if (playoff && rounds.at(-1)?.matches.length === 1) note = "The final is reported. Finalize the event from the Tournament menu.";
  else if (active < 2) note = "Enroll at least two active players.";
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
    finished ? "The event is finished." : !can(role, cmd) ? "Your role cannot do this." : extra || undefined;
  const a = (id: string, label: string, menu: MenuName, run: () => void, opts: Partial<Action> = {}): Action => {
    const why = opts.reason;
    return { id, label, menu, run, enabled: !why, ...opts, reason: why };
  };
  const hasDropped = state.players.some(p => p.status === "dropped");
  const cutWhy = reason("CutToPlayoff", state.settings.format !== "swiss" ? "Single elimination has no Swiss cut." : !hasRounds ? "Pair a round first." : state.phase === "playoff" ? "Playoffs have started." : !allResultsIn(state) ? "Enter every result first." : undefined);
  const repairWhy = reason("RepairRound", !hasRounds ? "Pair a round first." : hasEnteredResult(current) ? "A result is already entered." : undefined);
  const finishWhy = reason("CompleteEvent", state.phase === "registration" ? "Pair a round first." : undefined);

  const dummyAllowed = role === "organizer" || role === "head_judge";
  const unreportedNow = (current?.matches ?? []).filter(m => m.result === null).length;
  const playoffRounds = rounds.some(r => r.stage === "playoff");
  const list: Action[] = [
    a("open", "Open a .Tournament File…", "File", () => h.importFile("tournament"), { keys: "Ctrl+O", reason: reason("UpdateSettings") }),
    a("save", "Save .Tournament File", "File", () => h.download("tournament"), { keys: "Ctrl+S" }),
    a("import-players", "Import Players (AllPlayers XML)…", "File", () => h.importFile("players"), { separatorBefore: true, reason: reason("AddPlayers", state.phase !== "registration" && "Players import during registration only.") }),
    a("export-players", "Export Players (XML)", "File", () => h.download("players-xml"), { separatorBefore: true }),
    a("export-players-csv", "Export Players (CSV)", "File", () => h.download("players.csv")),
    a("export-standings-csv", "Export Standings (CSV)", "File", () => h.download("standings.csv")),
    a("export-matches-csv", "Export Matches (CSV)", "File", () => h.download("matches.csv")),
    a("print-batch", "Batch Printing…", "File", () => h.open("print"), { keys: "Ctrl+P", separatorBefore: true }),
    a("settings", "Event Settings", "File", () => h.go("settings"), { separatorBefore: true }),
    a("home", "My Events", "File", h.home),

    a("pair", `${pair.label}`, "Tournament", pair.run, { keys: "F9", reason: pair.enabled ? undefined : pair.note }),
    a("repair", "Re-pair Round", "Tournament", () => h.confirm("repair"), { keys: "F10", reason: repairWhy }),
    a("cut", "Cut to Playoffs…", "Tournament", () => h.open("cut"), { keys: "F11", reason: cutWhy }),
    a("cancel", "Cancel Round", "Tournament", () => h.confirm("cancel"), { keys: "F12", reason: reason("CancelRound", !hasRounds && "Nothing to cancel.") }),
    a("timer", "Round Timer…", "Tournament", () => h.open("timer"), { separatorBefore: true, reason: reason("StartTimer", !hasRounds && "Pair a round first.") }),
    a("manual", "Manual Pairings…", "Tournament", () => h.open("manual"), { reason: reason("SwapPlayers", !hasRounds && "Pair a round first.") }),
    a("integrity", "Verify Pairings…", "Tournament", () => h.open("integrity")),
    finished
      ? a("reopen", "Reopen Event", "Tournament", () => h.confirm("reopen"), { separatorBefore: true, reason: can(role, "ReopenEvent") ? undefined : "Your role cannot do this." })
      : a("finish", "Finalize Event…", "Tournament", () => h.confirm("finish"), { separatorBefore: true, reason: finishWhy }),
    ...(dummyAllowed ? [
      a("dummy-players", "Generate Dummy Data: Add Test Players…", "Tournament", () => h.open("dummy-players"), { group: "Generate Dummy Data", separatorBefore: true,
        reason: state.phase !== "registration" ? "Test players can only be added during registration." : undefined }),
      a("dummy-results", hasRounds ? `Generate Dummy Data: Random Results for Round ${current!.number}` : "Generate Dummy Data: Random Results", "Tournament", h.dummyResults, { group: "Generate Dummy Data",
        reason: finished ? "The event is finished." : !hasRounds ? "Pair a round first." : unreportedNow === 0 ? "Every match in this round already has a result." : undefined }),
    ] : []),

    a("go-players", "Players / Enroll", "Players", () => h.go("players"), { keys: "F1" }),
    a("find", "Find Player", "Players", () => { h.go("players"); window.setTimeout(() => window.dispatchEvent(new Event("dk:focus-find")), 30); }, { keys: "Ctrl+F" }),
    a("notes", "Player Notes and Penalties…", "Players", () => h.open("notes"), { keys: "Ctrl+K", reason: state.players.length === 0 ? "No players yet." : undefined }),
    a("history", "Player Match History…", "Players", () => h.open("history"), { keys: "Ctrl+M", reason: state.players.length === 0 ? "No players yet." : undefined }),
    a("undrop", "Undrop Player…", "Players", () => h.open("undrop"), { separatorBefore: true, reason: reason("UndropPlayer", !hasDropped && "Nobody has dropped.") }),
    a("change", "Change Match Result…", "Players", () => h.open("change"), { reason: reason("EnterResult", !hasRounds && "Pair a round first.") }),
    a("print-players", "Print Player List", "Players", () => h.print("players"), { keys: "F4", separatorBefore: true, reason: state.players.length === 0 ? "No players yet." : undefined }),

    a("go-pairings", "Pairings / Results", "Pairings", () => h.go("pairings"), { keys: "F2" }),
    a("print-pairings", "Print Pairings (by player)", "Pairings", () => h.print("pairings-by-player"), { keys: "F5", separatorBefore: true, reason: hasRounds ? undefined : "Pair a round first." }),
    a("print-brackets", "Print Brackets", "Pairings", () => h.print("brackets"), { keys: "F6", reason: playoffRounds ? undefined : "No playoff has been paired yet." }),
    a("print-slips", "Print Result Slips", "Pairings", () => h.print("slips"), { keys: "F7", reason: hasRounds ? undefined : "Pair a round first." }),
    a("print-pairings-table", "Print Pairings (by table)", "Pairings", () => h.print("pairings"), { reason: hasRounds ? undefined : "Pair a round first." }),

    a("go-standings", "Standings", "Standings", () => h.go("standings"), { keys: "F3" }),
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

import { competitors } from "./competitors.js";
import type { EventState, IntegrityReport } from "./types.js";
import { isReservedMemberId, memberIdCheckDigitOk, normalizeMemberId } from "./member-id.js";

export function integrity(state: EventState): IntegrityReport {
  const report: IntegrityReport = { repeatMatches: [], pairedTwiceInRound: [], unpairedActive: [], memberIdWarnings: [] };
  const meetings = new Map<string, IntegrityReport["repeatMatches"][number]>();
  for (const round of state.rounds) {
    const counts = new Map<string, number>();
    for (const match of round.matches) {
      for (const id of match.p2 === null ? [match.p1] : [match.p1, match.p2]) counts.set(id, (counts.get(id) ?? 0) + 1);
      if (round.stage !== "swiss" || match.p2 === null) continue;
      const [a, b] = [match.p1, match.p2].sort();
      const key = JSON.stringify([a, b]);
      const meeting = meetings.get(key) ?? { a, b, rounds: [] };
      if (!meeting.rounds.includes(round.number)) meeting.rounds.push(round.number);
      meetings.set(key, meeting);
    }
    for (const [playerId, count] of counts) if (count > 1) report.pairedTwiceInRound.push({ round: round.number, playerId });
  }
  report.repeatMatches = [...meetings.values()].filter(m => m.rounds.length > 1);
  const current = state.rounds.at(-1);
  if (current) {
    const paired = new Set(current.matches.flatMap(m => m.p2 === null ? [m.p1] : [m.p1, m.p2]));
    report.unpairedActive = competitors(state).filter(p => p.status === "active" && !paired.has(p.id)).map(p => p.id);
  }
  const members = new Map<string, string[]>();
  for (const p of state.players) {
    if (p.memberId === null) continue;
    const id = normalizeMemberId(p.memberId) ?? p.memberId;
    members.set(id, [...(members.get(id) ?? []), p.id]);
    if (!isReservedMemberId(id) && !memberIdCheckDigitOk(id)) report.memberIdWarnings.push({ playerId: p.id, memberId: id, problem: "check_digit" });
  }
  for (const [memberId, ids] of members) if (ids.length > 1) {
    for (const playerId of ids) report.memberIdWarnings.push({ playerId, memberId, problem: "duplicate" });
  }
  return report;
}

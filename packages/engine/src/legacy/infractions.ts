export const infractionNames = ["None", "ProceduralErrorMinor", "ProceduralErrorMajor", "ProceduralErrorStrict", "TardinessMajor", "TardinessStrict", "DeckErrorMinor", "DeckErrorMajor", "DrawingCardsMinor", "DrawingCardsMajor", "MarkedCardsMinor", "MarkedCardsMajor", "SlowPlayMinor", "UnsportingConductMinor", "UnsportingConductMajor", "UnsportingConductSevere", "Cheating"];
export const defaultInfractionNames: Readonly<Record<string, string>> = {
  slow_play: "SlowPlayMinor", conduct_minor: "UnsportingConductMinor", deck_problem: "DeckErrorMajor", extra_look: "ProceduralErrorMinor",
  extra_draw: "DrawingCardsMajor", rule_violation: "ProceduralErrorMinor", maintain_state: "ProceduralErrorMinor", communication: "ProceduralErrorMinor",
  tardiness: "TardinessMajor", outside_help: "UnsportingConductMajor", marked_cards: "MarkedCardsMajor", cheating: "Cheating",
};

/** The one built-in infraction a file's infraction name stands for; names shared by several built-ins stay as the file wrote them. */
export function builtInInfractionId(legacyName: string): string | null {
  const ids = Object.entries(defaultInfractionNames).filter(([, name]) => name === legacyName).map(([id]) => id);
  return ids.length === 1 ? ids[0]! : null;
}

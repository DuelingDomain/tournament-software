export const FIRST_TEAM_ID = 9_988_000_000;
export const FIRST_TEMPORARY_MEMBER_ID = 9_999_000_000;
export const MEMBER_ID_LIMIT = 10_000_000_000;

/** Canonical storage form; display and file padding is deliberately separate. */
export function normalizeMemberId(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  if (!/^\d{1,10}$/.test(digits)) return null;
  return digits.replace(/^0+(?=\d)/, "");
}

export function padMemberId(id: string): string {
  const normalized = normalizeMemberId(id);
  if (normalized === null) throw new RangeError("A member ID needs one to ten digits.");
  return normalized.padStart(10, "0");
}

export function isTemporaryMemberId(id: string): boolean {
  const value = Number(normalizeMemberId(id));
  return value >= FIRST_TEMPORARY_MEMBER_ID && value < MEMBER_ID_LIMIT;
}

export function isTeamId(id: string): boolean {
  const value = Number(normalizeMemberId(id));
  return value >= FIRST_TEAM_ID && value < FIRST_TEMPORARY_MEMBER_ID;
}

export function isReservedMemberId(id: string): boolean {
  return isTeamId(id) || isTemporaryMemberId(id);
}

/** The weighted check digit applies to ordinary member numbers. */
export function memberIdCheckDigitOk(id: string): boolean {
  const normalized = normalizeMemberId(id);
  if (normalized === null) return false;
  const padded = normalized.padStart(10, "0");
  const weights = [9, 8, 7, 6, 5, 4, 3, 2, 9];
  const sum = weights.reduce((total, weight, i) => total + Number(padded[i]) * weight, 0);
  return Number(padded[9]) === (11 - sum % 11) % 10;
}

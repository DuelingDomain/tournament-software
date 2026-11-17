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
  const normalized = normalizeMemberId(id);
  if (normalized === null) return false;
  const value = Number(normalized);
  return value >= 9988000000 && value <= 9999999999;
}

/** Advisory only: temporary IDs are not subject to the real-number checksum. */
export function memberIdCheckDigitOk(id: string): boolean {
  if (normalizeMemberId(id) === null) return false;
  const padded = padMemberId(id);
  const weights = [9, 8, 7, 6, 5, 4, 3, 2, 9];
  const sum = weights.reduce((total, weight, i) => total + Number(padded[i]) * weight, 0);
  return Number(padded[9]) === (11 - sum % 11) % 10;
}

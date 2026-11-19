export function isIanaTimeZone(value: string): boolean {
  // Intl accepts numeric offsets too, so require a named zone.
  if (value.length > 100 || !/^[a-z]/i.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

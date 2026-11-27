import { HttpError } from "./http";

export function createRateLimit(limit: number, windowMs: number) {
  const usage = new Map<number, { at: number; count: number }[]>();
  return (viewerId: number, count = 1) => {
    if (count === 0) return;
    const now = Date.now();
    const recent = (usage.get(viewerId) ?? []).filter(entry => now - entry.at < windowMs);
    if (recent.reduce((sum, entry) => sum + entry.count, 0) + count > limit) throw new HttpError(429, "rate_limited");
    usage.set(viewerId, [...recent, { at: now, count }]);
    if (usage.size > 1000) {
      for (const [id, entries] of usage) {
        if (entries.every(entry => now - entry.at >= windowMs)) usage.delete(id);
      }
    }
  };
}

import { HttpError } from "./http";

export function createRateLimit(windows: readonly { limit: number; windowMs: number }[],
  { code = "rate_limited", message }: { code?: string; message?: string } = {}) {
  const usage = new Map<number, { at: number; count: number }[]>();
  const longestWindow = Math.max(...windows.map(window => window.windowMs));
  return (viewerId: number, count = 1) => {
    if (count === 0) return;
    const now = Date.now();
    const recent = (usage.get(viewerId) ?? []).filter(entry => now - entry.at < longestWindow);
    for (const { limit, windowMs } of windows) {
      const used = recent.reduce((sum, entry) => now - entry.at < windowMs ? sum + entry.count : sum, 0);
      if (used + count > limit) throw new HttpError(429, code, message === undefined ? {} : { message });
    }
    usage.set(viewerId, [...recent, { at: now, count }]);
    if (usage.size > 1000) {
      for (const [id, entries] of usage) {
        if (entries.every(entry => now - entry.at >= longestWindow)) usage.delete(id);
      }
    }
  };
}

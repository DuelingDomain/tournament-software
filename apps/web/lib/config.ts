import { HttpError } from "./http";

export function mockEnabled() { return process.env.DD_APP_URL === "mock" && process.env.NODE_ENV !== "production"; }
export function secret(name: "DD_BRIDGE_SECRET" | "SESSION_SECRET"): string {
  const value = process.env[name] ?? "";
  if (value.length < 32) throw new HttpError(503, "configuration_required");
  return value;
}
export function appUrl() {
  try {
    const url = new URL(process.env.DD_APP_URL ?? "");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash
      || (process.env.NODE_ENV === "production" && url.protocol !== "https:")) throw new Error();
    return url;
  } catch { throw new HttpError(503, "bridge_unavailable"); }
}

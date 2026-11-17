import type { NextConfig } from "next";
import { resolve } from "node:path";
const config: NextConfig = {
  agentRules: false,
  output: "standalone",
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "Cache-Control", value: "no-store" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
    ] }];
  },
};
export default config;

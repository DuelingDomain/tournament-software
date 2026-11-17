import type { ReactNode } from "react";
export const metadata = { title: "DD Tournaments", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><header><a href="/">DD Tournaments</a></header><main>{children}</main></body></html>;
}

import type { ReactNode } from "react";
import { Chakra_Petch, JetBrains_Mono, Russo_One } from "next/font/google";
import "./globals.css";

const display = Russo_One({ weight: "400", subsets: ["latin"], variable: "--font-display", display: "swap" });
const body = Chakra_Petch({ weight: ["400", "500", "600", "700"], subsets: ["latin"], variable: "--font-body", display: "swap" });
const mono = JetBrains_Mono({ weight: ["400", "500"], subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata = { title: "DD Tournaments", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}><body>{children}</body></html>;
}

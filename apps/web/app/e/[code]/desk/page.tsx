import type { Metadata } from "next";
import { DeskShell } from "@/components/desk/desk-shell";

export const metadata: Metadata = { title: "Desk" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  return <DeskShell initialCode={(await params).code} />;
}

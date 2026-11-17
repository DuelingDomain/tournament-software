import { notFound } from "next/navigation";
import { PrintView, type PrintKind } from "@/components/print/PrintView";

const KINDS: PrintKind[] = ["pairings", "slips", "standings", "players", "brackets"];
export default async function Page({ params, searchParams }: { params: Promise<{ code: string; kind: string }>; searchParams: Promise<{ by?: string }> }) {
  const { code, kind } = await params;
  const { by } = await searchParams;
  if (!KINDS.includes(kind as PrintKind)) notFound();
  return <PrintView code={code} kind={kind as PrintKind} sortByPlayer={by === "player"} />;
}

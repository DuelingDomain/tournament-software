import { notFound } from "next/navigation";
import { PrintView, type PrintKind } from "@/components/print/PrintView";

const KINDS: PrintKind[] = ["pairings", "slips", "standings", "players", "brackets", "pairings-by-team", "unreported", "paired-down", "penalties"];
export default async function Page({ params, searchParams }: { params: Promise<{ code: string; kind: string }>; searchParams: Promise<{ by?: string; tables?: string }> }) {
  const { code, kind } = await params;
  const { by, tables } = await searchParams;
  const onlyTables = tables ? tables.split(",").map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 500) : null;
  if (!KINDS.includes(kind as PrintKind)) notFound();
  return <PrintView code={code} kind={kind as PrintKind} sortByPlayer={by === "player"} onlyTables={onlyTables?.length ? onlyTables : null} />;
}

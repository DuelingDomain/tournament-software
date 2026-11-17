import { notFound } from "next/navigation";
import { EventPanel } from "../../../../../components/event-panel";
export default async function Page({ params }: { params: Promise<{ code: string; kind: string }> }) {
  const { code, kind } = await params;
  if (!["pairings", "slips", "standings"].includes(kind)) notFound();
  return <EventPanel code={code} mode="print" printKind={kind} />;
}

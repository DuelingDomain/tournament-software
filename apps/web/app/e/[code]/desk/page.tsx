import { EventPanel } from "../../../../components/event-panel";
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  return <EventPanel code={(await params).code} mode="desk" />;
}

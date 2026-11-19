import { PublicEvent } from "@/components/event/PublicEvent";
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  return <PublicEvent code={(await params).code} />;
}

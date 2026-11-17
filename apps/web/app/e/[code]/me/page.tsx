import { PlayerEvent } from "@/components/player/PlayerEvent";
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  return <PlayerEvent code={(await params).code} />;
}

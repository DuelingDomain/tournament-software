import type { Metadata } from "next";
import { Desk } from "@/components/desk/desk";

export const metadata: Metadata = { title: "Desk" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  return <Desk code={(await params).code} />;
}

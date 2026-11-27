import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ButtonLink, Wordmark } from "../../../components/ui";
import { currentUser } from "../../../lib/auth";
import { inviteTokenPattern } from "../../../lib/organizer-invites";
import { JoinInvite } from "./join-invite";

export const metadata: Metadata = { title: "Join player list" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!inviteTokenPattern.test(token)) notFound();
  if (!currentUser({ headers: await headers() })) redirect(`/auth/start?${new URLSearchParams({ return: `/join/${token}` })}`);

  return <main className="land-center">
    <div className="dd-sheet state-card">
      <Wordmark full />
      <h1 className="dd-display state-title">Join player list</h1>
      <JoinInvite token={token} />
      <ButtonLink variant="violet" href="/">My events</ButtonLink>
    </div>
  </main>;
}

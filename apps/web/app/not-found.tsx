import { ButtonLink, Wordmark } from "@/components/ui";

export const metadata = { title: "Page not found · DD Tournaments" };

export default function NotFound() {
  return <main className="land-center">
    <div className="dd-sheet state-card">
      <Wordmark full />
      <h1 className="dd-display state-title">Page not found</h1>
      <p className="state-text">This link does not lead to a page. Check the address, or go back to your events.</p>
      <ButtonLink variant="violet" href="/">My events</ButtonLink>
    </div>
  </main>;
}

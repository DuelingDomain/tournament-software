"use client";
import { Button, ButtonLink, Wordmark } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="land-center">
    <div className="dd-sheet state-card" role="alert">
      <Wordmark full />
      <h1 className="dd-display state-title">Something went wrong</h1>
      <p className="state-text">This page could not load. Try again; if it keeps happening, reload the page.</p>
      <div className="land-actions"><Button variant="violet" onClick={reset}>Try again</Button><ButtonLink href="/">My events</ButtonLink></div>
    </div>
  </main>;
}

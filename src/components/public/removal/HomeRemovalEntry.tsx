import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const STEPS = [
  { n: "1", t: "Paste Link", d: "Submit the content URL." },
  { n: "2", t: "Review & Quote", d: "Eterna assesses the case and provides the service fee." },
  { n: "3", t: "Track Removal", d: "Receive a Case ID and follow progress online." },
];

export function HomeRemovalEntry() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    let u = url.trim();
    if (u && !/^https?:\/\//i.test(u)) u = `https://${u}`;
    try {
      const parsed = new URL(u);
      if (!parsed.hostname.includes(".")) throw new Error();
    } catch {
      setErr("Enter a valid link, for example https://example.com/post");
      return;
    }
    void navigate({ to: "/remove-content", search: { url: u } });
  }

  return (
    <section aria-labelledby="home-removal-heading" className="border-b border-landing-line bg-landing py-20 md:py-24">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 id="home-removal-heading" className="text-3xl font-semibold tracking-tight text-landing-ink md:text-5xl">
          Need Something Removed Online?
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-landing-muted md:text-lg">
          Submit a harmful webpage, post, video, image, review, or other public link for individual
          assessment. No long-term protection plan is required.
        </p>

        <form onSubmit={submit} className="mx-auto mt-10 max-w-3xl">
          <label htmlFor="home-removal-url" className="sr-only">Paste the link you want removed</label>
          <div className="flex flex-col gap-3 rounded-2xl border border-landing-line bg-card p-2 shadow-lg shadow-primary/5 transition focus-within:border-primary/60 focus-within:ring-4 focus-within:ring-primary/10 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-center gap-3 px-4">
              <Link2 className="size-5 shrink-0 text-primary" aria-hidden="true" />
              <input
                id="home-removal-url"
                type="text"
                inputMode="url"
                autoComplete="url"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setErr(""); }}
                placeholder="https://example.com/post"
                aria-describedby="home-removal-help"
                className="h-14 w-full bg-transparent text-base text-landing-ink outline-none placeholder:text-landing-muted md:text-lg"
              />
            </div>
            <Button type="submit" size="lg" className="landing-accent-fill h-14 rounded-xl px-8 text-base text-landing-accent-foreground">
              Analyze Link <ArrowRight />
            </Button>
          </div>
          <p id="home-removal-help" className="mt-3 text-left text-sm text-landing-muted sm:pl-4">
            Paste the link you want removed
          </p>
          {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
        </form>

        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          AI-Assisted Review • Pay Per Link • Case Tracking
        </p>

        <ol className="mt-12 grid gap-4 text-left sm:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-xl border border-landing-line bg-landing-soft p-5">
              <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{s.n}</span>
              <h3 className="mt-3 font-semibold text-landing-ink">{s.t}</h3>
              <p className="mt-1 text-sm leading-6 text-landing-muted">{s.d}</p>
            </li>
          ))}
        </ol>

        <Button asChild variant="outline" size="lg" className="mt-10 border-landing-line text-landing-ink">
          <Link to="/track-case">Track Existing Case</Link>
        </Button>
      </div>
    </section>
  );
}

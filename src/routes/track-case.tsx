import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { PublicPage } from "@/components/public/PublicSite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trackRemovalCase } from "@/lib/removal-orders.functions";

const TITLE = "Track Your Removal Case | Eterna Sentinel";
const DESC = "Check the status of your Eterna pay-per-link removal request with your case ID and email.";

export const Route = createFileRoute("/track-case")({
  validateSearch: z.object({ case: z.string().optional() }),
  head: () => ({
    meta: [
      { title: TITLE }, { name: "description", content: DESC },
      { property: "og:title", content: TITLE }, { property: "og:description", content: DESC },
      { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const STEPS = [
  ["awaiting_payment", "Awaiting payment"], ["active", "Case active"], ["submitted", "Submitted to platform"],
  ["under_review", "Platform review"], ["resolved", "Outcome recorded"],
] as const;

function Page() {
  const search = Route.useSearch();
  const track = useServerFn(trackRemovalCase);
  const [caseId, setCaseId] = useState(search.case ?? "");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [row, setRow] = useState<Awaited<ReturnType<typeof trackRemovalCase>> | undefined>(undefined);

  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { setRow(await track({ data: { caseId, email } })); } catch { setRow(null); } finally { setBusy(false); }
  }
  const idx = row ? Math.max(0, STEPS.findIndex(([k]) => k === row.case_status)) : 0;

  return (
    <PublicPage eyebrow="Case tracking" title="Track your removal case" intro="Enter the case ID and the email you used when submitting.">
      <form onSubmit={go} className="mx-auto flex max-w-xl flex-col gap-2 sm:flex-row">
        <Input placeholder="ETR-RM-284193" value={caseId} onChange={(e) => setCaseId(e.target.value)} />
        <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" disabled={busy}>Track</Button>
      </form>
      {row === null && <p className="mt-6 text-center text-sm text-muted-foreground">No case found for that ID and email.</p>}
      {row && (
        <div className="mx-auto mt-8 max-w-xl space-y-4 rounded-2xl border bg-card p-6">
          <div className="flex justify-between"><span className="font-semibold">{row.case_id}</span>
            <span className="text-sm text-muted-foreground">{new Date(row.created_at).toLocaleDateString()}</span></div>
          <p className="break-all text-sm">{row.url}</p>
          <p className="text-sm text-muted-foreground">{row.platform} · {row.issue} · {row.recommended_route}</p>
          <ol className="space-y-2">
            {STEPS.map(([k, label], n) => (
              <li key={k} className={`flex items-center gap-2 text-sm ${n <= idx ? "" : "opacity-40"}`}>
                <span className={`size-2.5 rounded-full ${n < idx ? "bg-primary" : n === idx ? "bg-primary animate-pulse" : "bg-muted"}`} />{label}
              </li>
            ))}
          </ol>
          <p className="text-sm">Payment: {row.payment_status.replace(/_/g, " ")} · {row.currency} {row.fee_amount.toLocaleString()}</p>
          {row.status_note && <p className="text-sm text-muted-foreground">{row.status_note}</p>}
        </div>
      )}
    </PublicPage>
  );
}

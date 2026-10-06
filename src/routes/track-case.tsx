import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AlertCircle, CheckCircle2, FileUp } from "lucide-react";
import { PublicPage } from "@/components/public/PublicSite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { submitRequestedInfo, trackRemovalCase } from "@/lib/removal-orders.functions";
import { REMOVED_CUSTOMER_TEXT, caseLabel, paymentLabel } from "@/lib/removal-orders/status";

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

type Data = NonNullable<Awaited<ReturnType<typeof trackRemovalCase>>>;
const ACCEPT = ".jpg,.jpeg,.png,.pdf,.doc,.docx";
const EV: Record<string, string> = {
  case_created: "Case Created", invoice_requested: "Invoice requested", info_requested: "More information requested",
  info_submitted: "Information submitted", customer_update: "Update from Eterna",
};
const toB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = rej; r.readAsDataURL(f); });

function evLabel(e: Data["events"][number]) {
  if (e.event_type === "payment_status") return e.new_value === "paid" ? "Payment Confirmed" : paymentLabel(e.new_value ?? "");
  if (e.event_type === "status_change") return e.new_value === "case_received" ? "Case Received · Removal Processing Started" : caseLabel(e.new_value ?? "");
  return EV[e.event_type] ?? e.event_type;
}

function Page() {
  const search = Route.useSearch();
  const track = useServerFn(trackRemovalCase);
  const send = useServerFn(submitRequestedInfo);
  const [caseId, setCaseId] = useState(search.case ?? "");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [row, setRow] = useState<Data | null | undefined>(undefined);
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");

  async function load() {
    setBusy(true);
    try { setRow(await track({ data: { caseId, email } })); } catch { setRow(null); } finally { setBusy(false); }
  }
  async function upload() {
    setBusy(true);
    try {
      const enc = await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, base64: await toB64(f) })));
      await send({ data: { caseId, email, note, files: enc as never } });
      setFiles([]); setNote(""); await load();
    } finally { setBusy(false); }
  }

  const unpaid = row && row.payment_status !== "paid";
  const final = row && ["rejected", "unable"].includes(row.case_status);

  return (
    <PublicPage eyebrow="Case tracking" title="Track your removal case" intro="Enter the case ID and the email you used when submitting.">
      <form onSubmit={(e) => { e.preventDefault(); load(); }} className="mx-auto flex max-w-xl flex-col gap-2 sm:flex-row">
        <Input placeholder="ETR-RM-284193" value={caseId} onChange={(e) => setCaseId(e.target.value)} />
        <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" disabled={busy}>Track</Button>
      </form>
      {row === null && <p className="mt-6 text-center text-sm text-muted-foreground">No case found for that ID and email.</p>}
      {row && (
        <div className="mx-auto mt-8 max-w-xl space-y-4">
          <div className="space-y-2 rounded-2xl border bg-card p-6">
            <div className="flex justify-between"><span className="font-semibold">{row.case_id}</span>
              <span className="text-sm text-muted-foreground">{new Date(row.created_at).toLocaleDateString()}</span></div>
            <p className="break-all text-sm">{row.url}</p>
            <p className="text-sm text-muted-foreground">{row.platform} · {row.issue}</p>
            <p className="text-2xl font-semibold">{unpaid ? "Awaiting Payment" : row.case_status === "removed" ? "Content Removal Confirmed" : caseLabel(row.case_status)}</p>
            {unpaid && <p className="text-sm">Your case is registered, but removal processing has not started yet.</p>}
            {row.case_status === "removed" && <p className="text-sm">{REMOVED_CUSTOMER_TEXT}{row.removal_verified_at && ` Verified ${new Date(row.removal_verified_at).toLocaleDateString()}.`}</p>}
            {final && row.outcome_explanation && <p className="rounded-lg bg-muted p-3 text-sm">{row.outcome_explanation}</p>}
            <p className="text-sm text-muted-foreground">Payment: {paymentLabel(row.payment_status)} · {row.currency} {row.fee_amount.toLocaleString()}</p>
          </div>

          {row.info_request && (
            <div className="space-y-3 rounded-2xl border border-primary/40 bg-primary/5 p-6">
              <p className="flex items-center gap-2 font-semibold"><AlertCircle className="size-4 text-primary" />Action Required: {row.info_request.title}</p>
              <p className="text-sm">{row.info_request.message}</p>
              <p className="text-sm"><span className="font-medium">Required:</span> {row.info_request.required}</p>
              {row.info_request.deadline && <p className="text-sm">Please respond by {row.info_request.deadline}.</p>}
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed bg-background p-3 text-sm">
                <FileUp className="size-4 text-primary" />{files.length ? files.map((f) => f.name).join(", ") : "Choose files (JPG, PNG, PDF, DOC/DOCX · 5 MB each)"}
                <input type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => setFiles(Array.from(e.target.files ?? []).filter((f) => f.size <= 5 * 1024 * 1024).slice(0, 3))} />
              </label>
              <Textarea placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button disabled={!files.length || busy} onClick={upload}>Submit information</Button>
            </div>
          )}

          {row.customer_message && <div className="rounded-2xl border bg-card p-6 text-sm"><p className="mb-1 font-medium">Update from Eterna</p>{row.customer_message}</div>}

          <div className="rounded-2xl border bg-card p-6">
            <p className="mb-3 font-medium">Case history</p>
            <ol className="space-y-2">
              {row.events.map((e, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{evLabel(e)}<span className="block text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span></span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </PublicPage>
  );
}

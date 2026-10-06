import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AlertCircle, Check, FileUp, Search } from "lucide-react";
import { PublicFooter, PublicHeader } from "@/components/public/PublicSite";
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

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const fmtTime = (d: string) =>
  new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

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

  // Milestones for the tracking bar
  const submitted = !!row?.events.some((e) => e.event_type === "status_change" && (e.new_value ?? "").includes("submitted"));
  const done = row?.case_status === "removed" || !!final;
  const milestones = row
    ? [
        { label: "Case Created", at: row.created_at, reached: true },
        { label: "Payment Confirmed", at: row.events.find((e) => e.event_type === "payment_status" && e.new_value === "paid")?.created_at, reached: row.payment_status === "paid" },
        { label: "Removal Submitted", at: row.events.find((e) => e.event_type === "status_change" && (e.new_value ?? "").includes("submitted"))?.created_at, reached: submitted || done },
        { label: final ? caseLabel(row.case_status) : "Removed", at: row.removal_verified_at ?? undefined, reached: done },
      ]
    : [];
  const reachedCount = milestones.filter((m) => m.reached).length;
  const pct = milestones.length > 1 ? ((reachedCount - 1) / (milestones.length - 1)) * 100 : 0;

  return (
    <div className="min-h-screen bg-muted/30">
      <PublicHeader />
      <main className="px-4 pb-20 pt-28 sm:pt-32">
      <div className="mx-auto max-w-3xl rounded-3xl border bg-card p-6 shadow-sm sm:p-10">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-primary">Case tracking</p>
        <h1 className="mt-2 text-center text-3xl font-semibold tracking-tight sm:text-4xl">Tracking</h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">Enter your case ID and the email you used when submitting.</p>
        <form onSubmit={(e) => { e.preventDefault(); load(); }} className="mt-8 grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Case ID</span>
            <Input className="h-11 rounded-xl" placeholder="ETR-RM-284193" value={caseId} onChange={(e) => setCaseId(e.target.value)} required />
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Email address</span>
            <Input className="h-11 rounded-xl" placeholder="you@example.com" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <button type="submit" disabled={busy} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50 sm:col-span-2">
            <Search className="size-4" />{busy ? "Checking…" : "Track case"}
          </button>
        </form>
        {!row && (
          <div className="mt-10 px-2 opacity-60">
            <div className="relative">
              <div className="absolute left-0 right-0 top-2.5 h-1.5 rounded-full bg-muted" />
              <div className="relative flex justify-between">
                {["Case Created", "Payment Confirmed", "Removal Submitted", "Removed"].map((l) => (
                  <div key={l} className="flex w-20 flex-col items-center gap-1.5 text-center">
                    <span className="size-5 rounded-full border-2 border-muted-foreground/30 bg-card" />
                    <span className="text-[11px] font-medium leading-tight text-muted-foreground">{l}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {row === null && <p className="mt-6 text-center text-sm text-destructive">No case found for that ID and email.</p>}
      </div>
      {row && (
        <div className="mx-auto mt-6 max-w-3xl space-y-6">
          {/* Tracking card */}
          <div className="rounded-3xl border bg-card p-6 shadow-sm sm:p-10">
            <p className="text-center text-xs text-muted-foreground">{row.case_id} · Submitted {fmtDate(row.created_at)}</p>
            <h2 className="mt-1 text-center text-2xl font-semibold tracking-tight">Tracking</h2>
            <p className="mt-2 break-all text-center text-sm text-muted-foreground">{row.url}</p>
            <p className="text-center text-sm text-muted-foreground">{row.platform} · {row.issue}</p>

            {/* Progress bar */}
            <div className="mt-8 px-2">
              <div className="relative">
                <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
                <div
                  className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary transition-all duration-700"
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
                <div className="relative flex justify-between">
                  {milestones.map((m, i) => (
                    <div key={i} className="flex w-20 flex-col items-center gap-1.5 text-center">
                      <span className={`flex size-5 items-center justify-center rounded-full border-2 transition-colors ${m.reached ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30 bg-card"}`}>
                        {m.reached && <Check className="size-3" />}
                      </span>
                      <span className={`text-[11px] font-medium leading-tight ${m.reached ? "text-foreground" : "text-muted-foreground"}`}>{m.label}</span>
                      <span className="text-[10px] text-muted-foreground">{m.at ? `${fmtDate(m.at)} ${fmtTime(m.at)}` : "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Current status */}
            <div className="mt-8 rounded-2xl bg-muted/50 p-4 text-center">
              <p className="text-lg font-semibold">{unpaid ? "Awaiting Payment" : row.case_status === "removed" ? "Content Removal Confirmed" : caseLabel(row.case_status)}</p>
              {unpaid && <p className="mt-1 text-sm text-muted-foreground">Your case is registered, but removal processing has not started yet.</p>}
              {row.case_status === "removed" && <p className="mt-1 text-sm text-muted-foreground">{REMOVED_CUSTOMER_TEXT}{row.removal_verified_at && ` Verified ${fmtDate(row.removal_verified_at)}.`}</p>}
              {final && row.outcome_explanation && <p className="mt-2 rounded-lg bg-card p-3 text-sm">{row.outcome_explanation}</p>}
              <p className="mt-2 text-xs text-muted-foreground">Payment: {paymentLabel(row.payment_status)} · {row.currency} {row.fee_amount.toLocaleString()}</p>
            </div>
          </div>

          {row.info_request && (
            <div className="space-y-3 rounded-3xl border border-primary/40 bg-primary/5 p-6">
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

          {row.customer_message && <div className="rounded-3xl border bg-card p-6 text-sm"><p className="mb-1 font-medium">Update from Eterna</p>{row.customer_message}</div>}

          {/* Updates list */}
          <div className="rounded-3xl border bg-card p-6 sm:p-10">
            <h3 className="text-lg font-semibold">Updates</h3>
            <div className="mt-4 hidden grid-cols-[10rem_1fr] gap-4 border-b pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:grid">
              <span>Date</span><span>Event</span>
            </div>
            <ol className="divide-y">
              {[...row.events].reverse().map((e, i) => (
                <li key={i} className="grid grid-cols-1 gap-1 py-3 text-sm sm:grid-cols-[10rem_1fr] sm:gap-4">
                  <span className="text-muted-foreground">{fmtDate(e.created_at)} · {fmtTime(e.created_at)}</span>
                  <span className="font-medium">{evLabel(e)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
      </main>
      <PublicFooter />
    </div>
  );
}

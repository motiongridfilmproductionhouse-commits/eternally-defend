import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, FileText } from "lucide-react";
import { AdminGuard } from "@/components/AdminGuard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { getRemovalCase, requestRemovalInfo, updateRemovalCase, updateRemovalPayment } from "@/lib/removal-orders/admin.functions";
import { CASE_STATUSES, FINAL_UNSUCCESSFUL, caseLabel, paymentLabel, type CaseStatus } from "@/lib/removal-orders/status";

export const Route = createFileRoute("/_app/admin/removal-cases/$caseId")({
  head: ({ params }) => ({ meta: [{ title: `${params.caseId} — Removal Case` }, { name: "description", content: "Staff case operations." }] }),
  component: () => <AdminGuard><Page /></AdminGuard>,
});

const EVENT_LABEL: Record<string, string> = {
  case_created: "Case created", invoice_requested: "Invoice requested", payment_status: "Payment",
  status_change: "Status", customer_update: "Customer update posted", internal_note: "Internal note updated",
  info_requested: "Information requested", info_submitted: "Customer submitted information", removal_verified: "Removal verified",
};

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border bg-card p-5 ${className}`}><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>{children}</section>;
}
const KV = ({ k, v }: { k: string; v?: React.ReactNode }) => (
  <div className="flex justify-between gap-4 border-b py-1.5 text-sm last:border-0"><span className="text-muted-foreground">{k}</span><span className="max-w-[65%] break-words text-right">{v || "—"}</span></div>
);

function Page() {
  const { caseId } = Route.useParams();
  const qc = useQueryClient();
  const get = useServerFn(getRemovalCase);
  const pay = useServerFn(updateRemovalPayment);
  const upd = useServerFn(updateRemovalCase);
  const ask = useServerFn(requestRemovalInfo);
  const { data: c, isLoading } = useQuery({ queryKey: ["removal-case", caseId], queryFn: () => get({ data: { caseId } }) });
  const [status, setStatus] = useState<CaseStatus>("awaiting_payment");
  const [msg, setMsg] = useState("");
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("");
  const [refs, setRefs] = useState({ invoiceRef: "", paymentRef: "" });
  const [confirmPaid, setConfirmPaid] = useState(false);
  const [removedOpen, setRemovedOpen] = useState(false);
  const [rm, setRm] = useState({ verifiedAt: new Date().toISOString().slice(0, 10), note: "", inaccessible: true });
  const [infoOpen, setInfoOpen] = useState(false);
  const [info, setInfo] = useState({ title: "", message: "", required: "", deadline: "" });

  useEffect(() => {
    if (!c) return;
    setStatus(c.case_status); setMsg(c.customer_message ?? ""); setNotes(c.internal_notes ?? ""); setOutcome(c.outcome_explanation ?? "");
    setRefs({ invoiceRef: c.invoice_ref ?? "", paymentRef: c.payment_ref ?? "" });
  }, [c]);

  const done = () => { qc.invalidateQueries({ queryKey: ["removal-case", caseId] }); qc.invalidateQueries({ queryKey: ["removal-cases"] }); toast.success("Saved"); };
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed");
  const payM = useMutation({ mutationFn: (action: "invoice_sent" | "paid" | "refunded" | "cancelled") => pay({ data: { caseId, action, invoiceRef: refs.invoiceRef || undefined, paymentRef: refs.paymentRef || undefined } }), onSuccess: () => { setConfirmPaid(false); done(); }, onError: fail });
  const updM = useMutation({ mutationFn: (withRemoval?: boolean) => upd({ data: { caseId, status, customerMessage: msg, internalNotes: notes, outcomeExplanation: outcome, removal: withRemoval ? rm : undefined } }), onSuccess: () => { setRemovedOpen(false); done(); }, onError: fail });
  const askM = useMutation({ mutationFn: () => ask({ data: { caseId, ...info, deadline: info.deadline || undefined } }), onSuccess: () => { setInfoOpen(false); done(); }, onError: fail });

  if (isLoading || !c) return <div className="p-8 text-sm text-muted-foreground">Loading case…</div>;
  const paid = c.payment_status === "paid";
  const needsOutcome = FINAL_UNSUCCESSFUL.includes(status);
  function save() {
    if (status === "removed" && c!.case_status !== "removed") { setRemovedOpen(true); return; }
    if (needsOutcome && !outcome.trim()) { toast.error("Add a customer-facing explanation for this outcome."); return; }
    updM.mutate(false);
  }

  return (
    <div className="space-y-6 p-6">
      <Link to="/admin/removal-cases" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="size-4" />All cases</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">{c.case_id}</h1><p className="text-sm text-muted-foreground">Created {new Date(c.created_at).toLocaleString()}</p></div>
        <div className="flex gap-2"><Badge variant={paid ? "default" : "outline"}>{paymentLabel(c.payment_status)}</Badge><Badge variant="secondary">{caseLabel(c.case_status)}</Badge></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Customer">
          <KV k="Name" v={c.full_name} /><KV k="Email" v={c.email} /><KV k="Phone" v={c.phone} /><KV k="Country" v={c.country} /><KV k="Relationship" v={c.affects} />
        </Card>
        <Card title="Submitted content" className="lg:col-span-2">
          <KV k="URL" v={<span className="break-all">{c.url}</span>} /><KV k="Platform" v={c.platform} /><KV k="Content type" v={c.content_type} />
          <KV k="Publisher / account" v={c.publisher} /><KV k="Page title" v={c.page_title} /><KV k="Detected category" v={c.potential_category} />
          <KV k="Issue" v={c.issue} />
          <p className="mt-3 whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">{c.explanation}</p>
          <Button asChild variant="outline" size="sm" className="mt-3"><a href={c.url} target="_blank" rel="noopener noreferrer">Open Submitted URL <ExternalLink className="size-3.5" /></a></Button>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="AI-Assisted Assessment">
          <KV k="Eligibility" v="Eligible for processing" /><KV k="Suggested route" v={c.recommended_route} /><KV k="Detected issue" v={c.potential_category} /><KV k="Confidence" v="Not scored" />
          <p className="mt-2 text-sm">{c.assessment_summary}</p>
          <p className="mt-2 text-xs text-muted-foreground">Automated guidance only. Not a final legal determination.</p>
        </Card>
        <Card title="Evidence">
          {!c.evidence.length && <p className="text-sm text-muted-foreground">No files uploaded.</p>}
          <ul className="space-y-2">
            {c.evidence.map((f: any, i: number) => (
              <li key={i} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-1.5"><FileText className="size-4 shrink-0" /><span className="truncate">{f.name}</span>
                  {f.source === "info_request" && <Badge variant="outline" className="text-[10px]">requested</Badge>}</span>
                {f.url && <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">Open</a>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Links are private and expire in 10 minutes.</p>
        </Card>
        <Card title="Payment">
          <KV k="Status" v={paymentLabel(c.payment_status)} /><KV k="Service price" v={`${c.fee_amount}`} /><KV k="Currency" v={c.currency} />
          <KV k="Preferred method" v={c.payment_method?.replace("_", " ")} /><KV k="Paid date" v={c.paid_at && new Date(c.paid_at).toLocaleString()} />
          <div className="mt-3 grid gap-2">
            <Input placeholder="Invoice reference" value={refs.invoiceRef} onChange={(e) => setRefs({ ...refs, invoiceRef: e.target.value })} />
            <Input placeholder="Payment reference" value={refs.paymentRef} onChange={(e) => setRefs({ ...refs, paymentRef: e.target.value })} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={paid || payM.isPending} onClick={() => payM.mutate("invoice_sent")}>Mark Invoice Sent</Button>
            <Button size="sm" disabled={paid || payM.isPending} onClick={() => setConfirmPaid(true)}>Mark Paid</Button>
            <Button size="sm" variant="ghost" disabled={!paid || payM.isPending} onClick={() => payM.mutate("refunded")}>Mark Refunded</Button>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Removal workflow" className="lg:col-span-2">
          {!paid && <p className="mb-3 rounded-lg bg-muted p-3 text-sm">This case cannot enter the removal workflow until it is marked paid.</p>}
          <select value={status} onChange={(e) => setStatus(e.target.value as CaseStatus)} disabled={!paid}
            className="h-12 w-full rounded-lg border bg-background px-3 text-base font-medium">
            {CASE_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {needsOutcome && (<>
            <label className="mt-4 block text-sm font-medium">Customer-facing explanation (required)</label>
            <Textarea rows={3} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Explain the outcome and any next options." />
          </>)}
          <label className="mt-4 block text-sm font-medium">Message visible to customer</label>
          <Textarea rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Your removal request has been submitted to the platform and is currently under review." />
          <label className="mt-4 block text-sm font-medium">Internal Staff Notes</label>
          <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} className="border-dashed" placeholder="Only Eterna staff can see this." />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={save} disabled={updM.isPending}>Save Update</Button>
            <Button variant="outline" disabled={!paid} onClick={() => setInfoOpen(true)}>Request More Information</Button>
          </div>
          {c.info_request && (
            <div className="mt-4 rounded-lg border p-3 text-sm">
              <p className="font-medium">{c.info_request.title} · <span className="text-muted-foreground">{c.info_request.status}</span></p>
              <p className="text-muted-foreground">{c.info_request.message}</p>
              {c.info_request.customer_note && <p className="mt-1">Customer: {c.info_request.customer_note}</p>}
            </div>
          )}
        </Card>
        <Card title="Timeline">
          <ol className="relative space-y-3 border-l pl-4">
            {c.events.map((e: any) => (
              <li key={e.id} className="text-sm">
                <span className="absolute -left-1 mt-1.5 size-2 rounded-full bg-primary" />
                <p className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</p>
                <p>{EVENT_LABEL[e.event_type] ?? e.event_type}
                  {e.event_type === "status_change" && `: ${caseLabel(e.old_value)} → ${caseLabel(e.new_value)}`}
                  {e.event_type === "payment_status" && `: ${paymentLabel(e.old_value)} → ${paymentLabel(e.new_value)}`}
                  {e.detail && <span className="text-muted-foreground"> · {e.detail}</span>}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Dialog open={confirmPaid} onOpenChange={setConfirmPaid}>
        <DialogContent><DialogTitle>Confirm payment received?</DialogTitle>
          <DialogDescription>This marks {c.currency} {c.fee_amount} as paid, activates the case and notifies the customer.</DialogDescription>
          <Button onClick={() => payM.mutate("paid")} disabled={payM.isPending}>Confirm paid</Button></DialogContent>
      </Dialog>
      <Dialog open={removedOpen} onOpenChange={setRemovedOpen}>
        <DialogContent><DialogTitle>Confirm content removal</DialogTitle>
          <DialogDescription>The customer will see: Content Removal Confirmed.</DialogDescription>
          <label className="text-sm">Verification date</label><Input type="date" value={rm.verifiedAt} onChange={(e) => setRm({ ...rm, verifiedAt: e.target.value })} />
          <Textarea placeholder="Completion note (internal)" value={rm.note} onChange={(e) => setRm({ ...rm, note: e.target.value })} />
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={rm.inaccessible} onCheckedChange={(v) => setRm({ ...rm, inaccessible: v === true })} />URL was inaccessible at verification</label>
          <Button onClick={() => updM.mutate(true)} disabled={updM.isPending}>Confirm removed</Button></DialogContent>
      </Dialog>
      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent><DialogTitle>Request more information</DialogTitle>
          <Input placeholder="Request title (e.g. Identity Verification Required)" value={info.title} onChange={(e) => setInfo({ ...info, title: e.target.value })} />
          <Textarea placeholder="Message to customer" value={info.message} onChange={(e) => setInfo({ ...info, message: e.target.value })} />
          <Input placeholder="Required document / information" value={info.required} onChange={(e) => setInfo({ ...info, required: e.target.value })} />
          <label className="text-sm">Deadline (optional)</label><Input type="date" value={info.deadline} onChange={(e) => setInfo({ ...info, deadline: e.target.value })} />
          <Button onClick={() => askM.mutate()} disabled={askM.isPending}>Send request</Button></DialogContent>
      </Dialog>
    </div>
  );
}

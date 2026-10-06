import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AdminGuard } from "@/components/AdminGuard";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { listRemovalCases } from "@/lib/removal-orders/admin.functions";
import { caseLabel, paymentLabel } from "@/lib/removal-orders/status";

export const Route = createFileRoute("/_app/admin/removal-cases/")({
  head: () => ({ meta: [{ title: "Pay-Per-Link Removal Cases — Eterna Sentinel" }, { name: "description", content: "Staff operations for pay-per-link removal requests." }] }),
  component: () => <AdminGuard><Page /></AdminGuard>,
});

type Row = Record<string, any>;
const STALE_DAYS = 3;
const FILTERS: [string, (r: Row) => boolean][] = [
  ["All Cases", () => true],
  ["Awaiting Payment", (r) => r.payment_status !== "paid" && r.case_status === "awaiting_payment"],
  ["Paid", (r) => r.payment_status === "paid"],
  ["Active", (r) => ["case_received", "verification", "evidence_review", "preparing"].includes(r.case_status)],
  ["Submitted", (r) => ["submitted", "resubmitted"].includes(r.case_status)],
  ["Platform Review", (r) => r.case_status === "platform_review"],
  ["Escalation", (r) => r.case_status === "escalation"],
  ["Action Required", (r) => ["info_required", "info_submitted"].includes(r.case_status) || r.staff_attention],
  ["Removed", (r) => r.case_status === "removed"],
  ["Rejected", (r) => ["rejected", "unable"].includes(r.case_status)],
  ["Closed", (r) => r.case_status === "closed"],
];
const isStale = (r: Row) => !["removed", "rejected", "unable", "closed"].includes(r.case_status) &&
  Date.now() - new Date(r.updated_at).getTime() > STALE_DAYS * 864e5;

function Page() {
  const list = useServerFn(listRemovalCases);
  const nav = useNavigate();
  const { data = [], isLoading } = useQuery({ queryKey: ["removal-cases"], queryFn: () => list(), refetchInterval: 30000 });
  const [filter, setFilter] = useState("All Cases");
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const f = FILTERS.find(([k]) => k === filter)![1];
    const s = q.trim().toLowerCase();
    return data.filter(f).filter((r) => !s || [r.case_id, r.full_name, r.email, r.phone, r.url, r.platform].some((v) => String(v ?? "").toLowerCase().includes(s)));
  }, [data, filter, q]);
  const count = (p: (r: Row) => boolean) => data.filter(p).length;
  const cards: [string, number, boolean?][] = [
    ["New Requests", count((r) => r.staff_attention && r.case_status === "awaiting_payment"), true],
    ["Awaiting Payment", count(FILTERS[1][1])],
    ["Paid / Active", count(FILTERS[3][1])],
    ["Under Review", count((r) => ["submitted", "platform_review", "escalation", "resubmitted"].includes(r.case_status))],
    ["Action Required", count(FILTERS[7][1]), true],
    ["Removed", count(FILTERS[8][1])],
    ["Closed", count((r) => ["closed", "rejected", "unable"].includes(r.case_status))],
  ];
  const stale = count(isStale);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Pay-Per-Link Removal Cases</h1>
        {stale > 0 && <p className="mt-1 text-sm text-destructive">{stale} open case(s) with no update for {STALE_DAYS}+ days.</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {cards.map(([k, n, alert]) => (
          <div key={k} className="relative rounded-xl border bg-card p-4">
            {alert && n > 0 && <span className="absolute right-3 top-3 size-2 animate-pulse rounded-full bg-destructive" />}
            <p className="text-xs text-muted-foreground">{k}</p><p className="mt-1 text-2xl font-semibold">{n}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([k]) => (
          <button key={k} onClick={() => setFilter(k)} className={`rounded-full border px-3 py-1 text-xs ${filter === k ? "border-primary bg-primary/10 font-medium" : ""}`}>{k}</button>
        ))}
      </div>
      <Input placeholder="Search case ID, name, email, phone, URL, platform" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-md" />
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>{["Case ID", "Customer", "Submitted URL", "Platform", "Issue Type", "Price", "Payment Status", "Case Status", "Created", "Last Updated"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && !rows.length && <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">No cases.</td></tr>}
            {rows.map((r) => (
              <tr key={r.case_id} onClick={() => nav({ to: "/admin/removal-cases/$caseId", params: { caseId: r.case_id } })} className="cursor-pointer border-t hover:bg-muted/40">
                <td className="whitespace-nowrap px-3 py-2 font-medium">
                  {r.staff_attention && <span className="mr-1.5 inline-block size-2 rounded-full bg-destructive" />}{r.case_id}
                </td>
                <td className="px-3 py-2">{r.full_name}<div className="text-xs text-muted-foreground">{r.email}</div></td>
                <td className="max-w-[220px] truncate px-3 py-2">{r.url}</td>
                <td className="px-3 py-2">{r.platform}</td>
                <td className="px-3 py-2">{r.issue}</td>
                <td className="whitespace-nowrap px-3 py-2">{r.currency} {r.fee_amount}</td>
                <td className="px-3 py-2"><Badge variant={r.payment_status === "paid" ? "default" : "outline"}>{paymentLabel(r.payment_status)}</Badge></td>
                <td className="px-3 py-2"><Badge variant="secondary">{caseLabel(r.case_status)}</Badge>{isStale(r) && <span className="ml-1 text-xs text-destructive">stale</span>}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{new Date(r.created_at).toLocaleString()}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{new Date(r.updated_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

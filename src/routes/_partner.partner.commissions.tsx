import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { getPartnerDashboard } from "@/lib/partners/dashboard.functions";
import { PartnerStat, PartnerStatusPill, fmtInr } from "@/components/partners/partner-ui";
import { IndianRupee } from "lucide-react";

export const Route = createFileRoute("/_partner/partner/commissions")({
  head: () => ({ meta: [{ title: "Commissions — Eterna Sentinel Partner" }] }),
  component: PartnerCommissionsPage,
});

type Dash = Awaited<ReturnType<typeof getPartnerDashboard>>;

function PartnerCommissionsPage() {
  const load = useServerFn(getPartnerDashboard);
  const [dash, setDash] = useState<Dash | null>(null);

  useEffect(() => {
    void (async () => setDash(await load({})))();
  }, [load]);

  if (!dash) return <div className="p-10 text-slate-500">Loading…</div>;

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Commissions</h1>
        <p className="text-sm text-slate-500">
          Earnings for Partner ID {dash.partner.partner_id} at {Number(dash.partner.commission_pct)}
          %.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PartnerStat
          icon={IndianRupee}
          label="Lifetime"
          value={fmtInr(dash.totals.lifetime)}
          accent="text-blue-700"
        />
        <PartnerStat
          icon={IndianRupee}
          label="Payable"
          value={fmtInr(dash.totals.payable)}
          accent="text-emerald-700"
        />
        <PartnerStat
          icon={IndianRupee}
          label="Pending"
          value={fmtInr(dash.totals.pending)}
          accent="text-amber-700"
        />
      </div>

      <Card className="border border-slate-200 bg-white p-6 rounded-xl shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2">Earned</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {dash.commissions.map((c) => (
                <tr key={c.id} className="border-b border-slate-100">
                  <td className="py-2 text-slate-600">
                    {new Date(c.earned_at).toLocaleDateString()}
                  </td>
                  <td>
                    <PartnerStatusPill status={c.status} />
                  </td>
                  <td className="text-right">{fmtInr(Number(c.commission_inr ?? 0))}</td>
                </tr>
              ))}
              {dash.commissions.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-slate-500">
                    No commissions recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

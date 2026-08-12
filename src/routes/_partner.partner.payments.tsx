import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { getPartnerDashboard } from "@/lib/partners/dashboard.functions";
import { PartnerStat, PartnerStatusPill, fmtInr } from "@/components/partners/partner-ui";
import { IndianRupee, Wallet } from "lucide-react";

export const Route = createFileRoute("/_partner/partner/payments")({
  head: () => ({ meta: [{ title: "Payments — Eterna Sentinel Partner" }] }),
  component: PartnerPaymentsPage,
});

type Dash = Awaited<ReturnType<typeof getPartnerDashboard>>;

function PartnerPaymentsPage() {
  const load = useServerFn(getPartnerDashboard);
  const [dash, setDash] = useState<Dash | null>(null);

  useEffect(() => {
    void (async () => setDash(await load({})))();
  }, [load]);

  const paidRows = useMemo(
    () => (dash?.commissions ?? []).filter((c) => c.status === "PAID" || c.status === "PAYABLE"),
    [dash],
  );

  if (!dash) return <div className="p-10 text-slate-500">Loading…</div>;

  const paidTotal = dash.commissions
    .filter((c) => c.status === "PAID")
    .reduce((sum, c) => sum + Number(c.commission_inr ?? 0), 0);

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Payments</h1>
        <p className="text-sm text-slate-500">
          Payable balance and settlement history for your partner account.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PartnerStat
          icon={Wallet}
          label="Payable now"
          value={fmtInr(dash.totals.payable)}
          accent="text-emerald-700"
        />
        <PartnerStat
          icon={IndianRupee}
          label="Paid to date"
          value={fmtInr(paidTotal)}
          accent="text-slate-800"
        />
      </div>

      <Card className="border border-slate-200 bg-white p-6 rounded-xl shadow-sm">
        <div className="font-semibold mb-4">Settlement queue</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2">Date</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {paidRows.map((c) => (
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
              {paidRows.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-slate-500">
                    No payable or paid settlements yet.
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

import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getPartnerDashboard, registerPartnerLead } from "@/lib/partners/dashboard.functions";
import { PartnerStatusPill, fmtInr } from "@/components/partners/partner-ui";

export const Route = createFileRoute("/_partner/partner/clients")({
  head: () => ({ meta: [{ title: "Clients & Leads — Eterna Sentinel Partner" }] }),
  component: PartnerClientsPage,
});

type Dash = Awaited<ReturnType<typeof getPartnerDashboard>>;

function PartnerClientsPage() {
  const load = useServerFn(getPartnerDashboard);
  const register = useServerFn(registerPartnerLead);
  const [dash, setDash] = useState<Dash | null>(null);
  const [lead, setLead] = useState({ lead_email: "", lead_name: "", lead_phone: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = async () => setDash(await load({}));
  useEffect(() => {
    void refresh();
  }, []);

  if (!dash) return <div className="p-10 text-slate-500">Loading…</div>;

  const submitLead = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await register({ data: lead });
      setLead({ lead_email: "", lead_name: "", lead_phone: "", notes: "" });
      setMsg("Client registered.");
      await refresh();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Clients & Leads</h1>
        <p className="text-sm text-slate-500">
          Full pipeline attributed to Partner ID {dash.partner.partner_id}.
        </p>
      </header>

      <Card className="border border-slate-200 bg-white p-6 rounded-xl shadow-sm">
        <div className="font-semibold mb-4">Register a client</div>
        <form onSubmit={submitLead} className="grid gap-3 md:grid-cols-2">
          <Input
            placeholder="Client email *"
            type="email"
            required
            value={lead.lead_email}
            onChange={(e) => setLead({ ...lead, lead_email: e.target.value })}
          />
          <Input
            placeholder="Client name"
            value={lead.lead_name}
            onChange={(e) => setLead({ ...lead, lead_name: e.target.value })}
          />
          <Input
            placeholder="Phone"
            value={lead.lead_phone}
            onChange={(e) => setLead({ ...lead, lead_phone: e.target.value })}
          />
          <Textarea
            placeholder="Notes"
            rows={1}
            value={lead.notes}
            onChange={(e) => setLead({ ...lead, notes: e.target.value })}
          />
          <div className="md:col-span-2">
            <Button
              type="submit"
              disabled={busy}
              className="text-white"
              style={{ background: "linear-gradient(90deg,#1037A6,#1E5EFF)" }}
            >
              {busy ? "Saving…" : "Register client"}
            </Button>
          </div>
        </form>
        {msg && <div className="mt-3 text-sm text-slate-600">{msg}</div>}
      </Card>

      <Card className="border border-slate-200 bg-white p-6 rounded-xl shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2">Client</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Status</th>
                <th className="text-right">Commission</th>
                <th>Registered</th>
              </tr>
            </thead>
            <tbody>
              {dash.leads.map((l) => (
                <tr key={l.id} className="border-b border-slate-100">
                  <td className="py-2">{l.lead_name ?? "—"}</td>
                  <td className="text-slate-600">{l.lead_email}</td>
                  <td className="text-slate-600">{l.lead_phone ?? "—"}</td>
                  <td>
                    <PartnerStatusPill status={l.status} />
                  </td>
                  <td className="text-right">{fmtInr(Number(l.commission_amount_inr ?? 0))}</td>
                  <td className="text-slate-500">{new Date(l.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {dash.leads.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No clients registered yet.
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

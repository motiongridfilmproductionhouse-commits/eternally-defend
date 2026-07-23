import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getPartnerDashboard, registerPartnerLead, generatePartnerProposalUrl } from "@/lib/partners/dashboard.functions";
import { getPartnerAgreementUrl } from "@/lib/partners/applications.functions";
import { Copy, IndianRupee, Users, CheckCircle2, FileText, Link as LinkIcon } from "lucide-react";

export const Route = createFileRoute("/_partner/")({
  head: () => ({ meta: [{ title: "Partner Dashboard — Eterna" }] }),
  component: PartnerDashboard,
});

type Dash = Awaited<ReturnType<typeof getPartnerDashboard>>;

function PartnerDashboard() {
  const load = useServerFn(getPartnerDashboard);
  const register = useServerFn(registerPartnerLead);
  const proposal = useServerFn(generatePartnerProposalUrl);
  const getAgreementUrl = useServerFn(getPartnerAgreementUrl);
  const [dash, setDash] = useState<Dash | null>(null);
  const [lead, setLead] = useState({ lead_email: "", lead_name: "", lead_phone: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [proposalName, setProposalName] = useState("");

  const refresh = async () => setDash(await load({}));
  useEffect(() => { void refresh(); }, []);

  const referralUrl = useMemo(() => {
    if (!dash || typeof window === "undefined") return "";
    return `${window.location.origin}/auth?ref=${dash.partner.referral_code}`;
  }, [dash]);

  if (!dash) return <div className="p-10 text-slate-500">Loading…</div>;

  const submitLead = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await register({ data: lead });
      setLead({ lead_email: "", lead_name: "", lead_phone: "", notes: "" });
      setMsg("Client registered.");
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const genProposal = async () => {
    if (!proposalName.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const { url } = await proposal({ data: { client_name: proposalName.trim() } });
      window.open(url, "_blank", "noopener,noreferrer");
      setProposalName("");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const activeAgreement = dash.agreements.find((a) => a.status === "ACTIVE") ?? dash.agreements[0];
  const openAgreement = async (kind: "signed" | "draft") => {
    if (!activeAgreement) return;
    const { url } = await getAgreementUrl({ data: { agreement_id: activeAgreement.id, kind } });
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const paidCount = dash.leads.filter((l) => l.status === "PAID").length;
  const activeCount = dash.leads.filter((l) => ["ONBOARDING", "ACTIVE"].includes(l.status)).length;

  return (
    <div className="p-8 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome, {dash.partner.legal_company_name}</h1>
          <p className="text-sm text-slate-500">Partner ID <span className="font-mono">{dash.partner.partner_id}</span> · Territory {dash.partner.territory ?? "—"} · Commission {Number(dash.partner.commission_pct)}%</p>
        </div>
        <div className="flex items-center gap-2">
          {activeAgreement?.signed_s3_key && (
            <Button variant="outline" onClick={() => openAgreement("signed")}>
              <FileText className="size-4 mr-2" /> Signed agreement
            </Button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Stat icon={IndianRupee} label="Lifetime commissions" value={fmtInr(dash.totals.lifetime)} accent="text-blue-700" />
        <Stat icon={IndianRupee} label="Payable now" value={fmtInr(dash.totals.payable)} accent="text-emerald-700" />
        <Stat icon={CheckCircle2} label="Paid clients" value={String(paidCount)} accent="text-slate-800" />
        <Stat icon={Users} label="Active pipeline" value={String(activeCount)} accent="text-slate-800" />
      </div>

      <Card className="border border-slate-200 bg-white p-6 rounded-xl shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <LinkIcon className="size-4 text-blue-600" />
          <div className="font-semibold">Your referral link</div>
        </div>
        <div className="flex items-center gap-2">
          <Input readOnly value={referralUrl} className="font-mono text-sm" />
          <Button variant="outline" onClick={() => { navigator.clipboard.writeText(referralUrl); setMsg("Copied."); }}>
            <Copy className="size-4 mr-2" /> Copy
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Every client who signs up through this link is attributed to your Partner ID. Duplicate claims are automatically blocked.</p>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="border border-slate-200 bg-white p-6 rounded-xl shadow-sm">
          <div className="font-semibold mb-4">Register a client</div>
          <form onSubmit={submitLead} className="space-y-3">
            <Input placeholder="Client email *" type="email" required value={lead.lead_email} onChange={(e) => setLead({ ...lead, lead_email: e.target.value })} />
            <Input placeholder="Client name" value={lead.lead_name} onChange={(e) => setLead({ ...lead, lead_name: e.target.value })} />
            <Input placeholder="Phone" value={lead.lead_phone} onChange={(e) => setLead({ ...lead, lead_phone: e.target.value })} />
            <Textarea placeholder="Notes" rows={2} value={lead.notes} onChange={(e) => setLead({ ...lead, notes: e.target.value })} />
            <Button type="submit" disabled={busy} className="text-white" style={{ background: "linear-gradient(90deg,#1037A6,#1E5EFF)" }}>
              {busy ? "Saving…" : "Register client"}
            </Button>
          </form>
        </Card>

        <Card className="border border-slate-200 bg-white p-6 rounded-xl shadow-sm">
          <div className="font-semibold mb-4">Generate ₹5 Lakh Proposal</div>
          <div className="space-y-3">
            <Input placeholder="Client / prospect name" value={proposalName} onChange={(e) => setProposalName(e.target.value)} />
            <Button onClick={genProposal} disabled={busy || !proposalName.trim()} className="text-white" style={{ background: "linear-gradient(90deg,#1037A6,#1E5EFF)" }}>
              <FileText className="size-4 mr-2" /> Generate PDF proposal
            </Button>
            <p className="text-xs text-slate-500">Creates a branded proposal PDF with your Partner ID and referral code included.</p>
          </div>
        </Card>
      </div>

      <Card className="border border-slate-200 bg-white p-6 rounded-xl shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="font-semibold">Sales pipeline</div>
          <Link to="/partner/clients" className="text-xs text-blue-600 hover:underline">View all →</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-2">Client</th><th>Email</th><th>Status</th><th className="text-right">Commission</th><th>Registered</th>
              </tr>
            </thead>
            <tbody>
              {dash.leads.slice(0, 8).map((l) => (
                <tr key={l.id} className="border-b border-slate-100">
                  <td className="py-2">{l.lead_name ?? "—"}</td>
                  <td className="text-slate-600">{l.lead_email}</td>
                  <td><StatusPill status={l.status} /></td>
                  <td className="text-right">{fmtInr(Number(l.commission_amount_inr ?? 0))}</td>
                  <td className="text-slate-500">{new Date(l.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {dash.leads.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-slate-500">No clients registered yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {msg && <div className="text-sm text-slate-600">{msg}</div>}
    </div>
  );
}

function Stat({ icon: Icon, label, value, accent }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; accent: string }) {
  return (
    <Card className="border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500"><Icon className="size-4" />{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${accent}`}>{value}</div>
    </Card>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    LEAD: "bg-slate-100 text-slate-700",
    ONBOARDING: "bg-blue-100 text-blue-700",
    ACTIVE: "bg-indigo-100 text-indigo-700",
    PAID: "bg-emerald-100 text-emerald-700",
    REFUNDED: "bg-amber-100 text-amber-700",
    REJECTED: "bg-red-100 text-red-700",
    CANCELLED: "bg-slate-100 text-slate-500",
  };
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${map[status] ?? "bg-slate-100"}`}>{status}</span>;
}

function fmtInr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

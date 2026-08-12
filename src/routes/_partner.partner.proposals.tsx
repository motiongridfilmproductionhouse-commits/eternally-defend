import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getPartnerDashboard,
  generatePartnerProposalUrl,
} from "@/lib/partners/dashboard.functions";
import { FileText } from "lucide-react";

export const Route = createFileRoute("/_partner/partner/proposals")({
  head: () => ({ meta: [{ title: "Proposals — Eterna Sentinel Partner" }] }),
  component: PartnerProposalsPage,
});

function PartnerProposalsPage() {
  const load = useServerFn(getPartnerDashboard);
  const proposal = useServerFn(generatePartnerProposalUrl);
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const dash = await load({});
      setPartnerName(dash.partner.legal_company_name);
    })();
  }, [load]);

  const genProposal = async () => {
    if (!clientName.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const { url } = await proposal({
        data: {
          client_name: clientName.trim(),
          client_email: clientEmail.trim() || undefined,
        },
      });
      window.open(url, "_blank", "noopener,noreferrer");
      setMsg("Proposal PDF generated.");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Proposals</h1>
        <p className="text-sm text-slate-500">
          Generate branded ₹5 Lakh proposals for {partnerName ?? "your partner account"}.
        </p>
      </header>

      <Card className="border border-slate-200 bg-white p-6 rounded-xl shadow-sm max-w-xl space-y-3">
        <div className="font-semibold">New proposal</div>
        <Input
          placeholder="Client / prospect name *"
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
        />
        <Input
          placeholder="Client email (optional)"
          type="email"
          value={clientEmail}
          onChange={(e) => setClientEmail(e.target.value)}
        />
        <Button
          onClick={genProposal}
          disabled={busy || !clientName.trim()}
          className="text-white"
          style={{ background: "linear-gradient(90deg,#1037A6,#1E5EFF)" }}
        >
          <FileText className="size-4 mr-2" />
          {busy ? "Generating…" : "Generate PDF proposal"}
        </Button>
        <p className="text-xs text-slate-500">
          Each PDF includes your Partner ID and referral code for attribution.
        </p>
        {msg && <div className="text-sm text-slate-600">{msg}</div>}
      </Card>
    </div>
  );
}

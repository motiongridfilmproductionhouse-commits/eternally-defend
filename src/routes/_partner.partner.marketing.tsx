import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPartnerDashboard } from "@/lib/partners/dashboard.functions";
import { Copy, Megaphone } from "lucide-react";

export const Route = createFileRoute("/_partner/partner/marketing")({
  head: () => ({ meta: [{ title: "Marketing — Eterna Partner" }] }),
  component: PartnerMarketingPage,
});

function PartnerMarketingPage() {
  const load = useServerFn(getPartnerDashboard);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const dash = await load({});
      setReferralCode(dash.partner.referral_code);
      setPartnerId(dash.partner.partner_id);
    })();
  }, [load]);

  const referralUrl = useMemo(() => {
    if (!referralCode || typeof window === "undefined") return "";
    return `${window.location.origin}/auth?ref=${referralCode}`;
  }, [referralCode]);

  return (
    <div className="p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Marketing</h1>
        <p className="text-sm text-slate-500">Referral assets for Partner ID {partnerId ?? "…"}.</p>
      </header>

      <Card className="border border-slate-200 bg-white p-6 rounded-xl shadow-sm space-y-4 max-w-2xl">
        <div className="flex items-center gap-2">
          <Megaphone className="size-4 text-blue-600" />
          <div className="font-semibold">Referral link</div>
        </div>
        <div className="flex items-center gap-2">
          <Input readOnly value={referralUrl} className="font-mono text-sm" />
          <Button
            variant="outline"
            disabled={!referralUrl}
            onClick={() => {
              void navigator.clipboard.writeText(referralUrl);
              setMsg("Copied referral link.");
            }}
          >
            <Copy className="size-4 mr-2" /> Copy
          </Button>
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-sm text-slate-600 space-y-2">
          <p>
            Share your referral link in proposals, email signatures, and partner campaigns. New
            client signups through this link are attributed to your Partner ID automatically.
          </p>
          <p>
            Referral code:{" "}
            <span className="font-mono font-medium text-slate-800">{referralCode ?? "…"}</span>
          </p>
        </div>
        {msg && <div className="text-sm text-slate-600">{msg}</div>}
      </Card>
    </div>
  );
}

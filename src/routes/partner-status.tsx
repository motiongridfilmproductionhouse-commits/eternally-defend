import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMyPartnerApplication, getPartnerAgreementUrl } from "@/lib/partners/applications.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck, FileText, Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/partner-status")({
  ssr: false,
  head: () => ({ meta: [{ title: "Partner Application Status — Eterna" }] }),
  component: PartnerStatusPage,
});

type Application = { id: string; status: string; legal_company_name: string; created_at: string; review_notes: string | null; assigned_partner_id: string | null };
type Agreement = { id: string; status: string; draft_s3_key: string; signed_s3_key: string | null; eterna_signed_at: string | null };

function PartnerStatusPage() {
  const navigate = useNavigate();
  const load = useServerFn(getMyPartnerApplication);
  const getUrl = useServerFn(getPartnerAgreementUrl);
  const [data, setData] = useState<{ application: Application | null; agreement: Agreement | null; profile: { partner_id: string } | null } | null>(null);

  useEffect(() => {
    (async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) return navigate({ to: "/auth" });
      const res = await load({});
      if (!res.application) return navigate({ to: "/partner-apply" });
      setData(res as never);
    })();
  }, [load, navigate]);

  if (!data || !data.application) {
    return <div className="min-h-screen grid place-items-center text-slate-500">Loading…</div>;
  }

  const app = data.application;
  const agreement = data.agreement;
  const partnerActive = app.status === "APPROVED" && data.profile?.partner_id;

  const openAgreement = async (kind: "draft" | "signed") => {
    if (!agreement) return;
    const { url } = await getUrl({ data: { agreement_id: agreement.id, kind } });
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const statusMeta = statusChip(app.status);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/auth" className="flex items-center gap-2">
            <div className="size-8 rounded-lg grid place-items-center text-white" style={{ background: "linear-gradient(135deg,#1037A6,#1E5EFF)" }}>
              <ShieldCheck className="size-4" />
            </div>
            <div className="font-semibold">Eterna Partner Programme</div>
          </Link>
          <button className="text-sm text-slate-500 hover:text-slate-800" onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/auth" }); }}>Sign out</button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Application status</h1>
          <p className="mt-1 text-sm text-slate-500">{app.legal_company_name} · submitted {new Date(app.created_at).toLocaleDateString()}</p>
        </div>

        <Card className="border border-slate-200 shadow-sm p-6 rounded-xl">
          <div className="flex items-center gap-3">
            <div className={`size-10 rounded-full grid place-items-center ${statusMeta.bg}`}>
              <statusMeta.icon className={`size-5 ${statusMeta.fg}`} />
            </div>
            <div>
              <div className="font-semibold">{statusMeta.title}</div>
              <div className="text-sm text-slate-500">{statusMeta.desc}</div>
            </div>
          </div>
          {app.review_notes && (
            <div className="mt-4 text-sm p-3 bg-slate-50 border border-slate-200 rounded-md">
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Reviewer notes</div>
              {app.review_notes}
            </div>
          )}
        </Card>

        {agreement && (
          <Card className="border border-slate-200 shadow-sm p-6 rounded-xl">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="size-4 text-blue-600" />
              <div className="font-semibold">Partner Agreement / MOU</div>
            </div>
            <div className="text-sm text-slate-600 mb-4">
              Status: <span className="font-medium">{agreement.status.replaceAll("_", " ")}</span>
              {agreement.eterna_signed_at && <> · Countersigned {new Date(agreement.eterna_signed_at).toLocaleDateString()}</>}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => openAgreement("draft")}>View draft</Button>
              {agreement.signed_s3_key && (
                <Button className="text-white" style={{ background: "linear-gradient(90deg,#1037A6,#1E5EFF)" }} onClick={() => openAgreement("signed")}>
                  Download countersigned copy
                </Button>
              )}
            </div>
          </Card>
        )}

        {partnerActive && (
          <Card className="border border-blue-200 bg-blue-50/50 p-6 rounded-xl">
            <div className="font-semibold text-blue-900">Your partner dashboard is ready.</div>
            <p className="text-sm text-blue-800/80 mt-1">Partner ID: <span className="font-mono">{data.profile?.partner_id}</span></p>
            <div className="mt-4">
              <Link to="/partner">
                <Button className="text-white" style={{ background: "linear-gradient(90deg,#1037A6,#1E5EFF)" }}>Open Partner Dashboard</Button>
              </Link>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}

function statusChip(status: string) {
  switch (status) {
    case "APPROVED": return { title: "Approved", desc: "Your partner account has been activated.", icon: CheckCircle2, bg: "bg-green-100", fg: "text-green-700" };
    case "REJECTED": return { title: "Rejected", desc: "See reviewer notes below.", icon: XCircle, bg: "bg-red-100", fg: "text-red-700" };
    case "INFO_REQUESTED": return { title: "More information requested", desc: "The Eterna team has asked for clarifications.", icon: AlertCircle, bg: "bg-amber-100", fg: "text-amber-700" };
    default: return { title: "Pending review", desc: "Our team is reviewing your application and documents.", icon: Clock, bg: "bg-blue-100", fg: "text-blue-700" };
  }
}

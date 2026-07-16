import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getPublicVerification } from "@/lib/onboarding/certificate.functions";
import { ShieldCheck, Loader2, AlertTriangle, CheckCircle2, ShieldAlert, FileText, Calendar, Building, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/verify/$slug")({
  component: PublicVerificationPage,
});

function PublicVerificationPage() {
  const { slug } = Route.useParams();
  const fetchVerify = useServerFn(getPublicVerification);

  const { data, isLoading } = useQuery({
    queryKey: ["public_verify", slug],
    queryFn: () => fetchVerify({ data: { slug } }),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#050A15] flex flex-col items-center justify-center p-4">
        <Loader2 className="size-10 animate-spin text-blue-500 mb-4" />
        <div className="text-white/60">Verifying on Eterna Registry...</div>
      </div>
    );
  }

  if (!data || data.status === "NOT_FOUND") {
    return (
      <div className="min-h-screen bg-[#050A15] flex flex-col items-center justify-center p-4">
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-8 max-w-md w-full text-center">
          <XCircle className="size-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">Certificate Not Found</h1>
          <p className="text-white/60 text-sm">
            The requested verification slug does not exist or is invalid. This certificate may be forged or entered incorrectly.
          </p>
        </div>
      </div>
    );
  }

  const cert = data as any;
  const isExpired = cert.expires_at ? new Date(cert.expires_at) < new Date() : false;
  const isSuspended = cert.status === "SUSPENDED" || cert.authorization_status === "SUSPENDED";
  const isRevoked = cert.status === "REVOKED" || cert.authorization_status === "REVOKED";
  const isActive = cert.status === "ACTIVE" && cert.authorization_status === "ACTIVE" && !isExpired;

  const getStatusColor = () => {
    if (isRevoked) return "text-red-400 bg-red-500/10 border-red-500/20";
    if (isSuspended) return "text-orange-400 bg-orange-500/10 border-orange-500/20";
    if (isExpired) return "text-yellow-400 bg-yellow-500/10 border-yellow-500/20";
    return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  };

  const getStatusIcon = () => {
    if (isActive) return <ShieldCheck className="size-8" />;
    if (isRevoked || isExpired) return <XCircle className="size-8" />;
    return <AlertTriangle className="size-8" />;
  };

  const getStatusLabel = () => {
    if (isRevoked) return "REVOKED";
    if (isSuspended) return "SUSPENDED";
    if (isExpired) return "EXPIRED";
    return "ACTIVE";
  };

  return (
    <div className="min-h-screen bg-[#050A15] text-white p-4 sm:p-8 flex justify-center">
      <div className="max-w-3xl w-full space-y-6 pt-4 sm:pt-12">
        
        <div className="flex items-center gap-3 justify-center mb-12">
          <div className="size-10 rounded-xl grid place-items-center text-white" style={{ background: "var(--gradient-brand)" }}>
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <div className="font-display font-bold text-[15px] leading-tight tracking-tight">Eterna AI</div>
            <div className="text-[9px] tracking-[0.22em] text-white/60 font-semibold uppercase">Verification Registry</div>
          </div>
        </div>

        <div className={`p-6 border rounded-2xl flex flex-col sm:flex-row items-center sm:justify-between text-center sm:text-left gap-6 ${getStatusColor()}`}>
          <div className="flex flex-col sm:flex-row items-center gap-4">
            {getStatusIcon()}
            <div>
              <div className="text-xl font-bold">{getStatusLabel()}</div>
              <div className="text-sm opacity-80 mt-1">
                {isActive ? "This certificate is mathematically verified and active." : "This certificate is invalid or requires attention."}
              </div>
            </div>
          </div>
          <div className="text-center sm:text-right shrink-0">
            <div className="text-4xl font-bold">{cert.score}/100</div>
            <div className="text-[10px] uppercase tracking-wider opacity-70 mt-1">Verification Score</div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white/80 border-b border-white/10 pb-2 flex items-center gap-2">
              <Building className="size-4" /> Client Information
            </h3>
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-[10px] text-white/40 uppercase tracking-wider">Client Name</div>
                <div className="font-medium text-white">{cert.display_name || "-"}</div>
              </div>
              <div>
                <div className="text-[10px] text-white/40 uppercase tracking-wider">Company / Entity</div>
                <div className="font-medium text-white">{cert.company_name || "-"}</div>
              </div>
              <div>
                <div className="text-[10px] text-white/40 uppercase tracking-wider">Public Client ID</div>
                <div className="font-mono text-xs text-white/70">{cert.client_id}</div>
              </div>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-white/80 border-b border-white/10 pb-2 flex items-center gap-2">
              <FileText className="size-4" /> Certificate Details
            </h3>
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-[10px] text-white/40 uppercase tracking-wider">Certificate Number</div>
                <div className="font-mono text-xs text-white/70">{cert.certificate_number}</div>
              </div>
              <div>
                <div className="text-[10px] text-white/40 uppercase tracking-wider">Authorization Number</div>
                <div className="font-mono text-xs text-white/70">{cert.auth_number}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] text-white/40 uppercase tracking-wider">Issued</div>
                  <div className="text-white">{cert.issued_at ? new Date(cert.issued_at).toLocaleDateString() : '-'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-white/40 uppercase tracking-wider">Expires</div>
                  <div className="text-white">{cert.expires_at ? new Date(cert.expires_at).toLocaleDateString() : '-'}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white/80 border-b border-white/10 pb-2 flex items-center gap-2">
            <CheckCircle2 className="size-4" /> Verified Claims
          </h3>
          <div className="grid sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
            <div className="flex items-center gap-3"><CheckCircle2 className="size-5 text-emerald-400" /> Identity Verified</div>
            <div className="flex items-center gap-3"><CheckCircle2 className="size-5 text-emerald-400" /> Real Human Verified</div>
            <div className="flex items-center gap-3"><CheckCircle2 className="size-5 text-emerald-400" /> Asset Ownership Verified</div>
            <div className="flex items-center gap-3"><CheckCircle2 className="size-5 text-emerald-400" /> Authorization Signed</div>
            <div className="flex items-center gap-3"><CheckCircle2 className="size-5 text-emerald-400" /> Admin Approved</div>
            {cert.enforcement_enabled && (
              <div className="flex items-center gap-3"><CheckCircle2 className="size-5 text-emerald-400" /> AI Enforcement Active</div>
            )}
          </div>
          <div className="text-xs text-white/40 pt-2 border-t border-white/5 mt-4">
            Eterna AI continuously monitors verification statuses. If any underlying claim fails or is revoked, this certificate is immediately suspended.
          </div>
        </div>

        <div className="text-center pt-8 text-xs text-white/40">
          Powered by Eterna AI Security Cloud
        </div>
      </div>
    </div>
  );
}

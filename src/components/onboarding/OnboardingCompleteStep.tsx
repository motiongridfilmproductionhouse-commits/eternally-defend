import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2,
  ShieldCheck,
  Download,
  FileKey2,
  Settings,
  LayoutDashboard,
  CheckCircle2,
} from "lucide-react";
import { getMyCertificate } from "@/lib/onboarding/certificate.functions";
import { getAuthorizationBundle } from "@/lib/onboarding/authorization.functions";
import {
  downloadProtectionCertificate,
  downloadProtectionBundle,
  getFinalDownloadStatus,
} from "@/lib/onboarding/final-package.functions";
import { completeOnboarding, completeV2Onboarding } from "@/lib/onboarding/progress.functions";
import { useState } from "react";
import { toast } from "sonner";
import { V2_BADGES, isV2AccountType, type V2AccountType } from "@/lib/onboarding/v2-config";

export function OnboardingCompleteStep({
  onGoToStep,
  accountType = null,
  showGovernmentId,
}: {
  onGoToStep: (step: number) => void;
  accountType?: V2AccountType | string | null;
  showGovernmentId?: boolean;
}) {
  const fetchCert = useServerFn(getMyCertificate);
  const fetchAuth = useServerFn(getAuthorizationBundle);
  const fetchStatus = useServerFn(getFinalDownloadStatus);
  const downloadCert = useServerFn(downloadProtectionCertificate);
  const downloadBundle = useServerFn(downloadProtectionBundle);
  const completeV1 = useServerFn(completeOnboarding);
  const completeV2 = useServerFn(completeV2Onboarding);
  const navigate = useNavigate();
  const isV2 = isV2AccountType(accountType);

  const { data: cert, isLoading: certLoading } = useQuery({
    queryKey: ["my_certificate"],
    queryFn: () => fetchCert(),
  });

  const { data: authBundle, isLoading: authLoading } = useQuery({
    queryKey: ["auth_bundle"],
    queryFn: () => fetchAuth(),
  });

  const { data: downloadStatus } = useQuery({
    queryKey: ["final_download_status"],
    queryFn: () => fetchStatus(),
  });

  const [busy, setBusy] = useState<null | "cert" | "bundle">(null);
  const filesReady = downloadStatus?.ready === true;

  /**
   * Saves a server-generated artifact from a same-origin blob. Presigned S3 URLs
   * cannot be downloaded from the page (no bucket CORS rule for this origin), which
   * is why the previous certificate/bundle buttons did nothing.
   */
  const saveBase64 = (base64: string, filename: string, contentType: string) => {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const handleDownloadCert = async () => {
    setBusy("cert");
    try {
      const res = await downloadCert();
      saveBase64(res.base64, res.filename, res.contentType);
      toast.success("Protection Certificate downloaded.");
    } catch (e: unknown) {
      toast.error(
        e instanceof Error ? e.message : "We couldn't generate your Protection Certificate.",
      );
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadBundle = async () => {
    setBusy("bundle");
    try {
      const res = await downloadBundle();
      saveBase64(res.base64, res.filename, res.contentType);
      toast.success("Complete bundle downloaded.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "We couldn't build your protection bundle.");
    } finally {
      setBusy(null);

    }
  };

  if (certLoading || authLoading) {
    return (
      <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl">
        <CardContent className="py-12 flex justify-center">
          <Loader2 className="size-6 animate-spin text-blue-500" />
        </CardContent>
      </Card>
    );
  }

  if (!cert || cert.status !== "ACTIVE" || authBundle?.auth?.status !== "ACTIVE") {
    return (
      <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl">
        <CardContent className="py-12 text-center">
          <div className="text-red-400 mb-2">Onboarding is not yet complete.</div>
          <Button
            variant="outline"
            onClick={() => onGoToStep(1)}
            className="bg-slate-950/60 border-sky-500/30 text-sky-100 hover:bg-sky-950/40 hover:text-white"
          >
            Return to Start
          </Button>
        </CardContent>
      </Card>
    );
  }

  const snapshot = cert.snapshot as {
    kyc?: { verification_status?: string };
    face?: { status?: string };
    assets?: Array<{ verification_status?: string }>;
    signatures?: Array<{ status?: string }>;
  } | null;
  const snapKyc = snapshot?.kyc?.verification_status === "APPROVED";
  const snapFace = snapshot?.face?.status === "FACE_VERIFIED";
  const snapAsset = (snapshot?.assets ?? []).some((a) => a.verification_status === "VERIFIED");
  const snapSig = (snapshot?.signatures ?? []).some((s) => s.status === "SIGNED");
  const allowGovId = showGovernmentId ?? (!isV2 && snapKyc);
  const badge =
    (typeof cert.verification_badge === "string" && cert.verification_badge) ||
    (isV2 ? V2_BADGES[accountType] : null);

  return (
    <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl shadow-black/50 overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-blue-500/10 pointer-events-none" />
      <CardContent className="p-8 sm:p-12 relative z-10">
        <div className="flex flex-col items-center text-center space-y-6">
          <div className="size-24 bg-emerald-500/20 rounded-full flex items-center justify-center border-4 border-emerald-500/30 shadow-[0_0_40px_rgba(52,211,153,0.3)]">
            <ShieldCheck className="size-12 text-emerald-400" />
          </div>

          <div>
            <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">
              Eterna Verification Complete
            </h1>
            <p className="text-white/60 text-lg max-w-lg mx-auto">
              Your account is fully secured and authorized. You are now protected by Eterna AI.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-3xl text-left">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Status</div>
              <div className="text-emerald-400 font-semibold flex items-center gap-1">
                <CheckCircle2 className="size-4" /> ACTIVE
              </div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Score</div>
              <div className="text-white font-semibold">{cert.score}/100</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">
                Authorization ID
              </div>
              <div className="font-mono text-sm text-white/90 truncate">
                {authBundle.auth.auth_number}
              </div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">
                Certificate ID
              </div>
              <div className="font-mono text-sm text-white/90 truncate">
                {cert.certificate_number}
              </div>
            </div>
          </div>

          <div className="bg-black/20 border border-white/10 rounded-xl p-6 w-full max-w-3xl text-left space-y-3">
            <div className="text-sm font-semibold text-white/80 border-b border-white/10 pb-2 mb-3">
              Confirmed Protections
            </div>
            <div className="grid sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
              {badge && (
                <div className="flex items-center gap-3 sm:col-span-2">
                  <CheckCircle2 className="size-5 text-emerald-400" /> {badge}
                </div>
              )}
              {allowGovId && (
                <>
                  <div className="flex items-center gap-3">
                    <CheckCircle2
                      className={`size-5 ${snapKyc ? "text-emerald-400" : "text-white/30"}`}
                    />{" "}
                    Identity Verified
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2
                      className={`size-5 ${snapKyc ? "text-emerald-400" : "text-white/30"}`}
                    />{" "}
                    Government ID Verified
                  </div>
                </>
              )}
              {(!isV2 || accountType === "individual" || accountType === "celebrity") && (
                <>
                  <div className="flex items-center gap-3">
                    <CheckCircle2
                      className={`size-5 ${snapFace ? "text-emerald-400" : "text-white/30"}`}
                    />{" "}
                    Real Human Verified
                  </div>
                  <div className="flex items-center gap-3">
                    <CheckCircle2
                      className={`size-5 ${snapFace ? "text-emerald-400" : "text-white/30"}`}
                    />{" "}
                    Protected Face Profile Created
                  </div>
                </>
              )}
              <div className="flex items-center gap-3">
                <CheckCircle2
                  className={`size-5 ${snapAsset ? "text-emerald-400" : "text-white/30"}`}
                />{" "}
                Asset Ownership Verified
              </div>
              <div className="flex items-center gap-3">
                <CheckCircle2
                  className={`size-5 ${snapSig ? "text-emerald-400" : "text-white/30"}`}
                />{" "}
                Authorization Signed
              </div>
              <div className="flex items-center gap-3 sm:col-span-2">
                <CheckCircle2 className="size-5 text-emerald-400" /> Verification Certificate Issued
              </div>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-3 w-full max-w-3xl pt-4 border-t border-white/10">
            <Button
              onClick={async () => {
                try {
                  if (isV2) await completeV2();
                  else await completeV1();
                  navigate({ to: "/" });
                } catch (e: unknown) {
                  toast.error(e instanceof Error ? e.message : "Failed to complete onboarding");
                }
              }}
              className="bg-blue-600 hover:bg-blue-500 text-white"
            >
              <LayoutDashboard className="size-4 mr-2" /> Open Dashboard
            </Button>
            <Button
              variant="outline"
              onClick={handleDownloadCert}
              disabled={busy !== null || !filesReady}
              title={filesReady ? undefined : "Available once your documents are finalized"}
              className="bg-slate-950/60 border-sky-500/30 text-sky-100 hover:bg-sky-950/40 hover:text-white"
            >
              {busy === "cert" ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <FileKey2 className="size-4 mr-2" />
              )}{" "}
              Download Certificate
            </Button>
            <Button
              variant="outline"
              onClick={handleDownloadBundle}
              disabled={busy !== null || !filesReady}
              title={filesReady ? undefined : "Available once your documents are finalized"}
              className="bg-slate-950/60 border-sky-500/30 text-sky-100 hover:bg-sky-950/40 hover:text-white"
            >
              {busy === "bundle" ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <Download className="size-4 mr-2" />
              )}{" "}
              Download Complete Bundle
            </Button>

            <Button
              variant="outline"
              onClick={() => window.open(`/verify/${cert.public_slug}`, "_blank")}
              className="bg-slate-950/60 border-sky-500/30 text-sky-100 hover:bg-sky-950/40 hover:text-white"
            >
              <ShieldCheck className="size-4 mr-2" /> Public Registry
            </Button>
            <Link to="/assets">
              <Button variant="outline" className="bg-slate-950/60 border-sky-500/30 text-sky-100 hover:bg-sky-950/40 hover:text-white">
                <Settings className="size-4 mr-2" /> Manage Assets
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, ShieldCheck, Download, ExternalLink, FileKey2, Settings, LayoutDashboard, CheckCircle2 } from "lucide-react";
import { getMyCertificate, getCertificateSignedUrl } from "@/lib/onboarding/certificate.functions";
import { getAuthorizationBundle } from "@/lib/onboarding/authorization.functions";
import { buildAuthorizationPackage } from "@/lib/onboarding/package.functions";
import { completeOnboarding } from "@/lib/onboarding/progress.functions";
import { useState } from "react";
import { toast } from "sonner";

export function OnboardingCompleteStep({ onGoToStep }: { onGoToStep: (step: number) => void }) {
  const fetchCert = useServerFn(getMyCertificate);
  const fetchAuth = useServerFn(getAuthorizationBundle);
  const getCertUrl = useServerFn(getCertificateSignedUrl);
  const buildPkg = useServerFn(buildAuthorizationPackage);
  const complete = useServerFn(completeOnboarding);
  const navigate = useNavigate();

  const { data: cert, isLoading: certLoading } = useQuery({
    queryKey: ["my_certificate"],
    queryFn: () => fetchCert(),
  });

  const { data: authBundle, isLoading: authLoading } = useQuery({
    queryKey: ["auth_bundle"],
    queryFn: () => fetchAuth(),
  });

  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);
  const [loadingPkg, setLoadingPkg] = useState(false);

  const handleDownloadCert = async () => {
    if (!cert?.id) return;
    setLoadingUrl(cert.id);
    try {
      const { url } = await getCertUrl({ data: { certificate_id: cert.id } });
      window.open(url, "_blank");
    } catch (e: any) {
      toast.error("Failed to load certificate");
    } finally {
      setLoadingUrl(null);
    }
  };

  const handleDownloadPackage = async () => {
    setLoadingPkg(true);
    try {
      const { url } = await buildPkg();
      const a = document.createElement("a");
      a.href = url;
      a.download = `Eterna_Authorization_Package.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e: any) {
      toast.error("Failed to generate authorization package");
    } finally {
      setLoadingPkg(false);
    }
  };

  if (certLoading || authLoading) {
    return (
      <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl">
        <CardContent className="py-12 flex justify-center"><Loader2 className="size-6 animate-spin text-blue-500" /></CardContent>
      </Card>
    );
  }

  if (!cert || cert.status !== "ACTIVE" || authBundle?.auth?.status !== "ACTIVE") {
    return (
      <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl">
        <CardContent className="py-12 text-center">
          <div className="text-red-400 mb-2">Onboarding is not yet complete.</div>
          <Button variant="outline" onClick={() => onGoToStep(1)} className="border-white/20 text-white">Return to Start</Button>
        </CardContent>
      </Card>
    );
  }

  const snapshot = cert.snapshot as any;
  const snapKyc = snapshot?.kyc?.verification_status === "APPROVED";
  const snapFace = snapshot?.face?.status === "FACE_VERIFIED";
  const snapAsset = (snapshot?.assets ?? []).some((a: any) => a.verification_status === "VERIFIED");
  const snapSig = (snapshot?.signatures ?? []).some((s: any) => s.status === "SIGNED");

  return (
    <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl shadow-black/50 overflow-hidden relative">
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-blue-500/10 pointer-events-none" />
      <CardContent className="p-8 sm:p-12 relative z-10">
        
        <div className="flex flex-col items-center text-center space-y-6">
          <div className="size-24 bg-emerald-500/20 rounded-full flex items-center justify-center border-4 border-emerald-500/30 shadow-[0_0_40px_rgba(52,211,153,0.3)]">
            <ShieldCheck className="size-12 text-emerald-400" />
          </div>
          
          <div>
            <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Eterna Verification Complete</h1>
            <p className="text-white/60 text-lg max-w-lg mx-auto">
              Your account is fully secured and authorized. You are now protected by Eterna AI.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-3xl text-left">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Status</div>
              <div className="text-emerald-400 font-semibold flex items-center gap-1"><CheckCircle2 className="size-4" /> ACTIVE</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Score</div>
              <div className="text-white font-semibold">{cert.score}/100</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Authorization ID</div>
              <div className="font-mono text-sm text-white/90 truncate">{authBundle.auth.auth_number}</div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Certificate ID</div>
              <div className="font-mono text-sm text-white/90 truncate">{cert.certificate_number}</div>
            </div>
          </div>

          <div className="bg-black/20 border border-white/10 rounded-xl p-6 w-full max-w-3xl text-left space-y-3">
            <div className="text-sm font-semibold text-white/80 border-b border-white/10 pb-2 mb-3">Confirmed Protections</div>
            <div className="grid sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
              <div className="flex items-center gap-3"><CheckCircle2 className={`size-5 ${snapKyc ? 'text-emerald-400' : 'text-white/30'}`} /> Identity Verified</div>
              <div className="flex items-center gap-3"><CheckCircle2 className={`size-5 ${snapFace ? 'text-emerald-400' : 'text-white/30'}`} /> Real Human Verified</div>
              <div className="flex items-center gap-3"><CheckCircle2 className="size-5 text-emerald-400" /> Protected Face Profile Created</div>
              <div className="flex items-center gap-3"><CheckCircle2 className={`size-5 ${snapAsset ? 'text-emerald-400' : 'text-white/30'}`} /> YouTube Ownership Verified</div>
              <div className="flex items-center gap-3"><CheckCircle2 className={`size-5 ${snapSig ? 'text-emerald-400' : 'text-white/30'}`} /> Authorization Signed</div>
              <div className="flex items-center gap-3"><CheckCircle2 className="size-5 text-emerald-400" /> Admin Approved</div>
              <div className="flex items-center gap-3 sm:col-span-2"><CheckCircle2 className="size-5 text-emerald-400" /> Verification Certificate Issued</div>
            </div>
          </div>

          <div className="flex flex-wrap justify-center gap-3 w-full max-w-3xl pt-4 border-t border-white/10">
            <Button onClick={async () => {
              try {
                await complete();
                navigate({ to: "/" });
              } catch (e: any) {
                toast.error(e?.message ?? "Failed to complete onboarding");
              }
            }} className="bg-blue-600 hover:bg-blue-500 text-white">
              <LayoutDashboard className="size-4 mr-2" /> Open Dashboard
            </Button>
            <Button variant="outline" onClick={handleDownloadCert} disabled={loadingUrl === cert.id} className="border-white/20 text-white hover:bg-white/10">
              {loadingUrl === cert.id ? <Loader2 className="size-4 animate-spin mr-2" /> : <ExternalLink className="size-4 mr-2" />} View Certificate
            </Button>
            <Button variant="outline" onClick={handleDownloadPackage} disabled={loadingPkg} className="border-white/20 text-white hover:bg-white/10">
              {loadingPkg ? <Loader2 className="size-4 animate-spin mr-2" /> : <Download className="size-4 mr-2" />} Download Package
            </Button>
            <Button variant="outline" onClick={() => window.open(`/verify/${cert.public_slug}`, "_blank")} className="border-white/20 text-white hover:bg-white/10">
              <ShieldCheck className="size-4 mr-2" /> Public Registry
            </Button>
            <Link to="/assets">
              <Button variant="outline" className="border-white/20 text-white hover:bg-white/10">
                <Settings className="size-4 mr-2" /> Manage Assets
              </Button>
            </Link>
          </div>

        </div>
      </CardContent>
    </Card>
  );
}

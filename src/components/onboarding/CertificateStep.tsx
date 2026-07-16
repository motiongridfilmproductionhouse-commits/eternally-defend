import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, ChevronRight, ChevronLeft, Download, ExternalLink, ShieldCheck, FileKey2, RefreshCw, AlertCircle, AlertTriangle } from "lucide-react";
import { getMyCertificate, getCertificateSignedUrl } from "@/lib/onboarding/certificate.functions";
import { getAuthorizationBundle } from "@/lib/onboarding/authorization.functions";
import { buildAuthorizationPackage } from "@/lib/onboarding/package.functions";

export function CertificateStep({
  onBack,
  onNext,
  kycStatus,
  faceStatus,
  assetStatus,
}: {
  onBack: () => void;
  onNext: () => void;
  kycStatus: string;
  faceStatus: string;
  assetStatus: string;
}) {
  const fetchCert = useServerFn(getMyCertificate);
  const fetchAuth = useServerFn(getAuthorizationBundle);
  const getCertUrl = useServerFn(getCertificateSignedUrl);
  const buildPkg = useServerFn(buildAuthorizationPackage);

  const { data: cert, refetch: refetchCert, isLoading: certLoading } = useQuery({
    queryKey: ["my_certificate"],
    queryFn: () => fetchCert(),
  });

  const { data: authBundle, isLoading: authLoading } = useQuery({
    queryKey: ["auth_bundle"],
    queryFn: () => fetchAuth(),
  });

  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);
  const [loadingPkg, setLoadingPkg] = useState(false);

  useEffect(() => {
    if (cert?.public_slug) {
      const publicBase = "https://eternally-defend.lovable.app"; // Fallback, could use window.location.origin
      const url = `${window.location.origin}/verify/${cert.public_slug}`;
      QRCode.toDataURL(url, { color: { dark: "#0A1128", light: "#FFFFFF" } })
        .then(setQrUrl)
        .catch(() => {});
    }
  }, [cert?.public_slug]);

  const handleDownloadCert = async (viewOnly = false) => {
    if (!cert?.id) return;
    setLoadingUrl(cert.id);
    try {
      const { url } = await getCertUrl({ data: { certificate_id: cert.id } });
      if (viewOnly) {
        window.open(url, "_blank");
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `Eterna_Certificate_${cert.certificate_number}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
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

  if (!cert) {
    return (
      <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl">
        <CardContent className="py-12 text-center text-white/50">Certificate not found.</CardContent>
      </Card>
    );
  }

  const auth = authBundle?.auth;
  const isExpired = cert.expires_at ? new Date(cert.expires_at) < new Date() : false;
  const isSuspended = cert.status === "SUSPENDED" || auth?.status === "SUSPENDED";
  const isRevoked = cert.status === "REVOKED" || auth?.status === "REVOKED";
  const isActive = cert.status === "ACTIVE" && auth?.status === "ACTIVE" && !isExpired;

  const getStatusColor = () => {
    if (isRevoked) return "text-red-400 bg-red-500/10 border-red-500/20";
    if (isSuspended) return "text-orange-400 bg-orange-500/10 border-orange-500/20";
    if (isExpired) return "text-yellow-400 bg-yellow-500/10 border-yellow-500/20";
    return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  };

  const getStatusLabel = () => {
    if (isRevoked) return "REVOKED";
    if (isSuspended) return "SUSPENDED";
    if (isExpired) return "EXPIRED";
    return "ACTIVE";
  };

  const snapshot = cert.snapshot as any;
  const snapKyc = snapshot?.kyc?.verification_status === "APPROVED";
  const snapFace = snapshot?.face?.status === "FACE_VERIFIED";
  const snapAsset = (snapshot?.assets ?? []).some((a: any) => a.verification_status === "VERIFIED");
  const snapSig = (snapshot?.signatures ?? []).some((s: any) => s.status === "SIGNED");

  return (
    <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl shadow-black/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl">Verification Certificate</CardTitle>
            <CardDescription className="text-white/60">
              Your official Eterna Verification Certificate.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchCert()} className="border-white/20 text-white hover:bg-white/10">
            <RefreshCw className="size-4 mr-2" /> Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">

        <div className={`p-4 border rounded-xl flex items-center justify-between ${getStatusColor()}`}>
          <div className="flex items-center gap-3">
            {isActive ? <ShieldCheck className="size-6" /> : isRevoked || isExpired ? <AlertCircle className="size-6" /> : <AlertTriangle className="size-6" />}
            <div>
              <div className="font-semibold">{getStatusLabel()}</div>
              <div className="text-xs opacity-70">
                {isActive ? "Your certificate is valid and active." : "This certificate is no longer valid."}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{cert.score}/100</div>
            <div className="text-[10px] uppercase tracking-wider opacity-70">Verification Score</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Certificate Number</div>
                <div className="font-mono text-sm text-white">{cert.certificate_number}</div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Authorization ID</div>
                <div className="font-mono text-sm text-white">{auth?.auth_number}</div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Issued Date</div>
                <div className="text-sm text-white">{cert.issued_at ? new Date(cert.issued_at).toLocaleDateString() : '-'}</div>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Expiry Date</div>
                <div className="text-sm text-white">{cert.expires_at ? new Date(cert.expires_at).toLocaleDateString() : '-'}</div>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2 text-sm">
              <div className="text-[10px] text-white/40 uppercase tracking-wider mb-2">Verified Claims</div>
              <div className="flex items-center gap-2"><ShieldCheck className={`size-4 ${snapKyc ? 'text-emerald-400' : 'text-white/30'}`} /> Identity Verified</div>
              <div className="flex items-center gap-2"><ShieldCheck className={`size-4 ${snapFace ? 'text-emerald-400' : 'text-white/30'}`} /> Real Human Verified</div>
              <div className="flex items-center gap-2"><ShieldCheck className={`size-4 text-emerald-400`} /> Face Protected Profile Created</div>
              <div className="flex items-center gap-2"><ShieldCheck className={`size-4 ${snapAsset ? 'text-emerald-400' : 'text-white/30'}`} /> YouTube Ownership Verified</div>
              <div className="flex items-center gap-2"><ShieldCheck className={`size-4 ${snapSig ? 'text-emerald-400' : 'text-white/30'}`} /> Authorization Signed</div>
              <div className="flex items-center gap-2"><ShieldCheck className={`size-4 text-emerald-400`} /> Admin Approved</div>
            </div>
          </div>
          
          <div className="bg-white/10 border border-white/20 rounded-xl p-4 flex flex-col items-center justify-center space-y-3">
            <div className="text-[10px] text-white/50 uppercase tracking-wider">Public Verification</div>
            <div className="bg-white p-2 rounded-lg">
              {qrUrl ? <img src={qrUrl} alt="QR Code" className="size-32" /> : <div className="size-32 bg-white/20 animate-pulse rounded" />}
            </div>
            <div className="text-[10px] text-center text-white/60 px-2 leading-tight">
              Scan to verify this certificate on the Eterna AI Registry
            </div>
            <Button size="sm" variant="link" className="text-blue-400 p-0 h-auto" onClick={() => window.open(`/verify/${cert.public_slug}`, "_blank")}>
              Open public page <ExternalLink className="size-3 ml-1" />
            </Button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Button variant="outline" onClick={() => handleDownloadCert()} disabled={loadingUrl === cert.id} className="border-white/20 text-white hover:bg-white/10 flex-1">
            {loadingUrl === cert.id ? <Loader2 className="size-4 animate-spin mr-2" /> : <Download className="size-4 mr-2" />}
            Download Certificate
          </Button>
          <Button variant="outline" onClick={() => handleDownloadPackage()} disabled={loadingPkg} className="border-white/20 text-white hover:bg-white/10 flex-1">
            {loadingPkg ? <Loader2 className="size-4 animate-spin mr-2" /> : <FileKey2 className="size-4 mr-2" />}
            Download Full Package
          </Button>
        </div>

        <div className="flex justify-between pt-4 border-t border-white/10">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
            <ChevronLeft className="size-4 mr-1" /> Back
          </Button>
          <div className="flex items-center gap-3">
            <Button onClick={onNext} disabled={!isActive} className="bg-blue-600 hover:bg-blue-500 text-white border-0">
              Finish Onboarding <ChevronRight className="size-4 ml-1" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

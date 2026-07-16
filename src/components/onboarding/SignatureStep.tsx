import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import SignatureCanvas from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, ChevronRight, ChevronLeft, PenTool, CheckCircle2, FileKey2, ShieldCheck, Download, ExternalLink } from "lucide-react";
import { requestSignatureOtp, finalizeSignature, getAuthorizationBundle, getSignedDocUrl } from "@/lib/onboarding/authorization.functions";
import { getClientProfile } from "@/lib/onboarding/profile.functions";

const DECLARATIONS = [
  { key: "reviewed", label: "I reviewed the complete Authorization Letter." },
  { key: "owner", label: "I own or represent the listed rights." },
  { key: "assets_mine", label: "The listed assets belong to me or my organization." },
  { key: "accurate", label: "The supplied information is accurate." },
  { key: "false_claims", label: "False complaints may create legal liability." },
  { key: "scope_only", label: "Eterna is authorized only within selected scopes." },
  { key: "final_approval", label: "Final submissions may require separate approval." },
] as const;

export function SignatureStep({
  onBack,
  onNext
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  const fetchAuth = useServerFn(getAuthorizationBundle);
  const fetchProfile = useServerFn(getClientProfile);
  const reqOtp = useServerFn(requestSignatureOtp);
  const signDoc = useServerFn(finalizeSignature);
  const fetchUrl = useServerFn(getSignedDocUrl);

  const { data: authBundle, refetch, isLoading } = useQuery({
    queryKey: ["auth_bundle"],
    queryFn: () => fetchAuth(),
  });

  const { data: profile } = useQuery({
    queryKey: ["client_profile"],
    queryFn: () => fetchProfile(),
  });

  const sigCanvas = useRef<any>(null);
  const [typedName, setTypedName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [confirmations, setConfirmations] = useState<Record<string, boolean>>({});
  
  const [otpSent, setOtpSent] = useState(false);
  const [otpTimer, setOtpTimer] = useState(0);
  const [otpDevHint, setOtpDevHint] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  
  const [busy, setBusy] = useState(false);
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);

  useEffect(() => {
    if (profile && !typedName) {
      setTypedName(profile.full_name || profile.display_name || "");
      setRoleTitle(profile.role_title || "");
    }
  }, [profile]);

  useEffect(() => {
    let t: any;
    if (otpTimer > 0) t = setTimeout(() => setOtpTimer(otpTimer - 1), 1000);
    return () => clearTimeout(t);
  }, [otpTimer]);

  const allConfirmed = DECLARATIONS.every(d => confirmations[d.key]);

  const handleClearSig = () => sigCanvas.current?.clear();

  const handleRequestOtp = async () => {
    if (!allConfirmed) return toast.error("Confirm all declarations first.");
    if (!typedName.trim()) return toast.error("Enter your legal name.");
    if (sigCanvas.current?.isEmpty()) return toast.error("Please provide a signature.");

    setBusy(true);
    try {
      const res = await reqOtp();
      setOtpSent(true);
      setOtpTimer(60);
      setOtpDevHint(res.dev_hint);
      toast.success("OTP requested successfully.");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to request OTP");
    } finally {
      setBusy(false);
    }
  };

  const handleSign = async () => {
    if (otpCode.length !== 6) return toast.error("Enter the 6-digit OTP");
    if (sigCanvas.current?.isEmpty()) return toast.error("Signature cannot be empty");

    setBusy(true);
    try {
      const svg = sigCanvas.current.toDataURL("image/png");
      await signDoc({
        data: {
          otp: otpCode,
          typed_name: typedName,
          role_title: roleTitle || undefined,
          drawn_signature_svg: svg,
          confirmations,
        }
      });
      toast.success("Document Signed successfully!");
      await refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Signature failed. Check OTP.");
    } finally {
      setBusy(false);
    }
  };

  const handleViewPdf = async (docId: string, download: boolean = false) => {
    setLoadingUrl(docId);
    try {
      const { url } = await fetchUrl({ data: { doc_id: docId } });
      if (download) {
        const a = document.createElement("a");
        a.href = url;
        a.download = "Eterna_Authorization_Signed.pdf";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        window.open(url, "_blank");
      }
    } catch (e: any) {
      toast.error("Failed to load PDF URL");
    } finally {
      setLoadingUrl(null);
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl">
        <CardContent className="py-12 flex justify-center"><Loader2 className="size-6 animate-spin text-blue-500" /></CardContent>
      </Card>
    );
  }

  const auth = authBundle?.auth;
  const isSigned = auth?.status === "ACTIVE";
  const signedDoc = authBundle?.documents?.find((d: any) => d.kind === "signed" && d.version === auth?.version);
  const signatureRec = authBundle?.signatures?.find((s: any) => s.status === "SIGNED" && s.version === auth?.version);

  if (isSigned && signedDoc && signatureRec) {
    return (
      <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl shadow-black/50">
        <CardContent className="p-8 space-y-6">
          <div className="flex flex-col items-center justify-center text-center space-y-4 pt-4">
            <div className="size-16 bg-emerald-500/20 rounded-full flex items-center justify-center border border-emerald-500/30">
              <ShieldCheck className="size-8 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-emerald-400">Authorization Signed</h2>
              <p className="text-white/60 mt-1">Your authorization document is sealed and legally binding.</p>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm space-y-3">
            <div className="flex justify-between border-b border-white/10 pb-2">
              <span className="text-white/50">Authorization ID</span>
              <span className="font-mono text-white">{auth.auth_number}</span>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-2">
              <span className="text-white/50">Document Version</span>
              <span className="text-white">v{auth.version}</span>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-2">
              <span className="text-white/50">Signed Date</span>
              <span className="text-white">{signatureRec.signed_at ? new Date(signatureRec.signed_at).toLocaleString() : "Unknown"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">Document Hash</span>
              <span className="font-mono text-xs text-white/80 max-w-[200px] truncate" title={signedDoc.sha256 ?? undefined}>{signedDoc.sha256}</span>
            </div>
          </div>

          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={() => handleViewPdf(signedDoc.id, true)} disabled={loadingUrl === signedDoc.id} className="border-white/20 text-white hover:bg-white/10">
              {loadingUrl === signedDoc.id ? <Loader2 className="size-4 animate-spin mr-2" /> : <Download className="size-4 mr-2" />}
              Download
            </Button>
            <Button onClick={() => handleViewPdf(signedDoc.id, false)} disabled={loadingUrl === signedDoc.id} className="bg-white/10 hover:bg-white/20 text-white border border-white/10">
              {loadingUrl === signedDoc.id ? <Loader2 className="size-4 animate-spin mr-2" /> : <ExternalLink className="size-4 mr-2" />}
              View PDF
            </Button>
          </div>

          <div className="flex justify-between pt-4 mt-6 border-t border-white/10">
            <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
              <ChevronLeft className="size-4 mr-1" /> Back
            </Button>
            <Button onClick={onNext} className="bg-emerald-600 hover:bg-emerald-500 text-white border-0">
              Continue <ChevronRight className="size-4 ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl shadow-black/50">
      <CardHeader>
        <CardTitle className="text-xl">Electronic Signature & OTP</CardTitle>
        <CardDescription className="text-white/60">
          Sign the authorization letter to grant Eterna AI legal permission to act on your behalf.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        
        <div className="space-y-2">
          <div className="text-sm font-semibold text-white/80 uppercase tracking-wider">Required Declarations</div>
          <div className="space-y-2 bg-white/5 border border-white/10 p-3 rounded-lg">
            {DECLARATIONS.map(d => (
              <label key={d.key} className="flex gap-3 items-start cursor-pointer hover:bg-white/5 p-1.5 rounded transition-colors">
                <Checkbox 
                  checked={confirmations[d.key] || false}
                  onCheckedChange={(c) => setConfirmations(p => ({ ...p, [d.key]: !!c }))}
                  className="mt-0.5 border-white/30 data-[state=checked]:bg-blue-500 data-[state=checked]:text-white"
                  disabled={busy}
                />
                <span className="text-sm text-white/90">{d.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-white/50 uppercase tracking-wider">Full Legal Name</label>
            <Input 
              value={typedName} 
              onChange={e => setTypedName(e.target.value)} 
              className="bg-[#0F172A] border-white/10 text-white" 
              placeholder="e.g. John Doe"
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-white/50 uppercase tracking-wider">Role / Designation (Optional)</label>
            <Input 
              value={roleTitle} 
              onChange={e => setRoleTitle(e.target.value)} 
              className="bg-[#0F172A] border-white/10 text-white" 
              placeholder="e.g. Creator, CEO"
              disabled={busy}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-white/50 uppercase tracking-wider flex justify-between">
            <span>Draw Signature</span>
            <button onClick={handleClearSig} disabled={busy} className="text-blue-400 hover:text-blue-300 text-[10px]">Clear</button>
          </label>
          <div className="bg-white rounded-lg border-2 border-white/20 overflow-hidden relative" style={{ height: "150px" }}>
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-10">
              <PenTool className="size-16 text-black" />
            </div>
            <SignatureCanvas 
              ref={sigCanvas} 
              penColor="black" 
              canvasProps={{ className: "w-full h-full cursor-crosshair", style: { width: '100%', height: '100%' } }} 
            />
          </div>
        </div>

        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 space-y-4">
          <div className="flex items-start gap-3">
            <FileKey2 className="size-5 text-blue-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-blue-300">OTP Security Verification</div>
              <div className="text-xs text-blue-200/70 mt-0.5">We will send a 6-digit code to your verified email address to confirm this signature.</div>
            </div>
          </div>
          
          {!otpSent ? (
            <Button onClick={handleRequestOtp} disabled={!allConfirmed || !typedName || busy} className="w-full bg-blue-600 hover:bg-blue-500 text-white">
              {busy ? <Loader2 className="size-4 animate-spin mr-2" /> : null} Request Email OTP
            </Button>
          ) : (
            <div className="space-y-3 pt-2">
              <div className="flex gap-2">
                <Input 
                  value={otpCode} 
                  onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000" 
                  className="bg-[#0F172A] border-white/10 text-white font-mono text-center text-lg tracking-widest flex-1"
                  disabled={busy}
                  maxLength={6}
                />
                <Button onClick={handleSign} disabled={otpCode.length !== 6 || busy} className="bg-emerald-600 hover:bg-emerald-500 text-white shrink-0 w-32">
                  {busy ? <Loader2 className="size-4 animate-spin mr-2" /> : <ShieldCheck className="size-4 mr-2" />} Sign
                </Button>
              </div>
              <div className="flex items-center justify-between text-xs">
                {otpDevHint && <div className="text-emerald-400">DEV MODE OTP: {otpDevHint}</div>}
                <Button variant="link" onClick={handleRequestOtp} disabled={otpTimer > 0 || busy} className="h-auto p-0 text-blue-400 text-xs ml-auto">
                  {otpTimer > 0 ? `Resend in ${otpTimer}s` : "Resend OTP"}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between pt-4 border-t border-white/10">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10" disabled={busy}>
            <ChevronLeft className="size-4 mr-1" /> Back
          </Button>
          <div className="text-xs text-white/30 mt-2">
            The document will be securely hashed and sealed.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

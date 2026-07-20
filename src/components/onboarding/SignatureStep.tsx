import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import SignatureCanvas from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, ChevronRight, ChevronLeft, PenTool, ShieldCheck, Download, ExternalLink } from "lucide-react";
import { finalizeSignature, getAuthorizationBundle, getSignedDocUrl } from "@/lib/onboarding/authorization.functions";
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
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  const qc = useQueryClient();
  const fetchAuth = useServerFn(getAuthorizationBundle);
  const fetchProfile = useServerFn(getClientProfile);
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
  const [hasStrokes, setHasStrokes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);

  useEffect(() => {
    if (profile && !typedName) {
      setTypedName((profile as any).legal_name || profile.full_name || profile.display_name || "");
      setRoleTitle(profile.role_title || "");
    }
  }, [profile]);

  const allConfirmed = DECLARATIONS.every((d) => confirmations[d.key]);
  const nameOk = typedName.trim().length >= 2;
  const canSign = allConfirmed && nameOk && hasStrokes && !busy;

  const missingReason = !allConfirmed
    ? "Please check all declarations above."
    : !nameOk
    ? "Enter your full legal name."
    : !hasStrokes
    ? "Draw your signature in the box."
    : null;

  const handleClearSig = () => {
    sigCanvas.current?.clear();
    setHasStrokes(false);
  };

  const handleSign = async () => {
    setSignError(null);
    if (busy) return;
    if (missingReason) {
      toast.error(missingReason);
      return;
    }
    if (sigCanvas.current?.isEmpty?.()) {
      toast.error("Signature cannot be empty");
      return;
    }

    setBusy(true);
    try {
      const svg = sigCanvas.current.toDataURL("image/png");
      const res = await signDoc({
        data: {
          typed_name: typedName.trim(),
          role_title: roleTitle.trim() || undefined,
          drawn_signature_svg: svg,
          confirmations,
        },
      });
      if (res?.duplicate) {
        toast.success("Authorization already signed — restoring your certificate.");
      } else {
        toast.success("Authorization signed and certificate issued.");
      }
      await Promise.all([
        refetch(),
        qc.invalidateQueries({ queryKey: ["my_certificate"] }),
        qc.invalidateQueries({ queryKey: ["onboarding-progress"] }),
        qc.invalidateQueries({ queryKey: ["auth_bundle"] }),
        qc.invalidateQueries({ queryKey: ["client_profile"] }),
      ]);
      onNext();
    } catch (e: any) {
      const msg = e?.message ?? "Signature failed. Please try again.";
      console.error("[SignatureStep] finalizeSignature failed", e);
      setSignError(msg);
      toast.error(msg);
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
  const isSigned = auth?.status === "ACTIVE" || auth?.status === "SIGNED" || auth?.status === "UNDER_ADMIN_REVIEW";
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
        <CardTitle className="text-xl">Electronic Signature</CardTitle>
        <CardDescription className="text-white/60">
          Sign the authorization letter to grant Eterna AI legal permission to act on your behalf. Your signature is securely hashed and sealed alongside the document.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        <div className="space-y-2">
          <div className="text-sm font-semibold text-white/80 uppercase tracking-wider">Required Declarations</div>
          <div className="space-y-2 bg-white/5 border border-white/10 p-3 rounded-lg">
            {DECLARATIONS.map((d) => (
              <label key={d.key} className="flex gap-3 items-start cursor-pointer hover:bg-white/5 p-1.5 rounded transition-colors">
                <Checkbox
                  checked={confirmations[d.key] || false}
                  onCheckedChange={(c) => setConfirmations((p) => ({ ...p, [d.key]: !!c }))}
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
              onChange={(e) => setTypedName(e.target.value)}
              className="bg-[#0F172A] border-white/10 text-white"
              placeholder="e.g. John Doe"
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-white/50 uppercase tracking-wider">Role / Designation (Optional)</label>
            <Input
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
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
              onEnd={() => setHasStrokes(!(sigCanvas.current?.isEmpty()))}
              canvasProps={{ className: "w-full h-full cursor-crosshair", style: { width: "100%", height: "100%" } }}
            />
          </div>
          <div className="text-[10px] text-white/40 pt-1">
            Your signature will be hashed (SHA-256) and stored alongside your identity, IP, and user-agent for audit purposes.
          </div>
        </div>

        {signError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            <div className="font-semibold mb-0.5">We couldn't finalize your signature</div>
            <div className="opacity-80">{signError}</div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row justify-between pt-4 border-t border-white/10 gap-3">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10" disabled={busy}>
            <ChevronLeft className="size-4 mr-1" /> Back
          </Button>
          <div className="flex flex-col items-end gap-1">
            <Button
              onClick={handleSign}
              disabled={busy}
              aria-disabled={!canSign}
              className="bg-emerald-600 hover:bg-emerald-500 text-white border-0 disabled:opacity-70"
            >
              {busy ? <Loader2 className="size-4 animate-spin mr-2" /> : <ShieldCheck className="size-4 mr-2" />}
              Sign &amp; Complete Onboarding
            </Button>
            {missingReason && !busy && (
              <div className="text-[10px] text-amber-300/80">{missingReason}</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

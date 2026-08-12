import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Loader2,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
  Download,
  ExternalLink,
  BadgeCheck,
} from "lucide-react";
import {
  finalizeSignature,
  getAuthorizationBundle,
  getSignedDocUrl,
} from "@/lib/onboarding/authorization.functions";
import { getClientProfile } from "@/lib/onboarding/profile.functions";

export function SignatureStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const qc = useQueryClient();
  const fetchAuth = useServerFn(getAuthorizationBundle);
  const fetchProfile = useServerFn(getClientProfile);
  const signDoc = useServerFn(finalizeSignature);
  const fetchUrl = useServerFn(getSignedDocUrl);

  const {
    data: authBundle,
    refetch,
    isLoading,
  } = useQuery({
    queryKey: ["auth_bundle"],
    queryFn: () => fetchAuth(),
  });

  const { data: profile } = useQuery({
    queryKey: ["client_profile"],
    queryFn: () => fetchProfile(),
  });

  const [typedName, setTypedName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);

  const legalName = String(
    (profile as any)?.legal_name || (profile as any)?.full_name || "",
  ).trim();
  const displayName = String((profile as any)?.display_name || "").trim();

  useEffect(() => {
    if (profile) setTypedName((p) => p || legalName);
  }, [profile, legalName]);

  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const nameMatches =
    typedName.trim().length >= 2 &&
    (!legalName || normalize(typedName) === normalize(legalName));
  const canSign = accepted && nameMatches && !busy;

  const missingReason = !accepted
    ? "Please accept this authorization to continue."
    : typedName.trim().length < 2
      ? "Enter your full legal name."
      : !nameMatches
        ? `Typed name must exactly match your legal name on record${legalName ? ` (${legalName})` : ""}.`
        : null;

  const handleSign = async () => {
    setSignError(null);
    if (busy) return;
    if (missingReason) {
      toast.error(missingReason);
      return;
    }

    setBusy(true);
    try {
      const res = await signDoc({
        data: {
          typed_name: typedName.trim(),
          device: {
            platform: typeof navigator !== "undefined" ? navigator.platform : undefined,
            language: typeof navigator !== "undefined" ? navigator.language : undefined,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          confirmations: {
            reviewed: true,
            owner: true,
            assets_mine: true,
            accurate: true,
            false_claims: true,
            scope_only: true,
            final_approval: true,
          },
        },
      });

      if (res?.duplicate) {
        toast.success("Authorization already digitally signed.");
      } else {
        toast.success("Authorization digitally signed.");
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
      const raw = e?.message ?? "Signature failed. Please try again.";
      const msg = String(raw).startsWith("NAME_MISMATCH:")
        ? `Typed name must exactly match your legal name on record (${String(raw).split(":")[1]}).`
        : raw;
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
        <CardContent className="py-12 flex justify-center">
          <Loader2 className="size-6 animate-spin text-blue-500" />
        </CardContent>
      </Card>
    );
  }

  const auth = authBundle?.auth;
  const isSigned =
    auth?.status === "ACTIVE" || auth?.status === "SIGNED" || auth?.status === "UNDER_ADMIN_REVIEW";
  const signedDoc = authBundle?.documents?.find(
    (d: any) => d.kind === "signed" && d.version === auth?.version,
  );
  const signatureRec = authBundle?.signatures?.find(
    (s: any) => s.status === "SIGNED" && s.version === auth?.version,
  );

  if (isSigned && signedDoc && signatureRec) {
    return (
      <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl shadow-black/50">
        <CardContent className="p-8 space-y-6">
          <div className="flex flex-col items-center justify-center text-center space-y-4 pt-4">
            <div className="size-16 bg-emerald-500/20 rounded-full flex items-center justify-center border border-emerald-500/30">
              <BadgeCheck className="size-8 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-emerald-400">Digitally Signed</h2>
              <p className="text-white/60 mt-1">
                This authorization was executed electronically and is sealed for audit.
              </p>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm space-y-3">
            <div className="flex justify-between border-b border-white/10 pb-2">
              <span className="text-white/50">Signed By</span>
              <span className="text-white">{signatureRec.typed_name || legalName}</span>
            </div>
            {displayName && (
              <div className="flex justify-between border-b border-white/10 pb-2">
                <span className="text-white/50">Professional Name</span>
                <span className="text-white">{displayName}</span>
              </div>
            )}
            <div className="flex justify-between border-b border-white/10 pb-2">
              <span className="text-white/50">Authorization ID</span>
              <span className="font-mono text-white">{auth.auth_number}</span>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-2">
              <span className="text-white/50">Document Version</span>
              <span className="text-white">v{auth.version}</span>
            </div>
            <div className="flex justify-between border-b border-white/10 pb-2">
              <span className="text-white/50">Signed Timestamp</span>
              <span className="text-white">
                {signatureRec.signed_at
                  ? new Date(signatureRec.signed_at).toLocaleString()
                  : "Unknown"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/50">Document Hash</span>
              <span
                className="font-mono text-xs text-white/80 max-w-[200px] truncate"
                title={signedDoc.sha256 ?? undefined}
              >
                {signedDoc.sha256}
              </span>
            </div>
          </div>

          <div className="flex gap-3 justify-center">
            <Button
              variant="outline"
              onClick={() => handleViewPdf(signedDoc.id, true)}
              disabled={loadingUrl === signedDoc.id}
              className="bg-slate-950/60 border-sky-500/30 text-sky-100 hover:bg-sky-950/40 hover:text-white"
            >
              {loadingUrl === signedDoc.id ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <Download className="size-4 mr-2" />
              )}
              Download Signed PDF
            </Button>

            <Button
              onClick={() => handleViewPdf(signedDoc.id, false)}
              disabled={loadingUrl === signedDoc.id}
              className="bg-white/10 hover:bg-white/20 text-white border border-white/10"
            >
              {loadingUrl === signedDoc.id ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <ExternalLink className="size-4 mr-2" />
              )}
              View PDF
            </Button>
          </div>

          <div className="flex justify-between pt-4 mt-6 border-t border-white/10">
            <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
              <ChevronLeft className="size-4 mr-1" /> Back
            </Button>
            <Button
              onClick={onNext}
              className="bg-emerald-600 hover:bg-emerald-500 text-white border-0"
            >
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
        <CardTitle className="text-xl">Electronic Signature &amp; Authorization</CardTitle>
        <CardDescription className="text-white/60">
          Execute the Authorization Letter digitally. No printing, handwriting or scanning is
          required — your typed legal name, timestamp and document version are recorded as your
          digital signature.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <label className="flex gap-3 items-start cursor-pointer bg-white/5 border border-white/10 p-4 rounded-lg hover:bg-white/[0.07] transition-colors">
          <Checkbox
            checked={accepted}
            onCheckedChange={(c) => setAccepted(!!c)}
            className="mt-0.5 border-white/30 data-[state=checked]:bg-blue-500 data-[state=checked]:text-white"
            disabled={busy}
          />
          <span className="text-sm text-white/90">
            I have reviewed and accept this authorization.
          </span>
        </label>

        <div className="space-y-1.5">
          <label className="text-xs text-white/50 uppercase tracking-wider">Full Legal Name</label>
          <Input
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            className="bg-[#0F172A] border-white/10 text-white"
            placeholder={legalName || "Your full legal name"}
            disabled={busy}
          />
          <div className="text-[10px] text-white/40">
            Must match your legal name on record
            {legalName ? `: ${legalName}` : ""}.
          </div>
        </div>

        <div className="grid gap-2 rounded-lg border border-white/10 bg-white/5 p-4 text-xs text-white/60">
          <div className="flex justify-between">
            <span>Authorization ID</span>
            <span className="font-mono text-white/80">{auth?.auth_number ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span>Document Version</span>
            <span className="text-white/80">v{auth?.version ?? 1}</span>
          </div>
          <div className="flex justify-between">
            <span>Signature Method</span>
            <span className="text-white/80">Digital signature (typed name)</span>
          </div>
        </div>


        {signError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            <div className="font-semibold mb-0.5">We couldn't finalize your signature</div>
            <div className="opacity-80">{signError}</div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row justify-between pt-4 border-t border-white/10 gap-3">
          <Button
            variant="ghost"
            onClick={onBack}
            className="text-white hover:bg-white/10"
            disabled={busy}
          >
            <ChevronLeft className="size-4 mr-1" /> Back
          </Button>
          <div className="flex flex-col items-end gap-1">
            <Button
              onClick={handleSign}
              disabled={busy}
              aria-disabled={!canSign}
              className="bg-emerald-600 hover:bg-emerald-500 text-white border-0 disabled:opacity-70"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <ShieldCheck className="size-4 mr-2" />
              )}
              Sign &amp; Authorize
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

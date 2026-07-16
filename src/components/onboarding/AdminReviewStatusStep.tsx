import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, ChevronRight, ChevronLeft, RefreshCw, AlertCircle, FileText, ExternalLink, ShieldCheck, Download, AlertTriangle } from "lucide-react";
import { getAuthorizationBundle, getSignedDocUrl } from "@/lib/onboarding/authorization.functions";

export function AdminReviewStatusStep({
  onBack,
  onNext,
  onGoToStep,
  kycStatus,
  faceStatus,
  assetStatus,
}: {
  onBack: () => void;
  onNext: () => void;
  onGoToStep: (step: number) => void;
  kycStatus: string;
  faceStatus: string;
  assetStatus: string;
}) {
  const fetchAuth = useServerFn(getAuthorizationBundle);
  const fetchUrl = useServerFn(getSignedDocUrl);

  const { data: authBundle, refetch, isFetching, isLoading } = useQuery({
    queryKey: ["auth_bundle", "review_status"],
    queryFn: () => fetchAuth(),
    refetchInterval: (query) => {
      const status = query.state.data?.auth?.status;
      return status === "UNDER_ADMIN_REVIEW" ? 30000 : false;
    },
    refetchIntervalInBackground: false,
  });

  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);

  const handleViewPdf = async (docId: string, download: boolean = false) => {
    setLoadingUrl(docId);
    try {
      const { url } = await fetchUrl({ data: { doc_id: docId } });
      if (download) {
        const a = document.createElement("a");
        a.href = url;
        a.download = "Eterna_Authorization.pdf";
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
  if (!auth) {
    return (
      <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl">
        <CardContent className="py-12 text-center text-white/50">Status not found.</CardContent>
      </Card>
    );
  }

  const isPending = auth.status === "UNDER_ADMIN_REVIEW";
  const isApproved = auth.status === "ACTIVE";
  const isRejected = auth.status === "REJECTED";
  const isSuspended = auth.status === "SUSPENDED";
  const isRevoked = auth.status === "REVOKED";
  const isInfoRequired = auth.status === "AWAITING_SIGNATURE";

  const latestReview = authBundle?.reviews?.[0];
  const signedDoc = authBundle?.documents?.find((d: any) => d.kind === "signed" && d.version === auth.version) || 
                    authBundle?.documents?.find((d: any) => d.kind === "certificate" && d.version === auth.version);

  return (
    <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl shadow-black/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl">Admin Review Status</CardTitle>
            <CardDescription className="text-white/60">
              Track the progress of your Eterna AI authorization request.
            </CardDescription>
          </div>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} className="border-white/20 text-white hover:bg-white/10">
            <RefreshCw className={`size-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">

        {isPending && (
          <div className="flex flex-col items-center justify-center py-6 space-y-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
            <div className="size-16 rounded-full border border-blue-500/30 flex items-center justify-center">
              <Loader2 className="size-8 text-blue-400 animate-spin" />
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-blue-400">Admin Review Pending</div>
              <div className="text-sm text-blue-200 mt-1 max-w-sm">
                Your submission is awaiting review. We will update this page when a decision or additional request is available.
              </div>
            </div>
          </div>
        )}

        {isApproved && (
          <div className="flex flex-col items-center justify-center py-6 space-y-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
            <div className="size-16 rounded-full border border-emerald-500/30 bg-emerald-500/20 flex items-center justify-center">
              <ShieldCheck className="size-8 text-emerald-400" />
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-emerald-400">Authorization Approved</div>
              <div className="text-sm text-emerald-200 mt-1 max-w-sm">
                Your Eterna Verification Certificate has been issued and your account is active.
              </div>
            </div>
          </div>
        )}

        {isInfoRequired && (
          <div className="flex flex-col py-6 px-4 space-y-4 bg-orange-500/10 border border-orange-500/20 rounded-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-6 text-orange-400 mt-1" />
              <div>
                <div className="text-lg font-semibold text-orange-400">More Information Required</div>
                <div className="text-sm text-orange-200 mt-1">
                  Our team has requested more information or corrections before your authorization can be approved.
                </div>
                {latestReview?.notes && (
                  <div className="mt-3 p-3 bg-black/30 rounded border border-orange-500/30 text-sm text-white/90">
                    <strong className="text-orange-300">Admin Note:</strong> {latestReview.notes}
                  </div>
                )}
                <div className="mt-4 flex gap-3 flex-wrap">
                  <Button variant="outline" size="sm" onClick={() => onGoToStep(1)} className="border-orange-500/30 text-orange-200 hover:bg-orange-500/20">Edit Profile</Button>
                  <Button variant="outline" size="sm" onClick={() => onGoToStep(4)} className="border-orange-500/30 text-orange-200 hover:bg-orange-500/20">Edit Assets</Button>
                  <Button variant="outline" size="sm" onClick={() => onGoToStep(5)} className="border-orange-500/30 text-orange-200 hover:bg-orange-500/20">Edit Scopes</Button>
                  <Button variant="outline" size="sm" onClick={() => onGoToStep(6)} className="border-orange-500/30 text-orange-200 hover:bg-orange-500/20">Regenerate Draft</Button>
                </div>
                <p className="text-xs text-orange-300 mt-3">After making the requested changes, you must regenerate the draft and sign it again.</p>
              </div>
            </div>
          </div>
        )}

        {(isRejected || isSuspended || isRevoked) && (
          <div className="flex flex-col py-6 px-4 space-y-4 bg-red-500/10 border border-red-500/20 rounded-xl">
             <div className="flex items-start gap-3">
              <AlertCircle className="size-6 text-red-400 mt-1" />
              <div>
                <div className="text-lg font-semibold text-red-400 capitalize">{auth.status.toLowerCase()}</div>
                {latestReview?.notes && (
                  <div className="mt-3 p-3 bg-black/30 rounded border border-red-500/30 text-sm text-white/90">
                    <strong className="text-red-300">Reason:</strong> {latestReview.notes}
                  </div>
                )}
              </div>
             </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="text-xs text-white/40 uppercase tracking-wider mb-1">Submission Date</div>
            <div className="text-white text-sm">{new Date(auth.created_at).toLocaleString()}</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="text-xs text-white/40 uppercase tracking-wider mb-1">Last Update</div>
            <div className="text-white text-sm">{new Date(auth.updated_at).toLocaleString()}</div>
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
          <div className="text-xs text-white/40 uppercase tracking-wider mb-2">Checklist Status</div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-white/70">Identity Verification (Veriff)</span>
            <span className={kycStatus === 'APPROVED' ? 'text-emerald-400' : 'text-white/50'}>{kycStatus}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-white/70">Face Verification</span>
            <span className={faceStatus === 'FACE_VERIFIED' ? 'text-emerald-400' : 'text-white/50'}>{faceStatus}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-white/70">Asset Verification</span>
            <span className={assetStatus === 'VERIFIED' ? 'text-emerald-400' : 'text-white/50'}>{assetStatus}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-white/70">Authorization Signature</span>
            <span className="text-emerald-400">SIGNED</span>
          </div>
        </div>

        {signedDoc && (
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => handleViewPdf(signedDoc.id, true)} disabled={loadingUrl === signedDoc.id} className="border-white/20 text-white hover:bg-white/10">
              {loadingUrl === signedDoc.id ? <Loader2 className="size-4 animate-spin mr-2" /> : <Download className="size-4 mr-2" />}
              Download Auth
            </Button>
            <Button onClick={() => handleViewPdf(signedDoc.id, false)} disabled={loadingUrl === signedDoc.id} className="bg-white/10 hover:bg-white/20 text-white border border-white/10">
              {loadingUrl === signedDoc.id ? <Loader2 className="size-4 animate-spin mr-2" /> : <ExternalLink className="size-4 mr-2" />}
              View Auth
            </Button>
          </div>
        )}

        <div className="flex justify-between pt-4 border-t border-white/10">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
            <ChevronLeft className="size-4 mr-1" /> Back
          </Button>
          <div className="flex items-center gap-3">
            <Button onClick={onNext} disabled={!isApproved} className="bg-emerald-600 hover:bg-emerald-500 text-white border-0">
              Continue <ChevronRight className="size-4 ml-1" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

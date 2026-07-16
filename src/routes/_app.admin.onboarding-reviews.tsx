import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AdminGuard } from "@/components/AdminGuard";
import { PageCard } from "@/components/dashboard/PageCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { listPendingReviews, getReviewDetail, decideAuthorization } from "@/lib/onboarding/admin.functions";
import { getSignedDocUrl } from "@/lib/onboarding/authorization.functions";
import { Loader2, Search, FileText, CheckCircle2, XCircle, AlertTriangle, Download, ExternalLink, ShieldAlert, History } from "lucide-react";

export const Route = createFileRoute("/_app/admin/onboarding-reviews")({
  head: () => ({ meta: [{ title: "Onboarding Reviews — Eterna Admin" }] }),
  component: () => <AdminGuard><OnboardingReviewsPage /></AdminGuard>,
});

function OnboardingReviewsPage() {
  const fetchList = useServerFn(listPendingReviews);
  const fetchDetail = useServerFn(getReviewDetail);
  const decide = useServerFn(decideAuthorization);
  const fetchUrl = useServerFn(getSignedDocUrl);

  const { data: list, refetch: refetchList, isLoading: isListLoading } = useQuery({
    queryKey: ["admin_pending_reviews"],
    queryFn: () => fetchList(),
  });

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: detail, refetch: refetchDetail, isLoading: isDetailLoading } = useQuery({
    queryKey: ["admin_review_detail", selectedId],
    queryFn: () => selectedId ? fetchDetail({ data: { authorization_id: selectedId } }) : null,
    enabled: !!selectedId,
  });

  const [actionType, setActionType] = useState<"approve" | "reject" | "request_info" | "suspend" | "revoke" | "renew" | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);

  const filteredList = list?.filter((item: any) => 
    item.auth_number.toLowerCase().includes(search.toLowerCase()) || 
    (item.client_profiles?.display_name || "").toLowerCase().includes(search.toLowerCase()) ||
    (item.client_profiles?.client_id || "").toLowerCase().includes(search.toLowerCase())
  );

  const handleAction = async () => {
    if (!selectedId || !actionType) return;
    if (actionType !== "approve" && !notes.trim()) {
      return toast.error("A reason is required for this action.");
    }
    setBusy(true);
    try {
      await decide({ data: { authorization_id: selectedId, decision: actionType, notes: notes || undefined } });
      toast.success(`Action '${actionType}' applied successfully.`);
      setActionType(null);
      setNotes("");
      setSelectedId(null);
      refetchList();
    } catch (e: any) {
      toast.error(e?.message || "Action failed");
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
        a.download = "Eterna_Signed_Auth.pdf";
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

  const computeScore = () => {
    if (!detail) return 0;
    let s = 0;
    if (detail.kyc?.verification_status === "APPROVED") s += 25;
    if (detail.face?.status === "FACE_VERIFIED") s += 20;
    if (detail.profile?.email_verified_at) s += 10;
    if ((detail.assets ?? []).some((a: any) => a.verification_status === "VERIFIED")) s += 25;
    if ((detail.signatures ?? []).some((x: any) => x.status === "SIGNED")) s += 10;
    return s;
  };

  const score = computeScore();

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Onboarding Reviews</h1>
          <p className="text-white/60">Review and approve client authorization requests.</p>
        </div>
      </div>

      <PageCard>
        <div className="p-4 border-b border-white/10 flex gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-white/40" />
            <Input 
              placeholder="Search by Client ID, Name, or Auth #" 
              value={search} 
              onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-white/5 border-white/10 text-white"
            />
          </div>
        </div>

        {isListLoading ? (
          <div className="p-12 flex justify-center"><Loader2 className="size-6 animate-spin text-white/40" /></div>
        ) : filteredList?.length === 0 ? (
          <div className="p-12 text-center text-white/50">No pending reviews found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase bg-white/5 text-white/50">
                <tr>
                  <th className="px-6 py-3">Client</th>
                  <th className="px-6 py-3">Auth #</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Submitted</th>
                  <th className="px-6 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredList?.map((item: any) => (
                  <tr key={item.id} className="border-b border-white/10 hover:bg-white/5">
                    <td className="px-6 py-4">
                      <div className="text-white font-medium">{item.client_profiles?.display_name || 'Unknown'}</div>
                      <div className="text-xs text-white/50 font-mono">{item.client_profiles?.client_id}</div>
                    </td>
                    <td className="px-6 py-4 font-mono text-white/70">{item.auth_number}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-[10px] uppercase font-semibold ${
                        item.status === 'UNDER_ADMIN_REVIEW' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {item.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-white/60">{new Date(item.updated_at).toLocaleDateString()}</td>
                    <td className="px-6 py-4">
                      <Button size="sm" variant="outline" onClick={() => setSelectedId(item.id)} className="border-white/20 text-white hover:bg-white/10">
                        Review
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageCard>

      <Dialog open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-4xl bg-[#0A1128] border-white/10 text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Authorization Request</DialogTitle>
            <DialogDescription className="text-white/60">
              Review verification data and approve or reject the request.
            </DialogDescription>
          </DialogHeader>

          {isDetailLoading ? (
            <div className="py-20 flex justify-center"><Loader2 className="size-8 animate-spin text-blue-500" /></div>
          ) : detail ? (
            <div className="space-y-6">
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                  <div className="text-xs text-white/50 uppercase">Score</div>
                  <div className="text-2xl font-bold text-white mt-1">{score}/100</div>
                  <div className="text-[10px] text-white/40 mt-1">Requires 100</div>
                </div>
                <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                  <div className="text-xs text-white/50 uppercase">Identity (KYC)</div>
                  <div className={`text-sm font-semibold mt-1 ${detail.kyc?.verification_status === 'APPROVED' ? 'text-emerald-400' : 'text-orange-400'}`}>
                    {detail.kyc?.verification_status || 'MISSING'}
                  </div>
                </div>
                <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                  <div className="text-xs text-white/50 uppercase">Liveness</div>
                  <div className={`text-sm font-semibold mt-1 ${detail.face?.status === 'FACE_VERIFIED' ? 'text-emerald-400' : 'text-orange-400'}`}>
                    {detail.face?.status || 'MISSING'}
                  </div>
                </div>
                <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                  <div className="text-xs text-white/50 uppercase">Assets</div>
                  <div className={`text-sm font-semibold mt-1 ${detail.assets?.some((a: any) => a.verification_status === 'VERIFIED') ? 'text-emerald-400' : 'text-orange-400'}`}>
                    {detail.assets?.some((a: any) => a.verification_status === 'VERIFIED') ? 'VERIFIED' : 'MISSING'}
                  </div>
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-white/80 border-b border-white/10 pb-2 mb-3">Client Profile</h3>
                <div className="grid grid-cols-2 gap-y-2 text-sm">
                  <div className="text-white/50">Full Name</div><div className="text-white">{detail.profile?.full_name || detail.profile?.display_name || '-'}</div>
                  <div className="text-white/50">Company</div><div className="text-white">{detail.profile?.company_name || '-'}</div>
                  <div className="text-white/50">Email</div><div className="text-white">{detail.profile?.email || '-'}</div>
                  <div className="text-white/50">Phone</div><div className="text-white">{detail.profile?.phone || '-'}</div>
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-white/80 border-b border-white/10 pb-2 mb-3">Documents & Signatures</h3>
                {(() => {
                  const signedDoc = detail.documents?.find((d: any) => d.kind === "signed" && d.version === detail.auth?.version);
                  const sig = detail.signatures?.find((s: any) => s.status === "SIGNED" && s.version === detail.auth?.version);
                  return signedDoc && sig ? (
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between items-center bg-blue-500/10 p-3 rounded-lg border border-blue-500/20">
                        <div className="flex items-center gap-2">
                          <FileText className="size-4 text-blue-400" />
                          <span className="text-blue-300">Signed Authorization Letter v{detail.auth.version}</span>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => handleViewPdf(signedDoc.id, true)} disabled={loadingUrl === signedDoc.id} className="h-7 text-xs border-blue-500/30 text-blue-300 hover:bg-blue-500/20">
                            Download
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleViewPdf(signedDoc.id, false)} disabled={loadingUrl === signedDoc.id} className="h-7 text-xs border-blue-500/30 text-blue-300 hover:bg-blue-500/20">
                            View PDF
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-y-1 text-xs px-2">
                        <div className="text-white/50">Signed By</div><div className="text-white">{sig.typed_name} ({sig.role_title || 'Owner'})</div>
                        <div className="text-white/50">Timestamp</div><div className="text-white">{sig.signed_at ? new Date(sig.signed_at).toLocaleString() : 'Unknown'}</div>
                        <div className="text-white/50">IP Address</div><div className="text-white font-mono">{sig.ip_address}</div>
                        <div className="text-white/50">SHA-256 Hash</div><div className="text-white font-mono truncate max-w-[200px]" title={signedDoc.sha256 ?? undefined}>{signedDoc.sha256}</div>
                      </div>
                    </div>
                  ) : <div className="text-sm text-white/50">No valid signed document found for current version.</div>;
                })()}
              </div>

              {detail.reviews && detail.reviews.length > 0 && (
                <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-white/80 border-b border-white/10 pb-2 mb-3">Review History</h3>
                  <div className="space-y-3">
                    {detail.reviews.map((r: any) => (
                      <div key={r.id} className="text-xs bg-black/20 p-2 rounded">
                        <div className="flex justify-between text-white/50 mb-1">
                          <span className="uppercase font-semibold text-white/70">{r.decision.replace('_', ' ')}</span>
                          <span>{new Date(r.decided_at).toLocaleString()}</span>
                        </div>
                        {r.notes && <div className="text-white/80">{r.notes}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {actionType ? (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 space-y-4">
                  <div className="text-sm font-semibold text-blue-300 uppercase">Confirm Action: {actionType.replace('_', ' ')}</div>
                  {actionType !== "approve" && (
                    <div className="space-y-2">
                      <label className="text-xs text-white/60">Reason / Notes to Client (Required)</label>
                      <Textarea 
                        value={notes} 
                        onChange={e => setNotes(e.target.value)} 
                        className="bg-black/40 border-white/10 text-white" 
                        placeholder={actionType === 'request_info' ? 'e.g. Please correct your asset documentation.' : 'Reason for rejection/suspension'}
                      />
                    </div>
                  )}
                  <div className="flex gap-3 justify-end">
                    <Button variant="ghost" onClick={() => setActionType(null)} disabled={busy} className="text-white hover:bg-white/10">Cancel</Button>
                    <Button onClick={handleAction} disabled={busy || (actionType !== "approve" && !notes.trim())} className="bg-blue-600 hover:bg-blue-500 text-white">
                      {busy ? <Loader2 className="size-4 animate-spin mr-2" /> : null} Submit Decision
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-3 pt-2">
                  <Button onClick={() => setActionType("approve")} className="bg-emerald-600 hover:bg-emerald-500 text-white"><CheckCircle2 className="size-4 mr-2" /> Approve</Button>
                  <Button variant="outline" onClick={() => setActionType("request_info")} className="border-orange-500/50 text-orange-400 hover:bg-orange-500/10"><AlertTriangle className="size-4 mr-2" /> Request Info</Button>
                  <Button variant="outline" onClick={() => setActionType("reject")} className="border-red-500/50 text-red-400 hover:bg-red-500/10"><XCircle className="size-4 mr-2" /> Reject</Button>
                  <Button variant="outline" onClick={() => setActionType("suspend")} className="border-red-500/50 text-red-400 hover:bg-red-500/10"><ShieldAlert className="size-4 mr-2" /> Suspend</Button>
                  <Button variant="outline" onClick={() => setActionType("revoke")} className="border-red-500/50 text-red-400 hover:bg-red-500/10"><History className="size-4 mr-2" /> Revoke</Button>
                </div>
              )}

            </div>
          ) : (
            <div className="py-12 text-center text-white/50">Failed to load details.</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

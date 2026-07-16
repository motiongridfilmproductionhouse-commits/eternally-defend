import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, ChevronRight, ChevronLeft, FileText, Download, ExternalLink, RefreshCw, CheckCircle2 } from "lucide-react";
import { getAuthorizationBundle, generateDraftPdf, getSignedDocUrl } from "@/lib/onboarding/authorization.functions";

export function AuthorizationReviewStep({
  onBack,
  onNext,
  onGoToStep,
}: {
  onBack: () => void;
  onNext: () => void;
  onGoToStep: (step: number) => void;
}) {
  const fetchAuth = useServerFn(getAuthorizationBundle);
  const generateDraft = useServerFn(generateDraftPdf);
  const fetchUrl = useServerFn(getSignedDocUrl);

  const { data: authBundle, refetch, isLoading } = useQuery({
    queryKey: ["auth_bundle"],
    queryFn: () => fetchAuth(),
  });

  const [generating, setGenerating] = useState(false);
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateDraft();
      await refetch();
      toast.success("Authorization draft generated successfully.");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to generate draft");
    } finally {
      setGenerating(false);
    }
  };

  const handleViewPdf = async (docId: string, download: boolean = false) => {
    setLoadingUrl(docId);
    try {
      const { url } = await fetchUrl({ data: { doc_id: docId } });
      if (download) {
        const a = document.createElement("a");
        a.href = url;
        a.download = "Eterna_Authorization_Draft.pdf";
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
        <CardContent className="py-12 text-center text-white/50">Authorization data not found. Please complete previous steps.</CardContent>
      </Card>
    );
  }

  const draftDoc = authBundle?.documents?.find((d: any) => d.kind === "draft" && d.version === auth.version);
  const scopesCount = authBundle?.scopes?.filter((s: any) => s.granted).length ?? 0;
  
  const isReady = !!draftDoc;

  return (
    <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl shadow-black/50">
      <CardHeader>
        <CardTitle className="text-xl">Authorization Letter Review</CardTitle>
        <CardDescription className="text-white/60">
          Review your legally binding authorization letter draft before signing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="text-xs text-white/40 uppercase tracking-wider mb-1">Authorization ID</div>
            <div className="font-mono text-white">{auth.auth_number}</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="text-xs text-white/40 uppercase tracking-wider mb-1">Document Version</div>
            <div className="text-white">v{auth.version}</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="text-xs text-white/40 uppercase tracking-wider mb-1">Status</div>
            <div className="text-white flex items-center gap-2">
              <span className={`size-2 rounded-full ${auth.status === 'DRAFT' ? 'bg-blue-400' : 'bg-emerald-400'}`}></span>
              {auth.status.replace(/_/g, " ")}
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="text-xs text-white/40 uppercase tracking-wider mb-1">Dates</div>
            <div className="text-white text-sm">
              <div>Effective: {auth.effective_date}</div>
              <div>Expires: {auth.expiry_date}</div>
            </div>
          </div>
        </div>

        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-10 bg-blue-500/20 rounded-full flex items-center justify-center shrink-0">
              <FileText className="size-5 text-blue-400" />
            </div>
            <div>
              <div className="font-semibold text-blue-200">Official Authorization Draft</div>
              <div className="text-xs text-blue-300/70">
                {draftDoc ? "Draft generated and ready for review." : "A PDF draft must be generated to proceed."}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {!draftDoc ? (
              <Button onClick={handleGenerate} disabled={generating} className="bg-blue-600 hover:bg-blue-500 text-white">
                {generating ? <Loader2 className="size-4 animate-spin mr-2" /> : <RefreshCw className="size-4 mr-2" />}
                Generate Draft PDF
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => handleGenerate()} disabled={generating} className="border-white/20 text-white hover:bg-white/10" title="Regenerate Draft">
                  <RefreshCw className={`size-4 ${generating ? 'animate-spin' : ''}`} />
                </Button>
                <Button variant="outline" onClick={() => handleViewPdf(draftDoc.id, true)} disabled={loadingUrl === draftDoc.id} className="border-white/20 text-white hover:bg-white/10">
                  {loadingUrl === draftDoc.id ? <Loader2 className="size-4 animate-spin mr-2" /> : <Download className="size-4 mr-2" />}
                  Download
                </Button>
                <Button onClick={() => handleViewPdf(draftDoc.id, false)} disabled={loadingUrl === draftDoc.id} className="bg-white/10 hover:bg-white/20 text-white border border-white/10">
                  {loadingUrl === draftDoc.id ? <Loader2 className="size-4 animate-spin mr-2" /> : <ExternalLink className="size-4 mr-2" />}
                  View PDF
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm space-y-2 text-white/70">
          <p>Please review the generated PDF thoroughly. It contains:</p>
          <ul className="list-disc list-inside space-y-1 ml-2 text-white/90">
            <li>Your client profile details. <button onClick={() => onGoToStep(1)} className="text-blue-400 hover:underline">Edit</button></li>
            <li>Your verified digital assets. <button onClick={() => onGoToStep(4)} className="text-blue-400 hover:underline">Edit</button></li>
            <li>{scopesCount} authorized monitoring scopes. <button onClick={() => onGoToStep(5)} className="text-blue-400 hover:underline">Edit</button></li>
          </ul>
          <p className="pt-2 text-xs text-white/50">If you make any edits to the above information, you must return to this step and Regenerate the Draft PDF before signing.</p>
        </div>

        <div className="flex justify-between pt-4">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10" disabled={generating}>
            <ChevronLeft className="size-4 mr-1" /> Back
          </Button>
          <div className="flex items-center gap-3">
            {isReady && <div className="text-emerald-400 text-sm flex items-center gap-1"><CheckCircle2 className="size-4" /> Ready for signature</div>}
            <Button onClick={onNext} disabled={!isReady || generating} className="bg-blue-600 hover:bg-blue-500 text-white border-0">
              Continue to Signature <ChevronRight className="size-4 ml-1" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronRight, ChevronLeft, Youtube, ShieldCheck, CheckCircle2, Trash2, Copy, RefreshCcw, AlertCircle } from "lucide-react";
import { listAssets, addYouTubeAsset, removeAsset, generateChallenge, verifyChallenge } from "@/lib/onboarding/assets.functions";

export function AssetVerificationStep({
  onBack,
  onNext
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  const fetchAssets = useServerFn(listAssets);
  const addAsset = useServerFn(addYouTubeAsset);
  const remove = useServerFn(removeAsset);
  const genChallenge = useServerFn(generateChallenge);
  const verify = useServerFn(verifyChallenge);

  const { data: assets = [], refetch, isLoading } = useQuery({
    queryKey: ["digital_assets"],
    queryFn: () => fetchAssets(),
  });

  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeChallenges, setActiveChallenges] = useState<Record<string, { code: string; expiresAt: string }>>({});

  const handleAdd = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      await addAsset({ data: { channel_url: url.trim() } });
      setUrl("");
      await refetch();
      toast.success("YouTube channel added.");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add channel");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (!confirm("Remove this asset?")) return;
    setBusy(true);
    try {
      await remove({ data: { id } });
      await refetch();
      toast.success("Asset removed");
    } catch (e: any) {
      toast.error("Failed to remove asset");
    } finally {
      setBusy(false);
    }
  };

  const handleGenerate = async (id: string) => {
    setBusy(true);
    try {
      const chal = await genChallenge({ data: { asset_id: id } });
      setActiveChallenges(prev => ({ ...prev, [id]: { code: chal.code, expiresAt: chal.expires_at } }));
      await refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to generate challenge");
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (id: string) => {
    setBusy(true);
    try {
      const res = await verify({ data: { asset_id: id } });
      if (res.ok) {
        toast.success("YouTube Ownership Verified!");
        setActiveChallenges(prev => { const n = { ...prev }; delete n[id]; return n; });
        await refetch();
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  const hasVerifiedAsset = assets.some(a => a.verification_status === "VERIFIED");

  return (
    <Card className="bg-[#0A1128] border-white/10 text-white shadow-2xl shadow-black/50">
      <CardHeader>
        <CardTitle className="text-xl">Digital Asset Verification</CardTitle>
        <CardDescription className="text-white/60">
          Add your YouTube channels. To prove ownership, we will provide a secure code for you to paste into your channel or video description.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        
        <div className="flex gap-2">
          <Input 
            placeholder="YouTube Channel URL, Handle, or ID" 
            value={url} 
            onChange={(e) => setUrl(e.target.value)} 
            className="bg-[#0F172A] border-white/10 text-white"
            disabled={busy}
          />
          <Button onClick={handleAdd} disabled={!url.trim() || busy} className="bg-blue-600 hover:bg-blue-500 text-white border-0 shrink-0">
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Add Channel"}
          </Button>
        </div>

        {isLoading ? (
          <div className="py-8 flex justify-center"><Loader2 className="size-6 animate-spin text-blue-500" /></div>
        ) : assets.length === 0 ? (
          <div className="border border-dashed border-white/20 rounded-xl p-8 text-center text-white/50 text-sm">
            No assets added yet. You must verify at least one asset to proceed.
          </div>
        ) : (
          <div className="space-y-4">
            {assets.map((asset) => {
              const isVerified = asset.verification_status === "VERIFIED";
              const isCodeGenerated = asset.verification_status === "CODE_GENERATED";
              const chal = activeChallenges[asset.id];

              return (
                <div key={asset.id} className="border border-white/10 rounded-xl p-4 bg-white/5 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="size-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                        <Youtube className="size-5 text-red-500" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-white flex items-center gap-2 truncate">
                          {asset.name ?? asset.handle ?? asset.channel_id}
                          {isVerified && <CheckCircle2 className="size-4 text-emerald-400" />}
                        </div>
                        <div className="text-xs text-white/50 truncate">
                          {asset.handle ? `@${asset.handle}` : asset.channel_id}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-[10px] uppercase ${isVerified ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" : "border-white/20 text-white/60 bg-white/5"}`}>
                        {asset.verification_status.replace("_", " ")}
                      </Badge>
                      <Button variant="ghost" size="icon" className="size-8 text-white/40 hover:text-red-400 hover:bg-white/10" onClick={() => handleRemove(asset.id)} disabled={busy}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>

                  {isVerified ? (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 flex gap-3 text-sm text-emerald-200/90">
                      <ShieldCheck className="size-5 shrink-0 text-emerald-400" />
                      <div>
                        <div className="font-semibold text-emerald-400 mb-1">YouTube Ownership Verified</div>
                        <div className="text-xs space-y-0.5">
                          <div>Method: Verification code challenge</div>
                          <div>Date: {new Date(asset.verified_at!).toLocaleString()}</div>
                          <div>Safe Evidence Summary: {asset.verification_method ?? "Channel Description"}</div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4 space-y-4">
                      {chal ? (
                        <>
                          <div className="text-sm text-white/80">
                            <strong>Step 1:</strong> Copy this secure code.
                          </div>
                          <div className="flex gap-2">
                            <code className="flex-1 bg-black/40 border border-white/10 rounded-md p-2 text-center text-lg font-mono tracking-widest text-blue-400 font-bold select-all">
                              {chal.code}
                            </code>
                            <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(chal.code); toast.success("Copied to clipboard"); }} className="shrink-0 bg-white/10 hover:bg-white/20 text-white">
                              <Copy className="size-4" />
                            </Button>
                          </div>
                          <div className="text-sm text-white/80">
                            <strong>Step 2:</strong> Paste the code into your <a href={asset.channel_url ?? undefined} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">YouTube channel description</a> (About tab) or into the description of any of your 5 most recent public videos.
                          </div>
                          <div className="flex items-center gap-2 pt-2">
                            <Button onClick={() => handleVerify(asset.id)} disabled={busy} className="bg-blue-600 hover:bg-blue-500 text-white flex-1">
                              {busy ? <Loader2 className="size-4 animate-spin mr-2" /> : <ShieldCheck className="size-4 mr-2" />}
                              Verify Ownership
                            </Button>
                            <Button variant="outline" onClick={() => handleGenerate(asset.id)} disabled={busy} className="border-white/20 text-white shrink-0" title="Regenerate Code">
                              <RefreshCcw className="size-4" />
                            </Button>
                          </div>
                          <div className="text-[10px] text-white/40 flex items-center gap-1 mt-2">
                            <AlertCircle className="size-3" /> Code expires in 24 hours.
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-2 space-y-3">
                          <p className="text-sm text-white/60 text-center">Generate a secure code to place on your channel to verify ownership.</p>
                          <Button onClick={() => handleGenerate(asset.id)} disabled={busy} className="bg-white/10 hover:bg-white/20 text-white border border-white/10">
                            Generate Verification Code
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-between pt-4">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10" disabled={busy}>
            <ChevronLeft className="size-4 mr-1" /> Back
          </Button>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => refetch()} disabled={busy} className="border-white/20 text-white hover:bg-white/10">
              Refresh Status
            </Button>
            <Button onClick={onNext} disabled={!hasVerifiedAsset || busy} className="bg-blue-600 hover:bg-blue-500 text-white border-0">
              Continue <ChevronRight className="size-4 ml-1" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

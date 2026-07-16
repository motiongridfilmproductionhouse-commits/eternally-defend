import { createFileRoute } from "@tanstack/react-router";
import { SensitiveAccessGate } from "@/components/sensitive-protection/AccessGate";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, AlertTriangle, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_app/sensitive-protection/results/$id")({
  component: SensitiveResultDetail,
  head: () => ({ meta: [{ title: "Result Detail · Sensitive Protection" }] }),
});

function SensitiveResultDetail() {
  const { id } = Route.useParams();
  const [revealed, setRevealed] = useState(false);
  const [confirmingReveal, setConfirmingReveal] = useState(false);

  const handleReveal = () => {
    // In production, this would fire an audit log mutation
    setRevealed(true);
    // Auto-reblur after 30 seconds
    setTimeout(() => setRevealed(false), 30000);
    setConfirmingReveal(false);
  };

  return (
    <SensitiveAccessGate>
      <div className="p-8 max-w-4xl mx-auto space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold font-display text-white mb-1">Result Detail</h1>
            <p className="text-white/60 font-mono text-xs uppercase tracking-wider">{id}</p>
          </div>
          <Button variant="outline" className="border-white/10 text-white hover:bg-white/5">Back to List</Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="bg-[#0A1128] border-white/10 overflow-hidden relative min-h-[300px] flex items-center justify-center">
            {revealed ? (
              <div className="absolute inset-0 p-4">
                <div className="w-full h-full border border-red-500/30 bg-red-950/20 flex flex-col items-center justify-center text-center p-6 relative">
                  {/* The watermark overlay */}
                  <div className="absolute inset-0 pointer-events-none opacity-20 flex flex-col items-center justify-center font-mono text-white text-[10px] uppercase rotate-[-20deg]">
                    WATERMARK • {new Date().toISOString()} • CONFIDENTIAL
                  </div>
                  <AlertTriangle className="size-8 text-red-400 mb-2" />
                  <p className="text-sm text-red-200">Simulated Explicit Content Revealed</p>
                  <p className="text-xs text-red-400/70 mt-2">Will auto-blur in 30s</p>
                </div>
              </div>
            ) : (
              <div className="absolute inset-0 bg-[#050A18]">
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center z-20 relative">
                  <EyeOff className="size-12 text-white/20 mb-4" />
                  <h3 className="text-lg font-semibold text-white">Content Blurred</h3>
                  <p className="text-sm text-white/50 mt-2 max-w-[250px]">
                    This content has been blocked for your protection. Review metadata carefully before revealing.
                  </p>
                  {confirmingReveal ? (
                    <div className="mt-6 bg-red-950/40 border border-red-500/20 p-4 rounded-lg text-sm text-left">
                      <p className="text-red-200 font-semibold mb-2 flex items-center"><AlertTriangle className="size-4 mr-2" /> Action will be audited</p>
                      <p className="text-red-200/70 text-xs mb-4">By revealing this content, your identity and IP will be logged.</p>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleReveal} className="bg-red-600 hover:bg-red-500 text-white flex-1">Confirm Reveal</Button>
                        <Button size="sm" variant="outline" onClick={() => setConfirmingReveal(false)} className="border-white/10 text-white hover:bg-white/10 flex-1">Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <Button onClick={() => setConfirmingReveal(true)} className="mt-6 bg-white/5 border border-white/10 text-white hover:bg-white/10">
                      <Eye className="size-4 mr-2" /> Reveal Temporarily
                    </Button>
                  )}
                </div>
              </div>
            )}
          </Card>

          <div className="space-y-4">
            <Card className="bg-[#0A1128] border-white/10">
              <CardContent className="p-5 space-y-4 text-sm">
                <div className="flex justify-between border-b border-white/10 pb-2">
                  <span className="text-white/50">Provider</span>
                  <span className="text-white font-medium">Hive AI (Sync)</span>
                </div>
                <div className="flex justify-between border-b border-white/10 pb-2">
                  <span className="text-white/50">Explicit Content</span>
                  <span className="text-red-400 font-mono">0.98</span>
                </div>
                <div className="flex justify-between border-b border-white/10 pb-2">
                  <span className="text-white/50">Deepfake / Synth</span>
                  <span className="text-orange-400 font-mono">0.82</span>
                </div>
                <div className="flex justify-between pb-2">
                  <span className="text-white/50">Face Similarity</span>
                  <span className="text-emerald-400 font-mono">0.99</span>
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-2">
              <Button className="bg-red-600 hover:bg-red-500 text-white justify-start">
                <ShieldCheck className="size-4 mr-2" /> Request Immediate Takedown
              </Button>
              <Button variant="outline" className="border-white/10 text-white hover:bg-white/10 justify-start">
                Mark as False Match
              </Button>
            </div>
          </div>
        </div>
      </div>
    </SensitiveAccessGate>
  );
}

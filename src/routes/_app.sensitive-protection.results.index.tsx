import { createFileRoute, Link } from "@tanstack/react-router";
import { SensitiveAccessGate } from "@/components/sensitive-protection/AccessGate";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, EyeOff, ShieldAlert, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_app/sensitive-protection/results/")({
  component: SensitiveResultsList,
  head: () => ({ meta: [{ title: "Discovered Sensitive Content · Eterna AI" }] }),
});

function SensitiveResultsList() {
  // Mock data for UI demonstration
  const mockResults = [
    { id: "res-1", domain: "example-adult-tube.com", risk: "CRITICAL", date: "2026-07-16", reviewStatus: "POTENTIAL_MATCH" },
    { id: "res-2", domain: "fake-news-deepfake.net", risk: "HIGH", date: "2026-07-15", reviewStatus: "POSSIBLE_DEEPFAKE" },
  ];

  return (
    <SensitiveAccessGate>
      <div className="p-8 max-w-6xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold font-display text-white mb-2">Review Results</h1>
          <p className="text-white/60">Discovered potential matches. Raw media is permanently blurred here by default.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {mockResults.map(r => (
            <Link key={r.id} to="/sensitive-protection/results/$id" params={{ id: r.id }}>
              <Card className="bg-[#0A1128] border-white/10 hover:border-blue-500/50 transition cursor-pointer overflow-hidden flex flex-col h-full group">
                <div className="h-40 bg-[#050A18] relative flex flex-col items-center justify-center border-b border-white/10 p-6 overflow-hidden">
                  <div className="absolute inset-0 bg-white/5 backdrop-blur-2xl z-10"></div>
                  <EyeOff className="size-10 text-white/20 z-20 mb-2 group-hover:scale-110 transition-transform" />
                  <span className="text-xs text-white/40 font-mono z-20 font-bold uppercase tracking-widest text-center">
                    Case-Safe Placeholder
                  </span>
                </div>
                <CardContent className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <div className="text-sm font-medium text-white truncate max-w-[180px]">{r.domain}</div>
                      <Badge variant="outline" className={r.risk === 'CRITICAL' ? 'border-red-500/50 text-red-400 bg-red-500/10' : 'border-orange-500/50 text-orange-400 bg-orange-500/10'}>
                        {r.risk}
                      </Badge>
                    </div>
                    <div className="text-xs text-white/50">{new Date(r.date).toLocaleDateString()}</div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
                    <span className="text-[10px] tracking-wider text-white/40 uppercase">{r.reviewStatus.replace(/_/g, ' ')}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </SensitiveAccessGate>
  );
}

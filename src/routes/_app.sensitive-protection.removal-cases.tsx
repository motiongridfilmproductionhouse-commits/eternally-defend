import { createFileRoute } from "@tanstack/react-router";
import { SensitiveAccessGate } from "@/components/sensitive-protection/AccessGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Scale } from "lucide-react";

export const Route = createFileRoute("/_app/sensitive-protection/removal-cases")({
  component: SensitiveRemovalCases,
  head: () => ({ meta: [{ title: "Removal Cases · Sensitive Protection" }] }),
});

function SensitiveRemovalCases() {
  const mockCases = [
    { id: "case-001", domain: "example-adult-tube.com", status: "UNDER_REVIEW", submitted: "2026-07-16" },
  ];

  return (
    <SensitiveAccessGate>
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold font-display text-white mb-2">Enforcement & Removal Cases</h1>
          <p className="text-white/60">Track legal complaints, DMCA takedowns, and host notifications.</p>
        </div>

        <Card className="bg-[#0A1128] border-white/10">
          <CardHeader>
            <CardTitle className="text-white flex items-center">
              <Scale className="size-5 mr-2 text-brand-glow" /> Active Cases
            </CardTitle>
          </CardHeader>
          <CardContent>
            {mockCases.length === 0 ? (
              <div className="text-center py-8 text-white/50 text-sm">No active removal cases.</div>
            ) : (
              <div className="space-y-4">
                {mockCases.map(c => (
                  <div key={c.id} className="flex justify-between items-center p-4 border border-white/10 rounded-lg bg-white/5">
                    <div>
                      <div className="font-semibold text-white">{c.domain}</div>
                      <div className="text-xs text-white/50 font-mono mt-1">Submitted: {c.submitted}</div>
                    </div>
                    <Badge variant="outline" className="border-blue-500/50 text-blue-400 bg-blue-500/10">
                      {c.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </SensitiveAccessGate>
  );
}

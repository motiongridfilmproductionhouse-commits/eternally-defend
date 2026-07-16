import { createFileRoute } from "@tanstack/react-router";
import { SensitiveAccessGate } from "@/components/sensitive-protection/AccessGate";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldAlert, Zap } from "lucide-react";

export const Route = createFileRoute("/_app/sensitive-protection/emergency")({
  component: EmergencyProtection,
  head: () => ({ meta: [{ title: "Emergency Protection · Eterna AI" }] }),
});

function EmergencyProtection() {
  return (
    <SensitiveAccessGate>
      <div className="p-8 max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold font-display text-white mb-2">Emergency Protection Mode</h1>
          <p className="text-white/60">Activate rapid scanning and prioritize reviews if you believe a leak or deepfake is actively spreading.</p>
        </div>

        <Card className="bg-[#0A1128] border-red-500/30 shadow-[0_0_30px_-10px_rgba(239,68,68,0.2)]">
          <CardContent className="p-8 flex flex-col items-center text-center">
            <div className="size-20 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-6">
              <ShieldAlert className="size-10 text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-white mb-4">Activate Emergency Protocols</h2>
            <ul className="text-sm text-red-200/80 space-y-2 mb-8 max-w-md text-left list-disc list-inside">
              <li>Increase discovery frequency (scans every 15 mins)</li>
              <li>Prioritize Hive AI async video processing</li>
              <li>Notify assigned case reviewer immediately</li>
              <li>Automate evidence capture on new matches</li>
            </ul>
            <Button className="bg-red-600 hover:bg-red-500 text-white w-full max-w-sm h-12 text-lg font-bold tracking-wider">
              <Zap className="size-5 mr-2" /> ACTIVATE NOW
            </Button>
            <p className="text-xs text-white/40 mt-4">Note: Emergency mode auto-expires after 72 hours.</p>
          </CardContent>
        </Card>
      </div>
    </SensitiveAccessGate>
  );
}

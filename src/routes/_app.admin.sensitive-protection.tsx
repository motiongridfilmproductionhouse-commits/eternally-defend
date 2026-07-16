import { createFileRoute, redirect } from "@tanstack/react-router";
import { useUserRoles } from "@/hooks/use-user-roles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, AlertTriangle, Shield, CheckCircle2, XCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getHiveDiagnostics } from "@/lib/providers/hive-classification.functions";

export const Route = createFileRoute("/_app/admin/sensitive-protection")({
  beforeLoad: ({ context }) => {
    // Only admins can load this route
    if (!context.isAdmin) {
      throw redirect({ to: "/" });
    }
  },
  component: AdminSensitiveProtection,
  head: () => ({ meta: [{ title: "Admin · Sensitive Protection" }] }),
});

function AdminSensitiveProtection() {
  const { data: diagnostics, isLoading } = useQuery({
    queryKey: ["hive_diagnostics"],
    queryFn: () => getHiveDiagnostics(),
  });

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold font-display text-white mb-2 flex items-center">
          <Shield className="size-6 mr-3 text-warning" />
          System Admin: Intimate Image & Deepfake Protection
        </h1>
        <p className="text-white/60">Module oversight, API diagnostics, and emergency manual overrides.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-[#0A1128] border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base flex items-center">
              <Activity className="size-4 mr-2 text-blue-400" /> Hive AI Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-white/50 text-sm py-4">Loading diagnostics...</div>
            ) : diagnostics ? (
              <div className="space-y-3 text-sm">
                <div className="flex justify-between border-b border-white/10 pb-1">
                  <span className="text-white/50">Configured</span>
                  <span className="text-white flex items-center">
                    {diagnostics.configured ? <CheckCircle2 className="size-3 text-emerald-400 mr-1"/> : <XCircle className="size-3 text-red-400 mr-1"/>}
                    {diagnostics.configured ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between border-b border-white/10 pb-1">
                  <span className="text-white/50">Auth Status</span>
                  <span className={diagnostics.configured ? "text-emerald-400 font-medium" : "text-red-400 font-medium"}>
                    {diagnostics.authStatus}
                  </span>
                </div>
                <div className="flex justify-between border-b border-white/10 pb-1">
                  <span className="text-white/50">Avg Latency</span>
                  <span className="text-white font-mono">{diagnostics.averageLatency}ms</span>
                </div>
                <div className="flex justify-between border-b border-white/10 pb-1">
                  <span className="text-white/50">Requests</span>
                  <span className="text-white font-mono">{diagnostics.requestsProcessed}</span>
                </div>
                <div className="flex justify-between border-b border-white/10 pb-1">
                  <span className="text-white/50">Last Success</span>
                  <span className="text-white truncate max-w-[120px] text-right">
                    {diagnostics.lastSuccess ? new Date(diagnostics.lastSuccess).toLocaleString() : 'Never'}
                  </span>
                </div>
                <div className="flex justify-between pb-1">
                  <span className="text-white/50">Last Error</span>
                  <span className="text-red-400 truncate max-w-[120px] text-right" title={diagnostics.lastError || ''}>
                    {diagnostics.lastError || 'None'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-red-400 text-sm py-4">Failed to load diagnostics.</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-[#0A1128] border-red-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base flex items-center">
              <AlertTriangle className="size-4 mr-2 text-red-400" /> Emergency Cases
            </CardTitle>
          </CardHeader>
          <CardContent>
             <div className="text-center py-4 text-white/50 text-sm">No profiles currently in emergency mode.</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

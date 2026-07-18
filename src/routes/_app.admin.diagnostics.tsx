import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { PageCard } from "@/components/dashboard/PageCard";
import { AdminGuard } from "@/components/AdminGuard";
import { getIntegrationStatusFn } from "@/lib/integration-status.server";
import { CheckCircle2, ShieldAlert, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_app/admin/diagnostics")({
  head: () => ({ meta: [{ title: "System Diagnostics — Eterna AI" }] }),
  component: () => <AdminGuard><DiagnosticsPage /></AdminGuard>,
});

function DiagnosticsPage() {
  const statusFn = useServerFn(getIntegrationStatusFn);
  const { data: status, isLoading, error } = useQuery({ 
    queryKey: ["integration-diagnostics"], 
    queryFn: () => statusFn() 
  });

  return (
    <div className="space-y-5">
      <PageCard 
        title="SYSTEM DIAGNOSTICS" 
        sub="View the status of third-party integrations and core services. No secrets are exposed here."
      >
        {isLoading ? (
          <div className="text-sm text-muted-foreground p-4">Loading diagnostics...</div>
        ) : error ? (
          <div className="text-sm text-destructive p-4">Error loading diagnostics. Are you an admin?</div>
        ) : !status ? (
          <div className="text-sm text-muted-foreground p-4">No diagnostic data available.</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <StatusCard title="Supabase" status={status.supabase} description="Core database, auth, and backend logic" />
              <StatusCard title="Firecrawl" status={status.firecrawl} description="Web scraping and scanning capabilities" />
              <StatusCard title="YouTube API" status={status.youtube} description="Fetching video metadata and transcripts" />
              <StatusCard title="AWS Services" status={status.aws} description="Rekognition video processing and S3 storage" />
              <StatusCard title="Veriff KYC" status={status.veriff} description="Identity verification sessions and webhooks" />
              <StatusCard title="Google Cloud" status={status.googleCloud} description="Multimedia processing (Vision, Speech, etc)" />
              <StatusCard title="Eterna AI" status={status.ai} description="Gemini extraction and video classification" />
              <StatusCard title="Fact Checking" status={status.factChecking} description="Google Fact Check Tools API for claims" />
            </div>
          </div>
        )}
      </PageCard>
    </div>
  );
}

function StatusCard({ title, status, description }: { title: string, status: string, description: string }) {
  return (
    <div className="border border-border rounded-xl p-4 flex flex-col justify-between h-full">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="font-semibold text-sm">{title}</div>
        <StatusBadge status={status} />
      </div>
      <div className="text-xs text-muted-foreground">
        {description}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "configured") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 whitespace-nowrap" variant="outline">
        <CheckCircle2 className="size-3 mr-1" /> Configured
      </Badge>
    );
  } else if (status === "partially configured") {
    return (
      <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 whitespace-nowrap" variant="outline">
        <ShieldAlert className="size-3 mr-1" /> Partially Configured
      </Badge>
    );
  } else {
    return (
      <Badge className="bg-destructive/15 text-destructive border-destructive/30 whitespace-nowrap" variant="outline">
        <XCircle className="size-3 mr-1" /> Not Configured
      </Badge>
    );
  }
}

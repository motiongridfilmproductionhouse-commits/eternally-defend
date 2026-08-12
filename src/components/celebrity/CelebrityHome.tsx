import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, Copyright, ScanFace, ShieldCheck, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewCampaignDialog } from "@/components/celebrity/CampaignsWorkspace";
import { useVerificationStatus } from "@/hooks/use-verification-status";
import { listCampaigns } from "@/lib/campaigns/campaigns.functions";

/**
 * Simplified home for Celebrity / Public Figure accounts. Intentionally free of
 * provider diagnostics and enterprise telemetry.
 */
export function CelebrityHome() {
  const { status } = useVerificationStatus();
  const fetchCampaigns = useServerFn(listCampaigns);
  const campaignsQuery = useQuery({
    queryKey: ["celebrity-campaigns"],
    queryFn: () => fetchCampaigns(),
  });

  const active = (campaignsQuery.data?.campaigns ?? []).filter((c) => c.status === "ACTIVE");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Protection Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your reputation, likeness and campaigns are monitored continuously.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="card-surface">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="size-4 text-primary" /> Reputation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant={status === "VERIFIED" ? "default" : "secondary"}>
                {status === "VERIFIED" ? "Protected" : "Monitoring active"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Web, news and social mentions, reputation risk and items needing review.
            </p>
            <Button asChild size="sm" className="w-full">
              <Link to="/scan">Run Reputation Scan</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="card-surface">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ScanFace className="size-4 text-primary" /> Face Protection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-primary">
              <ShieldCheck className="size-4" /> Face Shield Active
            </div>
            <p className="text-xs text-muted-foreground">
              Automatic monitoring of your enrolled likeness for impersonation and deepfakes.
            </p>
            <Button asChild size="sm" variant="outline" className="w-full">
              <Link to="/face-protection">Run Image Scan</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="card-surface">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Copyright className="size-4 text-primary" /> Active Campaigns
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm font-semibold">
              {active.length} campaign{active.length === 1 ? "" : "s"} monitored
            </div>
            <p className="text-xs text-muted-foreground">
              Films, songs, trailers, photoshoots and brand campaigns.
            </p>
            <div className="flex gap-2">
              <NewCampaignDialog
                trigger={
                  <Button size="sm" className="flex-1">
                    New Campaign
                  </Button>
                }
              />
              <Button asChild size="sm" variant="outline">
                <Link to="/campaigns">View all</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="card-surface">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="size-4 text-primary" /> Recent Alerts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Reputation, face and copyright alerts appear here as soon as they are detected.
          </p>
          <Button asChild size="sm" variant="outline">
            <Link to="/notifications">Open Alerts</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

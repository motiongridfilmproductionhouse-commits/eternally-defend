import { ChevronLeft, ChevronRight, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignsWorkspace } from "@/components/celebrity/CampaignsWorkspace";

export function CompanyCampaignStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <Card className="border-white/10 bg-[#0A1128] text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="text-xl">Campaign Protection</CardTitle>
        <CardDescription className="text-white/60">
          Register campaigns with their authorized period, official URLs and approved accounts.
          Usage found after a campaign ends is flagged as POSSIBLE UNAUTHORIZED AD USE.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start gap-3 rounded-lg border border-blue-400/25 bg-blue-500/10 p-4 text-xs leading-relaxed text-blue-100">
          <Megaphone className="mt-0.5 size-4 shrink-0 text-blue-300" />
          <span>
            Campaigns are optional now and can be added at any time from the Campaigns workspace.
          </span>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#050A18] p-4">
          <CampaignsWorkspace />
        </div>

        <div className="flex justify-between border-t border-white/10 pt-4">
          <Button variant="ghost" onClick={onBack} className="text-white hover:bg-white/10">
            <ChevronLeft className="mr-1 size-4" /> Back
          </Button>
          <Button onClick={onNext} className="bg-blue-600 text-white hover:bg-blue-500">
            Continue <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

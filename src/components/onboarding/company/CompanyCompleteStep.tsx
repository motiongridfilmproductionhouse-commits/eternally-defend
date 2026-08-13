import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Building2, Eye, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { finishCompanyOnboarding } from "@/lib/onboarding/company.functions";

/**
 * Final company step: activates monitoring and opens the Company Command
 * Center. No verification badge is granted here.
 */
export function CompanyCompleteStep({ onCompleted }: { onCompleted?: () => Promise<void> | void }) {
  const finish = useServerFn(finishCompanyOnboarding);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      await finish({});
      await onCompleted?.();
      toast.success("Company onboarding complete. Monitoring is active.");
      navigate({ to: "/" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to finish setup");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-white/10 bg-[#0A1128] text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Sparkles className="size-5 text-blue-300" /> Your company workspace is ready
        </CardTitle>
        <CardDescription className="text-white/60">
          Brand monitoring starts immediately. Enforcement and takedown actions unlock once company
          authority is established.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <Eye className="mb-3 size-5 text-blue-300" />
            <div className="text-sm font-semibold">Available now</div>
            <ul className="mt-2 space-y-1 text-xs text-white/60">
              <li>Brand and reputation monitoring</li>
              <li>Impersonation detection against your official profiles</li>
              <li>Evidence collection and reports</li>
            </ul>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <ShieldCheck className="mb-3 size-5 text-blue-300" />
            <div className="text-sm font-semibold">Unlocks later</div>
            <ul className="mt-2 space-y-1 text-xs text-white/60">
              <li>Takedown and enforcement submissions</li>
              <li>Work email verification</li>
              <li>Authorized representative status</li>
            </ul>
          </div>
        </div>

        <div className="flex justify-end border-t border-white/10 pt-4">
          <Button
            onClick={start}
            disabled={busy}
            className="bg-blue-600 text-white hover:bg-blue-500"
          >
            {busy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Building2 className="mr-2 size-4" />
            )}
            Go to Company Command Center
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

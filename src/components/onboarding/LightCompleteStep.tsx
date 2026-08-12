import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BadgeCheck, Eye, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { finishLightOnboarding } from "@/lib/onboarding/light-onboarding.functions";
import { SENSITIVE_ACTION_LABELS } from "@/lib/verification/verification-status";

/**
 * Final friction-light step: starts monitoring immediately with an UNVERIFIED
 * status and explains which actions verification unlocks later.
 */
export function LightCompleteStep({ onCompleted }: { onCompleted?: () => Promise<void> | void }) {
  const finish = useServerFn(finishLightOnboarding);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      await finish();
      await onCompleted?.();
      toast.success("Monitoring is active. You can verify later.");
      navigate({ to: "/" });
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Unable to finish setup");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-white/10 bg-[#0A1128] text-white shadow-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Sparkles className="size-5 text-blue-300" /> You&apos;re ready to start monitoring
        </CardTitle>
        <CardDescription className="text-white/60">
          Your account is active with an unverified status. Verification is optional and never
          required for monitoring.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <Eye className="mb-3 size-5 text-blue-300" />
            <div className="text-sm font-semibold">Available now</div>
            <ul className="mt-2 space-y-1 text-xs text-white/60">
              <li>Web, deepfake and copyright monitoring</li>
              <li>Threat alerts and risk analytics</li>
              <li>Evidence collection and reports</li>
            </ul>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-4">
            <ShieldCheck className="mb-3 size-5 text-blue-300" />
            <div className="text-sm font-semibold">Unlocks after verification</div>
            <ul className="mt-2 space-y-1 text-xs text-white/60">
              {Object.values(SENSITIVE_ACTION_LABELS).map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-white/10 pt-4 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            className="text-white/70 hover:text-white"
            onClick={start}
            disabled={busy}
          >
            <BadgeCheck className="mr-1.5 size-4" /> Verify later
          </Button>
          <Button
            onClick={start}
            disabled={busy}
            className="bg-blue-600 text-white hover:bg-blue-500"
          >
            {busy && <Loader2 className="mr-2 size-4 animate-spin" />} Go to dashboard
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

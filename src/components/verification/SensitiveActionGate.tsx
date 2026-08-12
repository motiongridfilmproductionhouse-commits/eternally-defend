import { Link } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useVerificationStatus } from "@/hooks/use-verification-status";
import {
  VERIFICATION_REQUIRED_MESSAGE,
  type SensitiveAction,
} from "@/lib/verification/verification-status";

/**
 * Wraps a high-trust action (takedown, enforcement request, ownership claim,
 * sensitive identity data, profile transfer, representative authorization).
 * Verification is requested only at this point — not during signup.
 */
export function SensitiveActionGate({
  action: _action,
  children,
  compact,
}: {
  action: SensitiveAction;
  children: React.ReactNode;
  compact?: boolean;
}) {
  const { loading, canPerformSensitiveAction, isPending } = useVerificationStatus();

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Checking your protection access…
      </div>
    );
  }

  if (canPerformSensitiveAction) return <>{children}</>;

  return (
    <Card className="card-surface border-primary/20">
      <CardContent
        className={`flex flex-col items-start gap-3 ${compact ? "p-4" : "p-6"} sm:flex-row sm:items-center sm:justify-between`}
      >
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="size-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">{VERIFICATION_REQUIRED_MESSAGE}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {isPending
                ? "Your verification is being reviewed. This action unlocks as soon as it completes."
                : "Monitoring, alerts and analytics stay available while you verify."}
            </p>
          </div>
        </div>
        {!isPending && (
          <Button asChild size="sm">
            <Link to="/onboarding">Start verification</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

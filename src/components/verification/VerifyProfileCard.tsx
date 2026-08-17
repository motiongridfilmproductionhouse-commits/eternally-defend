import { Link } from "@tanstack/react-router";
import { BadgeCheck, Clock3, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useVerificationStatus } from "@/hooks/use-verification-status";
import { VERIFY_PROFILE_CARD } from "@/lib/verification/verification-status";

/**
 * Optional, dismissible invitation to verify. Never framed as an error and
 * never blocks monitoring.
 */
export function VerifyProfileCard({ className }: { className?: string }) {
  const { loading, status, accountType, onboardingCompleted } = useVerificationStatus();
  const [dismissed, setDismissed] = useState(false);

  if (loading || dismissed || status === "VERIFIED") return null;
  // Company accounts complete a company-authority flow instead of personal
  // identity verification — never nag them once company setup is finished.
  if (accountType === "enterprise" && onboardingCompleted) return null;

  const pending = status === "VERIFICATION_PENDING";

  return (
    <Card className={`card-surface relative border-primary/20 ${className ?? ""}`}>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            {pending ? <Clock3 className="size-5" /> : <ShieldCheck className="size-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              {pending ? "Verification in progress" : VERIFY_PROFILE_CARD.title}
              {pending && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  Pending
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {VERIFY_PROFILE_CARD.description}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!pending && (
            <Button asChild size="sm">
              <Link to="/onboarding">
                <BadgeCheck className="mr-1.5 size-4" />
                {VERIFY_PROFILE_CARD.primaryCta}
              </Link>
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
            {pending ? "Dismiss" : VERIFY_PROFILE_CARD.secondaryCta}
          </Button>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="absolute right-2 top-2 text-muted-foreground/60 hover:text-foreground sm:hidden"
        >
          <X className="size-4" />
        </button>
      </CardContent>
    </Card>
  );
}

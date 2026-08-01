import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  threatAlertBannerMessage,
  threatAlertCountLines,
  type ThreatAlertSummary,
} from "@/lib/deepfake/threat-alert";

export type ThreatAlertBannerProps = {
  summary: ThreatAlertSummary;
  ariaRole: "alert" | "status";
  prefersReducedMotion?: boolean;
  onReviewThreats: () => void;
  onViewAffectedDomains: () => void;
};

/**
 * In-app visual multi-threat banner only — no email/SMS/push/sound/takedown.
 */
export function ThreatAlertBanner({
  summary,
  ariaRole,
  prefersReducedMotion,
  onReviewThreats,
  onViewAffectedDomains,
}: ThreatAlertBannerProps) {
  const [reducedMotion, setReducedMotion] = useState(
    prefersReducedMotion ?? false,
  );
  useEffect(() => {
    if (typeof prefersReducedMotion === "boolean") {
      setReducedMotion(prefersReducedMotion);
      return;
    }
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [prefersReducedMotion]);

  if (summary.level !== "multiple") return null;

  const lines = threatAlertCountLines(summary);

  return (
    <div
      role={ariaRole}
      data-testid="multi-threat-alert-banner"
      data-reduced-motion={reducedMotion ? "true" : "false"}
      className={[
        "rounded-xl border border-red-500/45 bg-red-950/40 px-4 py-3 text-red-50",
        reducedMotion ? "" : "shadow-[0_0_28px_-10px_rgba(239,68,68,0.55)]",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="mt-0.5 size-4 shrink-0 text-red-300"
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-200">
            Multiple deepfake threats detected
          </div>
          <p className="text-sm text-red-50/95">
            {threatAlertBannerMessage(summary)}
          </p>
          <ul className="flex flex-wrap gap-2 text-[11px] text-red-100/90">
            {lines.map((line) => (
              <li
                key={line}
                className="rounded-full border border-red-400/30 bg-red-500/10 px-2.5 py-1"
              >
                {line}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 border-red-300/40 bg-red-500/10 text-red-50 hover:bg-red-500/20"
              onClick={onReviewThreats}
            >
              Review threats
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 border-red-300/40 bg-red-500/10 text-red-50 hover:bg-red-500/20"
              onClick={onViewAffectedDomains}
            >
              View affected domains
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

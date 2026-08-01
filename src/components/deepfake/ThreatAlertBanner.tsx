import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  shouldShowThreatAlertBanner,
  threatAlertBannerMessage,
  threatAlertCountLines,
  threatAlertHeadline,
  type ThreatAlertSummary,
} from "@/lib/deepfake/threat-alert";

export type ThreatAlertBannerProps = {
  summary: ThreatAlertSummary;
  ariaRole: "alert" | "status";
  scanStatus?: string | null;
  prefersReducedMotion?: boolean;
  onReviewThreats: () => void;
  onViewAffectedDomains: () => void;
  onContinueScan?: () => void;
  continuePending?: boolean;
  continueDisabled?: boolean;
};

/**
 * In-app visual multi-threat banner only — no email/SMS/push/sound/takedown.
 */
export function ThreatAlertBanner({
  summary,
  ariaRole,
  scanStatus,
  prefersReducedMotion,
  onReviewThreats,
  onViewAffectedDomains,
  onContinueScan,
  continuePending = false,
  continueDisabled = false,
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

  if (!shouldShowThreatAlertBanner(summary)) return null;

  const lines = threatAlertCountLines(summary);
  const headline =
    threatAlertHeadline(summary.tone) || "Multiple threats detected";
  const isRed = summary.tone === "red";
  const showContinue =
    scanStatus === "partial" && typeof onContinueScan === "function";

  return (
    <div
      role={ariaRole}
      data-testid="multi-threat-alert-banner"
      data-threat-tone={summary.tone}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      className={[
        "rounded-xl border px-4 py-3",
        isRed
          ? "border-red-500/50 bg-red-950/45 text-red-50"
          : "border-orange-500/45 bg-orange-950/40 text-orange-50",
        reducedMotion
          ? ""
          : isRed
            ? "shadow-[0_0_28px_-10px_rgba(239,68,68,0.55)]"
            : "shadow-[0_0_28px_-10px_rgba(249,115,22,0.45)]",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className={`mt-0.5 size-4 shrink-0 ${
            isRed ? "text-red-300" : "text-orange-300"
          }`}
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div
            className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${
              isRed ? "text-red-200" : "text-orange-200"
            }`}
          >
            {headline}
          </div>
          <p className="text-sm opacity-95">{threatAlertBannerMessage(summary)}</p>
          <ul className="flex flex-wrap gap-2 text-[11px] opacity-90">
            {lines.map((line) => (
              <li
                key={line}
                className={`rounded-full border px-2.5 py-1 ${
                  isRed
                    ? "border-red-400/30 bg-red-500/10"
                    : "border-orange-400/30 bg-orange-500/10"
                }`}
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
              className={`h-8 ${
                isRed
                  ? "border-red-300/40 bg-red-500/10 text-red-50 hover:bg-red-500/20"
                  : "border-orange-300/40 bg-orange-500/10 text-orange-50 hover:bg-orange-500/20"
              }`}
              onClick={onReviewThreats}
            >
              Review {summary.total} threat{summary.total === 1 ? "" : "s"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={`h-8 ${
                isRed
                  ? "border-red-300/40 bg-red-500/10 text-red-50 hover:bg-red-500/20"
                  : "border-orange-300/40 bg-orange-500/10 text-orange-50 hover:bg-orange-500/20"
              }`}
              onClick={onViewAffectedDomains}
            >
              View {summary.domains} affected domain
              {summary.domains === 1 ? "" : "s"}
            </Button>
            {showContinue ? (
              <Button
                type="button"
                size="sm"
                className="h-8"
                disabled={continueDisabled || continuePending}
                onClick={onContinueScan}
              >
                {continuePending ? "Starting…" : "Continue scan"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

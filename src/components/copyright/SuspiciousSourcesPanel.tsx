import { ExternalLink, Eye, Mail, ShieldCheck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PublicSuspiciousSource } from "@/lib/copyright/suspicious-sources";

const BAND: Record<string, { label: string; cls: string }> = {
  confirmed: { label: "90-100% EXACT", cls: "bg-red-600/15 text-red-400 border-red-600/40" },
  probable: { label: "70-89% PROBABLE", cls: "bg-orange-500/15 text-orange-400 border-orange-500/40" },
  review: { label: "50-69% REVIEW", cls: "bg-amber-400/15 text-amber-300 border-amber-400/40" },
};

const TYPE_LABEL: Record<string, string> = {
  VERIFIED_UNAUTHORIZED_STREAM: "Verified unauthorized stream",
  VERIFIED_UNAUTHORIZED_DOWNLOAD: "Verified unauthorized download",
  RIPPED_COPY: "Ripped copy",
  UNVERIFIED_LEAD: "Unverified lead",
};

const GROUPS: Array<{
  key: PublicSuspiciousSource["source_state"][];
  title: string;
  description: string;
}> = [
  {
    key: ["new_confirmed", "historical_reconfirmed"],
    title: "Confirmed active",
    description: "Current scan confirmed unauthorized distribution access evidence.",
  },
  {
    key: ["historical_preserved"],
    title: "Previously detected",
    description: "Confirmed in a prior scan — recheck pending or preserved snapshot.",
  },
  {
    key: ["historical_requires_review"],
    title: "Requires review",
    description: "Previously detected — current access evidence is inconclusive and needs review.",
  },
  {
    key: ["historical_unreachable"],
    title: "Currently unreachable",
    description: "Previously detected — page could not be reached this scan. Historical evidence preserved.",
  },
  {
    key: ["redirected", "removed"],
    title: "Redirected or moved",
    description: "Previously detected source redirected, changed domain, or was removed.",
  },
];

function stateBadge(source: PublicSuspiciousSource): { label: string; cls: string } {
  switch (source.source_state) {
    case "new_confirmed":
      return { label: "New confirmed", cls: "border-destructive/50 text-destructive" };
    case "historical_reconfirmed":
      return { label: "Historical reconfirmed", cls: "border-destructive/50 text-destructive" };
    case "historical_unreachable":
      return { label: "Previously detected — currently unreachable", cls: "border-orange-500/50 text-orange-500" };
    case "historical_requires_review":
      return {
        label: "Previously detected — requires review",
        cls: "border-amber-500/50 text-amber-500",
      };
    case "historical_preserved":
      return { label: "Previously detected", cls: "border-sky-500/50 text-sky-500" };
    case "redirected":
      return { label: "Redirected or moved", cls: "border-violet-500/50 text-violet-500" };
    case "removed":
      return { label: "Removed", cls: "border-muted-foreground/50 text-muted-foreground" };
    default:
      return { label: source.source_state, cls: "text-muted-foreground" };
  }
}

function SourceCard({
  source,
  onReview,
  onInvestigate,
  onDismiss,
}: {
  source: PublicSuspiciousSource;
  onReview: (matchId: string) => void;
  onInvestigate: (source: PublicSuspiciousSource) => void;
  onDismiss: (matchId: string) => void;
}) {
  const band = BAND[source.confidence_band ?? "review"] ?? BAND.review;
  const ev = (source.evidence ?? {}) as Record<string, unknown>;
  const dist = (ev.distribution ?? null) as null | {
    classification?: string;
    domain_risk?: string;
    release_timing?: string;
    release_offset_days?: number | null;
    piracy_indicators?: Array<{ key: string; detail: string; strong?: boolean }>;
    distribution_links?: string[];
    identity_evidence?: string[];
    access_evidence?: string[];
    confidence_breakdown?: {
      identity?: number;
      access?: number;
      releaseWindow?: number;
      penalties?: number;
    };
    evidence_screenshot?: string | null;
  };
  const contact = (source.contact ?? {}) as Record<string, string | null>;
  const classification = dist?.classification ?? source.classification;
  const riskCls =
    dist?.domain_risk === "high"
      ? "border-destructive/50 text-destructive"
      : dist?.domain_risk === "medium"
        ? "border-amber-500/50 text-amber-500"
        : "text-muted-foreground";
  const state = stateBadge(source);
  const breakdown = dist?.confidence_breakdown;

  return (
    <article className="rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur">
      <div className="flex gap-4">
        {dist?.evidence_screenshot && (
          <img
            src={dist.evidence_screenshot}
            alt={`Evidence frame from ${source.domain ?? "source"}`}
            loading="lazy"
            className="h-24 w-24 shrink-0 rounded-lg border border-border/60 object-cover"
          />
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {typeof source.confidence === "number" && (
              <Badge variant="outline" className={band.cls}>
                {source.confidence}% · {band.label}
              </Badge>
            )}
            <Badge variant="outline" className={`text-[10px] ${state.cls}`}>
              {state.label}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {TYPE_LABEL[classification] ?? classification}
            </Badge>
            {source.domain && (
              <Badge variant="outline" className="text-[10px]">
                {source.domain}
              </Badge>
            )}
            {dist && (
              <>
                <Badge variant="outline" className={`text-[10px] uppercase ${riskCls}`}>
                  {dist.domain_risk} risk
                </Badge>
                {dist.release_timing && dist.release_timing !== "unknown" && (
                  <Badge variant="outline" className="text-[10px]">
                    {dist.release_timing.replace(/_/g, " ")}
                    {typeof dist.release_offset_days === "number"
                      ? ` · +${dist.release_offset_days}d`
                      : ""}
                  </Badge>
                )}
              </>
            )}
            {source.review_status && source.review_status !== "pending" && (
              <Badge variant="outline" className="text-[10px]">
                {source.review_status.replace("_", " ")}
              </Badge>
            )}
          </div>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 truncate text-sm text-primary hover:underline"
          >
            Open source page <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
          <p className="truncate text-[11px] text-muted-foreground">
            {source.title || source.url}
          </p>
          {source.evidence_summary && (
            <p className="text-xs text-muted-foreground">{source.evidence_summary}</p>
          )}
          {source.reason && (
            <p className="text-xs text-muted-foreground">
              {source.reason} Evidence for rights-holder review — not a final legal determination.
            </p>
          )}
          {(dist?.identity_evidence?.length || dist?.access_evidence?.length) ? (
            <div className="space-y-1 text-[11px] text-muted-foreground">
              {dist?.identity_evidence?.length ? (
                <p>
                  <span className="font-medium">Title identity:</span>{" "}
                  {dist.identity_evidence.join(", ")}
                </p>
              ) : null}
              {dist?.access_evidence?.length ? (
                <p>
                  <span className="font-medium">Distribution access:</span>{" "}
                  {dist.access_evidence.slice(0, 3).join(" ")}
                </p>
              ) : null}
            </div>
          ) : null}
          {breakdown && (
            <p className="text-[11px] text-muted-foreground">
              <span className="font-medium">Confidence:</span> identity {breakdown.identity ?? 0}{" "}
              · access {breakdown.access ?? 0} · release {breakdown.releaseWindow ?? 0}
              {(breakdown.penalties ?? 0) > 0 ? ` · penalties -${breakdown.penalties}` : ""}
            </p>
          )}
          {dist?.piracy_indicators?.length ? (
            <ul className="space-y-1 rounded-lg border border-border/60 bg-background/40 p-2">
              {dist.piracy_indicators.slice(0, 6).map((i) => (
                <li key={i.key} className="flex gap-1.5 text-[11px] text-muted-foreground">
                  <span className={i.strong ? "text-destructive" : "text-primary"}>●</span>
                  <span>
                    <span className="font-medium">{i.key.replace(/_/g, " ")}:</span> {i.detail}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {contact.abuseEmail && (
              <span className="flex items-center gap-1">
                <Mail className="h-3 w-3" />
                {contact.abuseEmail}
              </span>
            )}
            {contact.reportUrl && (
              <a
                href={contact.reportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:underline"
              >
                <ShieldCheck className="h-3 w-3" />
                Abuse / DMCA page
              </a>
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => onReview(source.id)}>
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              Mark evidence ready
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onInvestigate(source)}>
              Website Details
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onDismiss(source.id)}>
              <XCircle className="mr-1.5 h-3.5 w-3.5" />
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function SuspiciousSourcesPanel({
  sources,
  summaryLine,
  onReview,
  onInvestigate,
  onDismiss,
}: {
  sources: PublicSuspiciousSource[];
  summaryLine?: string | null;
  onReview: (matchId: string) => void;
  onInvestigate: (source: PublicSuspiciousSource) => void;
  onDismiss: (matchId: string) => void;
}) {
  if (!sources.length) {
    return (
      <p className="text-xs text-muted-foreground">
        No suspicious sources to display for this scan.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {summaryLine && (
        <p className="rounded-md border border-border/50 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
          {summaryLine}
        </p>
      )}
      {GROUPS.map((group) => {
        const items = sources.filter((s) => group.key.includes(s.source_state));
        if (!items.length) return null;
        return (
          <section key={group.title} className="space-y-3">
            <div>
              <h3 className="text-sm font-medium text-foreground">{group.title}</h3>
              <p className="text-xs text-muted-foreground">{group.description}</p>
            </div>
            <div className="space-y-3">
              {items.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source}
                  onReview={onReview}
                  onInvestigate={onInvestigate}
                  onDismiss={onDismiss}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

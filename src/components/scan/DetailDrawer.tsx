import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ExternalLink, User, Clock, Eye, TrendingUp, Flame, ShieldAlert } from "lucide-react";
import {
  cleanTitle,
  readableFromSlug,
  hostFromUrl,
  faviconUrl,
  viaProxy,
  youtubeThumbFromUrl,
} from "@/lib/media-utils";

export type DetailFinding = {
  id: string;
  title: string | null;
  description: string | null;
  permalink: string | null;
  canonical_url: string | null;
  source: string;
  source_type: string | null;
  author: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  reach: number | null;
  engagement: number | null;
  threat_score: number | null;
  severity: string | null;
  narrative_claim: string | null;
  risk_type: string | null;
  tags: string[];
  metrics?: Record<string, unknown> | null;
  source_metadata?: Record<string, unknown> | null;
  evidence_refs?: unknown[] | null;
  first_seen_at: string;
  last_seen_at: string;
  times_detected: number;
};

function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export function DetailDrawer({
  finding,
  open,
  onOpenChange,
  evidenceCount,
  enforcementStatus,
}: {
  finding: DetailFinding | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  evidenceCount: number;
  enforcementStatus: string | null;
}) {
  if (!finding)
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-xl" />
      </Sheet>
    );

  const url = finding.permalink ?? finding.canonical_url ?? "";
  const isYT = finding.source === "YouTube";
  const thumb = viaProxy(finding.thumbnail_url) ?? (isYT ? youtubeThumbFromUrl(url, "hq") : null);
  const displayTitle = cleanTitle(finding.title, readableFromSlug(url));
  const host = hostFromUrl(url);
  const favicon = faviconUrl(url);
  const metrics = finding.metrics;
  const sourceMetadata = finding.source_metadata;
  const classificationExplanation = metrics?.classification_explanation;
  const transcript = metrics?.transcript;
  const infrastructure = sourceMetadata?.infrastructure;
  const reporting = metrics?.reporting;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="line-clamp-2">{displayTitle}</SheetTitle>
          <SheetDescription>
            {finding.source_type || finding.source} · {finding.author || host}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {thumb && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="block rounded-lg overflow-hidden border border-border"
            >
              <img src={thumb} alt={displayTitle} className="w-full aspect-video object-cover" />
            </a>
          )}

          <div className="grid grid-cols-3 gap-2 text-xs">
            <Metric
              icon={<ShieldAlert className="size-3" />}
              label="Threat"
              value={
                typeof finding.threat_score === "number"
                  ? String(Math.round(finding.threat_score))
                  : "—"
              }
            />
            <Metric
              icon={<Eye className="size-3" />}
              label="Reach"
              value={typeof finding.reach === "number" ? fmt(finding.reach) : "—"}
            />
            <Metric
              icon={<TrendingUp className="size-3" />}
              label="Engagement"
              value={typeof finding.engagement === "number" ? fmt(finding.engagement) : "—"}
            />
            <Metric
              icon={<Flame className="size-3" />}
              label="Severity"
              value={finding.severity ?? "—"}
            />
            <Metric
              icon={<Clock className="size-3" />}
              label="Seen"
              value={String(finding.times_detected)}
            />
            <Metric
              icon={<User className="size-3" />}
              label="Evidence"
              value={String(evidenceCount)}
            />
          </div>

          {finding.description && (
            <Section title="Description">
              <p className="text-xs whitespace-pre-wrap text-muted-foreground">
                {finding.description}
              </p>
            </Section>
          )}

          {finding.narrative_claim && (
            <Section title="Narrative claim">
              <p className="text-xs">{finding.narrative_claim}</p>
            </Section>
          )}

          {finding.risk_type && (
            <Section title="Risk type">
              <p className="text-xs">{finding.risk_type}</p>
            </Section>
          )}

          {metrics && (
            <Section title="Investigation intelligence">
              {typeof metrics.relevance_score === "number" && (
                <p className="text-xs">
                  Business match: {metrics.relevance_score}/100 (
                  {String(metrics.relevance_band || "review")})
                </p>
              )}
              {metrics.review_required === true && (
                <p className="text-xs text-amber-700">
                  Human review required before reporting or legal escalation.
                </p>
              )}
              {typeof classificationExplanation === "string" && (
                <p className="text-xs text-muted-foreground">{classificationExplanation}</p>
              )}
              {typeof transcript === "string" && (
                <Section title="Transcript">
                  <p className="text-xs whitespace-pre-wrap text-muted-foreground">{transcript}</p>
                </Section>
              )}
              {Array.isArray(metrics.screenshot_urls) && (
                <p className="text-xs">Screenshots preserved: {metrics.screenshot_urls.length}</p>
              )}
            </Section>
          )}

          {infrastructure != null && typeof infrastructure === "object" && (
            <Section title="Infrastructure intelligence">
              <p className="text-xs">
                Registrar:{" "}
                {String((infrastructure as Record<string, unknown>).registrar || "Not available")}
              </p>
              <p className="text-xs">
                CDN: {String((infrastructure as Record<string, unknown>).cdn || "Not detected")}
              </p>
              <p className="text-xs">
                Abuse contact:{" "}
                {String((infrastructure as Record<string, unknown>).abuse_email || "Not available")}
              </p>
              <p className="text-xs">
                Country:{" "}
                {String((infrastructure as Record<string, unknown>).country || "Not available")}
              </p>
            </Section>
          )}

          {reporting != null && typeof reporting === "object" && (
            <Section title="Draft reporting options">
              <p className="text-xs text-muted-foreground">
                Draft only. No report is submitted automatically.
              </p>
              {typeof (reporting as Record<string, unknown>).reporting_path === "string" && (
                <a
                  className="text-xs text-primary hover:underline"
                  href={String((reporting as Record<string, unknown>).reporting_path)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open platform reporting path
                </a>
              )}
              {typeof (reporting as Record<string, unknown>).website_contact_page === "string" && (
                <a
                  className="block text-xs text-primary hover:underline"
                  href={String((reporting as Record<string, unknown>).website_contact_page)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open website contact page
                </a>
              )}
            </Section>
          )}

          <Section title="Enforcement">
            <p className="text-xs">
              Status: <span className="font-semibold">{enforcementStatus ?? "Not started"}</span>
            </p>
            <p className="text-xs text-muted-foreground">Evidence records: {evidenceCount}</p>
          </Section>

          {finding.tags?.length ? (
            <Section title="Tags">
              <div className="flex flex-wrap gap-1">
                {finding.tags.map((t) => (
                  <span
                    key={t}
                    className="text-[10px] px-2 py-0.5 rounded-full border border-border bg-muted/40"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </Section>
          ) : null}

          <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2 border-t border-border">
            <span>First seen {new Date(finding.first_seen_at).toLocaleString()}</span>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <ExternalLink className="size-3" /> Open full page
              </a>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2 bg-background/60">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="text-sm font-bold tabular-nums truncate">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
        {title}
      </div>
      {children}
    </div>
  );
}

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileImage,
  XCircle,
} from "lucide-react";
import type { ClientFinding, RiskLevel } from "@/lib/deepfake/results-dashboard";
import {
  asRiskLevel,
  evidenceLinkProps,
  findingDomain,
  formatDash,
  formatEvidenceConfidence,
  formatTimestamp,
  resolveSafeFindingThumbnail,
} from "@/lib/deepfake/results-dashboard";

const RISK_STYLE: Record<RiskLevel, string> = {
  CRITICAL: "bg-red-600/20 text-red-400 border-red-500/50",
  HIGH: "bg-orange-500/20 text-orange-300 border-orange-500/50",
  MEDIUM: "bg-amber-400/20 text-amber-300 border-amber-400/50",
  LOW: "bg-emerald-500/20 text-emerald-300 border-emerald-500/50",
};

export function IntelligenceFindingCard({
  finding,
  discoveries,
  onUpdate,
  pending,
  isNew = false,
  reduceMotion = false,
  selected = false,
  cardRef,
}: {
  finding: ClientFinding;
  discoveries?: Array<{
    page_url?: string | null;
    canonical_url?: string | null;
    thumbnail_url?: string | null;
    image_url?: string | null;
  }>;
  onUpdate: (status: "reviewed" | "dismissed" | "queued_takedown") => void;
  pending: boolean;
  isNew?: boolean;
  reduceMotion?: boolean;
  selected?: boolean;
  cardRef?: (node: HTMLElement | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const risk = asRiskLevel(finding.risk_level);
  const evidence = evidenceLinkProps(finding);
  const domain = findingDomain(finding);
  const thumbnail = resolveSafeFindingThumbnail({ finding, discoveries });

  return (
    <article
      ref={cardRef}
      id={`finding-${finding.id}`}
      className={[
        "rounded-xl border bg-[#0a1628] p-3.5 text-slate-100 outline-none",
        selected ? "border-cyan-400/70 ring-1 ring-cyan-400/40" : "border-sky-500/20",
        isNew && !reduceMotion ? "animate-pulse shadow-[0_0_24px_rgba(34,211,238,0.18)]" : "",
      ].join(" ")}
      tabIndex={0}
      aria-expanded={expanded}
    >
      <div className="flex items-start gap-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/40">
          {thumbnail ? (
            <>
              <img
                src={thumbnail}
                alt=""
                className={[
                  "h-full w-full object-cover transition",
                  revealed ? "blur-0" : "blur-md scale-105",
                ].join(" ")}
              />
              {!revealed && (
                <button
                  type="button"
                  className="absolute inset-0 flex items-center justify-center bg-black/55 px-1 text-center text-[9px] leading-tight text-slate-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    setRevealed(true);
                  }}
                >
                  Sensitive evidence — click to reveal.
                </button>
              )}
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-500">
              <FileImage className="size-6" aria-hidden />
              <span className="sr-only">No safe evidence thumbnail</span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${RISK_STYLE[risk]}`}
            >
              {risk}
            </span>
            <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-300">
              {(finding.finding_classification ?? "—").replace(/_/g, " ")}
            </span>
            <Badge variant="outline" className="border-cyan-500/40 text-[10px] text-cyan-300">
              URL Verified
            </Badge>
            <span className="text-[10px] uppercase tracking-wider text-slate-500">
              {formatDash(finding.review_status)}
            </span>
          </div>

          <h4 className="mt-1.5 truncate text-sm font-semibold text-white">
            {finding.page_title || "Verified evidence page"}
          </h4>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
            <span>Domain · {domain}</span>
            <span>
              Identity ·{" "}
              {formatEvidenceConfidence({
                value: finding.identity_confidence,
                kind: "identity",
                finding,
              })}
            </span>
            <span>
              Synthetic ·{" "}
              {formatEvidenceConfidence({
                value: finding.synthetic_media_confidence,
                kind: "synthetic",
                finding,
              })}
            </span>
            <span>Page · {formatDash(finding.page_type?.replace(/_/g, " "))}</span>
            <span>
              Verified ·{" "}
              {formatTimestamp(finding.crawled_at || finding.created_at)}
            </span>
          </div>

          {evidence.kind === "link" ? (
            <div className="mt-2 relative z-10 flex flex-wrap items-center gap-2">
              <a
                href={evidence.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                <ExternalLink className="size-3" aria-hidden />
                Open verified evidence page
              </a>
              {evidence.domain ? (
                <span className="text-[11px] text-slate-500">{evidence.domain}</span>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-slate-500">
              Evidence URL unavailable.
            </p>
          )}
        </div>

        <button
          type="button"
          className="shrink-0 rounded border border-white/10 p-1.5 text-slate-300 hover:bg-white/5"
          aria-label={expanded ? "Collapse finding" : "Expand finding"}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-white/10 pt-3 text-[12px] text-slate-300">
          {finding.snippet ? (
            <p>
              <span className="text-slate-500">Snippet · </span>
              {finding.snippet}
            </p>
          ) : null}
          {(finding.classification_explanation || finding.ai_reasoning) && (
            <p>
              <span className="text-slate-500">Classification · </span>
              {finding.classification_explanation || finding.ai_reasoning}
            </p>
          )}
          {(finding.matched_evidence?.length ?? 0) > 0 && (
            <p>
              <span className="text-slate-500">Matched evidence · </span>
              {(finding.matched_evidence ?? []).join(", ")}
            </p>
          )}
          <p>
            <span className="text-slate-500">Final verified URL · </span>
            {formatDash(finding.final_url || finding.canonical_url)}
          </p>
          <p>
            <span className="text-slate-500">HTTP · </span>
            {formatDash(finding.http_status)}
          </p>
          {(finding.redirect_chain?.length ?? 0) > 1 && (
            <p>
              <span className="text-slate-500">Redirect chain · </span>
              {(finding.redirect_chain ?? []).join(" → ")}
            </p>
          )}
          {finding.canonical_url && (
            <p>
              <span className="text-slate-500">Canonical · </span>
              {finding.canonical_url}
            </p>
          )}
          <p>
            <span className="text-slate-500">Identity evidence · </span>
            {formatEvidenceConfidence({
              value: finding.identity_confidence,
              kind: "identity",
              finding,
            })}
            {finding.face_referenced ? " · face referenced" : ""}
          </p>
          <p>
            <span className="text-slate-500">Synthetic / impersonation · </span>
            {formatEvidenceConfidence({
              value: finding.synthetic_media_confidence,
              kind: "synthetic",
              finding,
            })}
            {finding.is_synthetic ? " · synthetic markers" : ""}
          </p>

          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-white/15 bg-transparent px-2 text-[11px] text-slate-100"
              disabled={pending}
              onClick={() => onUpdate("reviewed")}
            >
              <CheckCircle2 className="mr-1 size-3" /> Review
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-white/15 bg-transparent px-2 text-[11px] text-slate-100"
              disabled={pending}
              onClick={() => onUpdate("dismissed")}
            >
              <XCircle className="mr-1 size-3" /> Dismiss
            </Button>
            <Button
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={pending}
              onClick={() => onUpdate("queued_takedown")}
            >
              Queue takedown
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

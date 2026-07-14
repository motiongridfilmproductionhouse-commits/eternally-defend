import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { severityColor } from "@/lib/data-store";
import { cleanTitle, faviconUrl, hostFromUrl, readableFromSlug, viaProxy, youtubeThumbFromUrl } from "@/lib/media-utils";
import { addEvidenceForHit, hideScanHit, unhideScanHit } from "@/lib/scan-actions.functions";
import {
  Eye, EyeOff, ExternalLink, Globe, Loader2, MoreVertical, ShieldPlus, FilePlus2, Gavel,
  Youtube, Clock, FileText, Undo2, Ban,
} from "lucide-react";
import type { DetailFinding } from "./DetailDrawer";
import type { ActionTarget } from "./ActionDrawer";

export type HitLike = DetailFinding & {
  is_new_since_last_scan: boolean;
  hidden_at?: string | null;
};

function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export function PersistedResultCard({
  hit,
  selected,
  onToggleSelected,
  onOpenDetail,
  onTakeAction,
  onChanged,
  evidenceCount,
  status,
  hiddenView,
}: {
  hit: HitLike;
  selected: boolean;
  onToggleSelected: (id: string, checked: boolean) => void;
  onOpenDetail: (h: HitLike) => void;
  onTakeAction: (t: ActionTarget) => void;
  onChanged: () => void;
  evidenceCount: number;
  status: string | null;
  hiddenView: boolean;
}) {
  const addEvidence = useServerFn(addEvidenceForHit);
  const hideFn = useServerFn(hideScanHit);
  const unhideFn = useServerFn(unhideScanHit);
  const [busy, setBusy] = useState<null | "evidence" | "hide">(null);

  const url = hit.permalink ?? hit.canonical_url ?? "";
  const isYT = hit.source === "YouTube";
  const thumb = viaProxy(hit.thumbnail_url) ?? (isYT ? youtubeThumbFromUrl(url, "hq") : null);
  const displayTitle = cleanTitle(hit.title, readableFromSlug(url));
  const host = hostFromUrl(url);
  const favicon = faviconUrl(url);

  const target: ActionTarget = useMemo(() => ({
    id: hit.id,
    title: displayTitle,
    url,
    source: hit.source,
    platform: hit.source_type || hit.source,
    threatScore: hit.threat_score,
    evidenceCount,
    status,
    author: hit.author,
  }), [hit, url, displayTitle, evidenceCount, status]);

  const handleAddEvidence = async () => {
    setBusy("evidence");
    try {
      await addEvidence({ data: { scanHitId: hit.id } });
      toast.success("Evidence saved");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save evidence");
    } finally {
      setBusy(null);
    }
  };

  const handleHide = async () => {
    setBusy("hide");
    try {
      await hideFn({ data: { scanHitId: hit.id, reason: "user_hidden" } });
      toast.success("Finding hidden");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to hide");
    } finally {
      setBusy(null);
    }
  };

  const handleUnhide = async () => {
    setBusy("hide");
    try {
      await unhideFn({ data: { scanHitId: hit.id } });
      toast.success("Finding restored");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to unhide");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden hover:shadow-md transition flex flex-col group relative">
      {/* Selection checkbox */}
      <div className="absolute top-2 left-2 z-10">
        <div className="rounded bg-background/85 backdrop-blur border border-border p-1 shadow-sm">
          <Checkbox
            checked={selected}
            onCheckedChange={(v) => onToggleSelected(hit.id, v === true)}
            aria-label="Select finding"
          />
        </div>
      </div>

      {/* Menu */}
      <div className="absolute top-2 right-2 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger className="size-7 rounded bg-background/85 backdrop-blur border border-border grid place-items-center hover:bg-accent">
            <MoreVertical className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">Actions</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => url && window.open(url, "_blank", "noreferrer")}>
              <ExternalLink className="size-3.5 mr-2" /> Open source
            </DropdownMenuItem>
            {isYT && (
              <>
                <DropdownMenuItem onSelect={() => url && window.open(url, "_blank", "noreferrer")}>
                  <Youtube className="size-3.5 mr-2" /> Watch video
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onOpenDetail(hit)}>
                  <Clock className="size-3.5 mr-2" /> View exact moments
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onSelect={() => onOpenDetail(hit)}>
              <Eye className="size-3.5 mr-2" /> View details
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onTakeAction(target)}>
              <Gavel className="size-3.5 mr-2" /> Take action
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleAddEvidence}>
              <FilePlus2 className="size-3.5 mr-2" /> Add evidence
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => toast.info("Reports export coming soon")}>
              <FileText className="size-3.5 mr-2" /> Generate report
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {hiddenView ? (
              <>
                <DropdownMenuItem onSelect={handleUnhide}>
                  <Undo2 className="size-3.5 mr-2" /> Unhide finding
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleHide} className="text-destructive focus:text-destructive">
                  <Ban className="size-3.5 mr-2" /> Mark false positive
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onSelect={handleHide} className="text-destructive focus:text-destructive">
                <EyeOff className="size-3.5 mr-2" /> Hide finding
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <button
        type="button"
        onClick={() => onOpenDetail(hit)}
        className="text-left block w-full"
      >
        {thumb ? (
          <div className="aspect-video bg-muted overflow-hidden">
            <img src={thumb} alt={displayTitle} loading="lazy" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
          </div>
        ) : (
          <div className="aspect-video bg-gradient-to-br from-muted/60 to-secondary/60 flex flex-col items-center justify-center gap-1.5">
            {favicon ? <img src={favicon} alt="" className="size-8 rounded bg-white/80 p-1 shadow-sm" /> : <Globe className="size-5 text-muted-foreground" />}
            <div className="text-[10px] font-semibold text-foreground/80 truncate max-w-[80%] text-center">{host ?? hit.source}</div>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{hit.source}</div>
          </div>
        )}
        <div className="p-3 flex-1 flex flex-col">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            {hit.is_new_since_last_scan && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500 text-white">NEW</span>}
            {hit.severity && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white" style={{ background: severityColor(hit.severity as never) }}>
                {hit.severity.toUpperCase()}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground truncate">{hit.source}</span>
            {hit.published_at && (
              <span className="text-[10px] text-muted-foreground ml-auto">
                {new Date(hit.published_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              </span>
            )}
          </div>
          <div className="text-sm font-semibold line-clamp-2">{displayTitle}</div>
          {hit.description && <div className="text-[11px] text-muted-foreground line-clamp-2 mt-1">{hit.description}</div>}
          <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
            {typeof hit.threat_score === "number" && <span>Threat {Math.round(hit.threat_score)}</span>}
            {typeof hit.reach === "number" && hit.reach > 0 && <span>Reach {fmt(hit.reach)}</span>}
            {hit.times_detected > 1 && <span>Seen ×{hit.times_detected}</span>}
          </div>
        </div>
      </button>

      {/* Footer — always visible action bar */}
      <div className="border-t border-border bg-muted/30 px-3 py-2 flex items-center justify-between gap-2">
        <div className="text-[10px] text-muted-foreground flex items-center gap-2 min-w-0">
          <span className="font-semibold text-foreground">Ev {evidenceCount}</span>
          {status && <span className="truncate">· {status}</span>}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onOpenDetail(hit)}
            className="text-[10px] px-2 py-1 rounded border border-border hover:bg-accent inline-flex items-center gap-1"
            title="View evidence"
          >
            <Eye className="size-3" /> View
          </button>
          <button
            onClick={handleAddEvidence}
            disabled={busy === "evidence"}
            className="text-[10px] px-2 py-1 rounded border border-border hover:bg-accent inline-flex items-center gap-1 disabled:opacity-50"
            title="Add evidence"
          >
            {busy === "evidence" ? <Loader2 className="size-3 animate-spin" /> : <ShieldPlus className="size-3" />} Add
          </button>
          <button
            onClick={() => onTakeAction(target)}
            className="text-[10px] px-2 py-1 rounded text-white font-semibold inline-flex items-center gap-1"
            style={{ background: "var(--gradient-brand)" }}
          >
            <Gavel className="size-3" /> Action
          </button>
        </div>
      </div>
    </div>
  );
}

// Re-export DetailDrawer type usage helpers for parents
export { }; export type { DetailFinding } from "./DetailDrawer";

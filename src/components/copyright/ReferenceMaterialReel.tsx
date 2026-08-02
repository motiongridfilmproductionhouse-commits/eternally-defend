import { useEffect, useMemo, useState } from "react";
import {
  Film,
  Globe,
  Image as ImageIcon,
  Loader2,
  Play,
  Radar,
  Search,
  Youtube,
} from "lucide-react";
import {
  parseRecentActivity,
  providerDisplayLabel,
  scanActivityStageLabel,
  type ScanActivityEvent,
} from "@/lib/copyright/scan-activity";
import {
  parseReferenceMaterials,
  type ReferenceMaterial,
  type ReferenceMaterialClassification,
} from "@/lib/copyright/reference-materials";
import { proxiedReferenceImageUrl } from "@/lib/copyright/reference-images";
import {
  parseSourceActivity,
  type SourceActivityEntry,
  type SourceActivityStatus,
} from "@/lib/copyright/source-activity";

export interface ReferenceMaterialReelProps {
  originalPreview?: string | null;
  title: string;
  stats?: Record<string, unknown> | null;
  scanStatus?: string | null;
  reducedMotion?: boolean;
  /** When true, reel animates immediately (used during live scan UI). */
  forceLive?: boolean;
}

type ReelCardKind = "poster" | "video" | "provider" | "website" | "status";

interface ReelCard {
  key: string;
  kind: ReelCardKind;
  title: string;
  subtitle?: string | null;
  imageUrl?: string | null;
  badge?: string;
  classification?: ReferenceMaterialClassification | string;
  provider?: string;
  status?: string;
  pulse?: boolean;
}

const REEL_DURATION_S = 30;

const DEFAULT_SEARCHING_CARDS: ReelCard[] = [
  {
    key: "status-firecrawl",
    kind: "status",
    title: "Firecrawl",
    subtitle: "Searching public web sources",
    badge: "Searching",
    provider: "firecrawl",
    pulse: true,
  },
  {
    key: "status-youtube",
    kind: "status",
    title: "YouTube",
    subtitle: "Discovering trailers & reviews",
    badge: "Searching",
    provider: "youtube",
    pulse: true,
  },
  {
    key: "status-trailers",
    kind: "status",
    title: "Trailer discovery",
    subtitle: "Scanning video platforms",
    badge: "Live",
    pulse: true,
  },
  {
    key: "status-reviews",
    kind: "status",
    title: "Review discovery",
    subtitle: "Collecting review thumbnails",
    badge: "Live",
    pulse: true,
  },
  {
    key: "status-websites",
    kind: "status",
    title: "Website investigation",
    subtitle: "Checking candidate pages",
    badge: "Live",
    pulse: true,
  },
];

function isActiveScan(status: string | null | undefined): boolean {
  return status === "queued" || status === "running" || status === "pending";
}

function classificationTone(cls: string): string {
  switch (cls) {
    case "Official":
    case "Promotional":
      return "border-sky-500/40 bg-sky-500/10 text-sky-200";
    case "Review":
    case "Reaction":
    case "News":
      return "border-violet-500/40 bg-violet-500/10 text-violet-200";
    case "Verified evidence":
    case "Potential distribution":
      return "border-amber-500/40 bg-amber-500/10 text-amber-200";
    case "Rejected":
      return "border-border/50 bg-muted/20 text-muted-foreground";
    default:
      return "border-primary/30 bg-primary/10 text-primary-foreground/90";
  }
}

function providerStatusTone(status: SourceActivityStatus | string): string {
  switch (status) {
    case "searching":
      return "border-primary/40 bg-primary/10 text-primary";
    case "completed":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "failed":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "no_results":
      return "border-amber-500/40 bg-amber-500/10 text-amber-200";
    default:
      return "border-border/50 bg-background/30 text-muted-foreground";
  }
}

function materialTypeLabel(type: string): string {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function materialToCard(m: ReferenceMaterial): ReelCard {
  const isVideo = Boolean(m.video_url);
  return {
    key: m.id,
    kind: isVideo ? "video" : "poster",
    title: m.title ?? m.source_domain ?? "Discovered material",
    subtitle: m.channel_name ?? m.source_domain,
    imageUrl: m.image_url ? proxiedReferenceImageUrl(m.image_url) : null,
    badge: materialTypeLabel(m.material_type),
    classification: m.classification,
    provider: m.provider,
    status: m.status,
  };
}

function providerToCard(entry: SourceActivityEntry): ReelCard {
  return {
    key: `provider-${entry.provider}`,
    kind: "provider",
    title: entry.label,
    subtitle: `${entry.requests} req · ${entry.candidates} found · ${entry.failures} fail`,
    badge: entry.status,
    provider: entry.provider,
    status: entry.status,
    pulse: entry.status === "searching" || entry.status === "queued",
  };
}

function websiteToCard(event: ScanActivityEvent): ReelCard {
  return {
    key: `web-${event.id}`,
    kind: "website",
    title: event.hostname,
    subtitle: event.page_label,
    badge: scanActivityStageLabel(event.stage),
    classification: event.threat_label,
    provider: event.provider,
    status: event.stage,
    pulse: event.threat === "checking",
  };
}

function buildReelCards(input: {
  materials: ReferenceMaterial[];
  providers: SourceActivityEntry[];
  websites: ScanActivityEvent[];
  active: boolean;
}): ReelCard[] {
  const cards: ReelCard[] = [];
  const providerKeys = new Set(input.providers.map((p) => p.provider));

  if (input.active && input.providers.length === 0) {
    cards.push(...DEFAULT_SEARCHING_CARDS);
  } else if (input.active) {
    for (const placeholder of DEFAULT_SEARCHING_CARDS) {
      if (placeholder.provider && providerKeys.has(placeholder.provider)) continue;
      cards.push(placeholder);
    }
  }

  for (const p of input.providers) {
    cards.push(providerToCard(p));
  }

  for (const m of input.materials) {
    cards.push(materialToCard(m));
  }

  for (const w of input.websites.slice(0, 8)) {
    cards.push(websiteToCard(w));
  }

  return cards;
}

function ReelThumb({
  src,
  alt,
  className,
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  const [resolved, setResolved] = useState(src ?? "");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setResolved(src ?? "");
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div
        className={`grid place-items-center bg-gradient-to-br from-muted/30 to-muted/10 text-muted-foreground ${className ?? ""}`}
      >
        <ImageIcon className="h-6 w-6 opacity-60" />
      </div>
    );
  }

  return (
    <img
      src={resolved}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (resolved === src && src && !src.startsWith("/api/public/image-proxy")) {
          setResolved(proxiedReferenceImageUrl(src));
          return;
        }
        setFailed(true);
      }}
    />
  );
}

function ReelCardView({ card }: { card: ReelCard }) {
  const Icon =
    card.kind === "video"
      ? Play
      : card.kind === "provider"
        ? Radar
        : card.kind === "website"
          ? Globe
          : card.kind === "status"
            ? Search
            : Film;

  return (
    <article
      className={`relative flex h-[148px] w-[220px] shrink-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md ${
        card.pulse ? "ring-1 ring-primary/30" : ""
      }`}
    >
      <div className="relative h-[88px] overflow-hidden">
        {card.imageUrl ? (
          <>
            <ReelThumb
              src={card.imageUrl}
              alt={card.title}
              className="h-full w-full object-cover"
            />
            {card.kind === "video" && (
              <div className="absolute inset-0 grid place-items-center bg-black/20">
                <div className="grid h-9 w-9 place-items-center rounded-full border border-white/30 bg-black/40">
                  <Play className="ml-0.5 h-4 w-4 text-white" />
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-primary/10 via-transparent to-violet-500/10">
            <Icon className={`h-7 w-7 text-primary/70 ${card.pulse ? "animate-pulse" : ""}`} />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-black/30 to-transparent" />
        {card.pulse && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 animate-[scanLine_2.2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-primary to-transparent" />
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 px-3 py-2">
        <p className="truncate text-[11px] font-semibold leading-tight text-foreground">
          {card.title}
        </p>
        {card.subtitle && (
          <p className="truncate text-[10px] text-muted-foreground">{card.subtitle}</p>
        )}
        <div className="mt-auto flex flex-wrap gap-1">
          {card.badge && (
            <span
              className={`rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
                card.kind === "provider"
                  ? providerStatusTone(card.badge)
                  : "border border-border/40 bg-background/40 text-muted-foreground"
              }`}
            >
              {card.badge}
            </span>
          )}
          {card.classification && (
            <span
              className={`rounded border px-1.5 py-0.5 text-[9px] font-medium ${classificationTone(String(card.classification))}`}
            >
              {card.classification}
            </span>
          )}
          {card.provider && card.kind !== "provider" && (
            <span className="rounded border border-border/30 bg-background/20 px-1.5 py-0.5 text-[9px] text-muted-foreground">
              {providerDisplayLabel(card.provider as never) || card.provider}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

export function ReferenceMaterialReel({
  originalPreview,
  title,
  stats,
  scanStatus,
  reducedMotion = false,
  forceLive = false,
}: ReferenceMaterialReelProps) {
  const active = forceLive || isActiveScan(scanStatus ?? null);
  const completed = scanStatus === "completed" || scanStatus === "partial";
  const failed = scanStatus === "failed";

  const materials = useMemo(() => parseReferenceMaterials(stats), [stats]);
  const providers = useMemo(() => parseSourceActivity(stats), [stats]);
  const websites = useMemo(
    () => parseRecentActivity(stats).slice(0, 8),
    [stats],
  );

  const baseCards = useMemo(
    () =>
      buildReelCards({
        materials,
        providers,
        websites,
        active: active || completed || failed,
      }),
    [materials, providers, websites, active, completed, failed],
  );

  const loopCards = useMemo(() => {
    let cards = baseCards.length ? baseCards : DEFAULT_SEARCHING_CARDS;
    while (cards.length < 6) {
      cards = [...cards, ...DEFAULT_SEARCHING_CARDS];
    }
    return [...cards, ...cards];
  }, [baseCards]);

  const [paused, setPaused] = useState(false);
  const shouldAnimate = !reducedMotion && !paused && (active || completed);

  const statusLine = active
    ? "Searching public web and video sources"
    : failed
      ? "Scan ended — collected materials preserved"
      : completed
        ? "Title intelligence map complete"
        : "Building title intelligence map";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          Reference intelligence
        </p>
        {active && (
          <span className="flex items-center gap-1.5 text-[10px] text-primary">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            Live
          </span>
        )}
      </div>

      {/* Large original poster — always visible */}
      <div className="relative overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-b from-primary/5 to-transparent shadow-lg">
        <div className="relative aspect-[2/3] max-h-[280px] w-full overflow-hidden sm:max-h-[320px]">
          {originalPreview ? (
            <>
              <img
                src={originalPreview}
                alt={`Original reference for ${title}`}
                className="h-full w-full object-cover"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
              {active && !reducedMotion && (
                <div className="pointer-events-none absolute inset-x-0 top-0 h-16 animate-[scanLine_2.8s_ease-in-out_infinite] bg-gradient-to-b from-primary/25 to-transparent" />
              )}
            </>
          ) : (
            <div className="grid h-full min-h-[200px] place-items-center text-muted-foreground">
              <ImageIcon className="h-10 w-10" />
            </div>
          )}
          <span className="absolute bottom-2 left-2 rounded-md border border-primary/40 bg-black/55 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground backdrop-blur-sm">
            Original reference
          </span>
        </div>
        <p className="px-3 py-2 text-[11px] text-muted-foreground">{statusLine}</p>
      </div>

      {/* Mixed media intelligence reel */}
      <div
        className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/20 shadow-inner"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-background to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-background to-transparent" />

        <div
          className={`flex w-max gap-3 p-3 ${shouldAnimate ? "animate-[intelReel_var(--reel-duration)_linear_infinite]" : "overflow-x-auto"}`}
          style={{ ["--reel-duration" as string]: `${REEL_DURATION_S}s` }}
        >
          {loopCards.map((card, index) => (
            <ReelCardView key={`${card.key}-${index}`} card={card} />
          ))}
        </div>
      </div>

      {/* Provider activity strip */}
      {providers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {providers.map((entry) => (
            <div
              key={entry.provider}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[10px] ${providerStatusTone(entry.status)}`}
            >
              {entry.provider === "youtube" ? (
                <Youtube className="h-3.5 w-3.5 shrink-0" />
              ) : entry.status === "searching" ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : (
                <Radar className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="font-semibold">{entry.label}</span>
              <span className="opacity-80">{entry.status}</span>
              <span className="tabular-nums opacity-70">
                {entry.candidates}c · {entry.requests}r
              </span>
            </div>
          ))}
        </div>
      )}

      {import.meta.env.DEV && (
        <div className="rounded border border-dashed border-border/50 bg-background/20 px-2 py-1.5 text-[10px] text-muted-foreground">
          <p>reference_materials: {materials.length}</p>
          <p>reel cards: {baseCards.length}</p>
          <p>source_activity: {providers.length}</p>
          <p>websites in reel: {websites.length}</p>
        </div>
      )}

      <style>{`
        @keyframes intelReel {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes scanLine {
          0%, 100% { transform: translateY(-100%); opacity: 0.2; }
          50% { transform: translateY(180%); opacity: 0.7; }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[intelReel_var\\(--reel-duration\\)_linear_infinite\\],
          .animate-\\[scanLine_2\\.2s_ease-in-out_infinite\\],
          .animate-\\[scanLine_2\\.8s_ease-in-out_infinite\\] {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}

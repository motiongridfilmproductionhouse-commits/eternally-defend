import { useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import {
  parseReferenceImages,
  proxiedReferenceImageUrl,
  type ReferenceImage,
} from "@/lib/copyright/reference-images";

export interface ReferenceMaterialCarouselProps {
  originalPreview?: string | null;
  stats?: Record<string, unknown> | null;
  scanStatus?: string | null;
  reducedMotion?: boolean;
}

function isRunningStatus(status: string | null | undefined): boolean {
  return status === "queued" || status === "running" || status === "pending";
}

function CarouselImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [resolved, setResolved] = useState(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setResolved(src);
    setFailed(false);
  }, [src]);

  if (failed) {
    return (
      <div
        className={`grid place-items-center bg-muted/40 text-muted-foreground ${className ?? ""}`}
      >
        <ImageIcon className="h-5 w-5" />
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
        if (resolved === src && !src.startsWith("/api/public/image-proxy")) {
          setResolved(proxiedReferenceImageUrl(src));
          return;
        }
        setFailed(true);
      }}
    />
  );
}

function buildDisplayItems(
  originalPreview: string | null | undefined,
  discovered: ReferenceImage[],
): Array<{ key: string; src: string; label: string; isOriginal?: boolean }> {
  const items: Array<{ key: string; src: string; label: string; isOriginal?: boolean }> = [];
  if (originalPreview) {
    items.push({
      key: "original-reference",
      src: originalPreview,
      label: "Uploaded reference",
      isOriginal: true,
    });
  }
  for (const img of discovered) {
    items.push({
      key: `${img.image_url}::${img.page_url}`,
      src: proxiedReferenceImageUrl(img.image_url),
      label: img.title ?? img.source_domain ?? "Discovered reference",
    });
  }
  return items;
}

export function ReferenceMaterialCarousel({
  originalPreview,
  stats,
  scanStatus,
  reducedMotion = false,
}: ReferenceMaterialCarouselProps) {
  const running = isRunningStatus(scanStatus ?? null);
  const discovered = useMemo(() => parseReferenceImages(stats), [stats]);
  const displayItems = useMemo(
    () => buildDisplayItems(originalPreview, discovered),
    [originalPreview, discovered],
  );
  const loopItems = useMemo(() => {
    if (displayItems.length <= 1) return displayItems;
    return [...displayItems, ...displayItems];
  }, [displayItems]);

  const stripRef = useRef<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(false);
  const animate = !reducedMotion && displayItems.length > 1 && !paused;

  const showSkeleton = running && discovered.length === 0;
  const showStrip = displayItems.length > 0;

  const lastTelemetry =
    (typeof stats?.source_activity_updated_at === "string"
      ? stats.source_activity_updated_at
      : typeof stats?.last_progress_at === "string"
        ? stats.last_progress_at
        : null) ?? null;

  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Reference material
      </p>

      {showStrip && (
        <div
          className="group relative overflow-hidden rounded-lg border border-border/60 bg-background/40"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div
            ref={stripRef}
            className={`flex gap-2 overflow-x-auto p-2 scrollbar-thin ${
              animate ? "animate-[refCarousel_28s_linear_infinite]" : ""
            }`}
            style={{ scrollBehavior: reducedMotion ? "auto" : "smooth" }}
          >
            {loopItems.map((item, index) => (
              <div
                key={`${item.key}-${index}`}
                className={`relative h-28 w-40 shrink-0 overflow-hidden rounded-md border ${
                  item.isOriginal ? "border-primary/50 ring-1 ring-primary/30" : "border-border/50"
                }`}
              >
                <CarouselImage
                  src={item.src}
                  alt={item.label}
                  className="h-full w-full object-cover"
                />
                {item.isOriginal && (
                  <span className="absolute left-1 top-1 rounded bg-primary/90 px-1.5 py-0.5 text-[9px] font-semibold text-primary-foreground">
                    Original
                  </span>
                )}
              </div>
            ))}
          </div>
          {!reducedMotion && displayItems.length > 1 && (
            <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background/80 to-transparent" />
          )}
          {!reducedMotion && displayItems.length > 1 && (
            <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background/80 to-transparent" />
          )}
        </div>
      )}

      {showSkeleton && (
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-md border border-border/40 bg-muted/30"
            />
          ))}
        </div>
      )}

      {!showStrip && !showSkeleton && (
        <div className="grid h-28 place-items-center rounded-lg border border-border/60 bg-background/40 text-muted-foreground">
          <ImageIcon className="h-6 w-6" />
        </div>
      )}

      {import.meta.env.DEV && (
        <div className="rounded border border-dashed border-border/50 bg-background/20 px-2 py-1.5 text-[10px] text-muted-foreground">
          <p>reference_images: {discovered.length}</p>
          <p>
            source_activity:{" "}
            {typeof stats?.source_activity_count === "number"
              ? stats.source_activity_count
              : Array.isArray(stats?.source_activity)
                ? stats.source_activity.length
                : 0}
          </p>
          <p>telemetry: {lastTelemetry ?? "—"}</p>
          <p>first source_type: {discovered[0]?.source_type ?? "—"}</p>
          <p>
            first provider status:{" "}
            {Array.isArray(stats?.source_activity) &&
            stats.source_activity[0] &&
            typeof stats.source_activity[0] === "object"
              ? String((stats.source_activity[0] as Record<string, unknown>).status ?? "—")
              : "—"}
          </p>
        </div>
      )}

      <style>{`
        @keyframes refCarousel {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[refCarousel_28s_linear_infinite\\] {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}

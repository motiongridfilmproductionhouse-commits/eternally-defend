/**
 * Pure helpers for bulk social asset protection.
 *
 * The bulk flows are thin orchestration over the SAME single-item pipeline:
 * every link and every file is validated, ingested, fingerprinted and enrolled
 * on its own. These helpers only decide what is worth submitting, keep a batch
 * free of internal duplicates, and describe per-item status.
 */

export const BATCH_ITEM_STATUSES = [
  "ready",
  "duplicate",
  "unsupported",
  "upload_required",
  "processing",
  "protected",
  "failed",
] as const;

export type BatchItemStatus = (typeof BATCH_ITEM_STATUSES)[number];

export const BATCH_STATUS_LABEL: Record<BatchItemStatus, string> = {
  ready: "Ready",
  duplicate: "Duplicate",
  unsupported: "Unsupported",
  upload_required: "Upload required",
  processing: "Processing",
  protected: "Protected",
  failed: "Failed",
};

export const BATCH_STATUS_TONE: Record<BatchItemStatus, string> = {
  ready: "border-border text-muted-foreground",
  duplicate: "border-amber-500/40 text-amber-400",
  unsupported: "border-destructive/40 text-destructive",
  upload_required: "border-amber-500/40 text-amber-400",
  processing: "border-sky-500/40 text-sky-400",
  protected: "border-emerald-500/40 text-emerald-400",
  failed: "border-destructive/40 text-destructive",
};

/** Markers that identify a single public post/reel/video permalink. */
const POST_MARKER =
  /\/(p|reel|reels|tv|status|video|shorts|watch)\/|youtu\.be\/[\w-]{6,}|[?&]v=[\w-]{6,}/i;

export const PROFILE_URL_MESSAGE =
  "This is a profile page, not a post. Add profiles under Social Profile Protection.";

export function isSupportedPostUrl(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (!url.hostname.includes(".")) return false;
    return POST_MARKER.test(url.pathname + url.search);
  } catch {
    return false;
  }
}

/** Canonical dedupe form for pasted links: host + path, no query/hash/trailing slash. */
export function canonicalLinkKey(raw: string): string {
  const value = raw.trim();
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return `${host}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

export interface ParsedBatchLink {
  url: string;
  status: Extract<BatchItemStatus, "ready" | "duplicate" | "unsupported">;
  detail: string | null;
}

/**
 * Split a textarea into one candidate per line and classify each independently.
 * A bad line never removes the good ones.
 */
export function parseLinkBatch(input: string, alreadyKnownKeys: string[] = []): ParsedBatchLink[] {
  const seen = new Set(alreadyKnownKeys.map((k) => k.toLowerCase()));
  const out: ParsedBatchLink[] = [];
  for (const line of input.split(/[\r\n,\s]+/)) {
    const url = line.trim();
    if (!url) continue;
    if (!isSupportedPostUrl(url)) {
      out.push({
        url,
        status: "unsupported",
        detail: /^https?:\/\//i.test(url) ? PROFILE_URL_MESSAGE : "Not a valid post link.",
      });
      continue;
    }
    const key = canonicalLinkKey(url);
    if (seen.has(key)) {
      out.push({ url, status: "duplicate", detail: "Already in this batch or already protected." });
      continue;
    }
    seen.add(key);
    out.push({ url, status: "ready", detail: null });
  }
  return out;
}

export const UPLOAD_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
] as const;

export const UPLOAD_MAX_BYTES = 15 * 1024 * 1024;

/** Per-file validation for a bulk selection. Existing limits unchanged. */
export function classifyUploadFile(file: { name: string; type: string; size: number }): {
  status: Extract<BatchItemStatus, "ready" | "unsupported">;
  detail: string | null;
} {
  if (!(UPLOAD_MEDIA_TYPES as readonly string[]).includes(file.type)) {
    return { status: "unsupported", detail: "Use JPG, PNG, WEBP, GIF, MP4 or MOV." };
  }
  if (file.size <= 0) return { status: "unsupported", detail: "File is empty." };
  if (file.size > UPLOAD_MAX_BYTES) {
    return { status: "unsupported", detail: "File is larger than 15 MB." };
  }
  return { status: "ready", detail: null };
}

/** Identity for files inside one selection so the same pick isn't queued twice. */
export function fileKey(file: { name: string; size: number; lastModified?: number }): string {
  return `${file.name}|${file.size}|${file.lastModified ?? 0}`.toLowerCase();
}

export interface BatchTotals {
  selected: number;
  processing: number;
  protected: number;
  duplicates: number;
  uploadRequired: number;
  failed: number;
  unsupported: number;
  ready: number;
}

export function summarizeBatch(statuses: BatchItemStatus[]): BatchTotals {
  const count = (s: BatchItemStatus) => statuses.filter((x) => x === s).length;
  return {
    selected: statuses.length,
    processing: count("processing"),
    protected: count("protected"),
    duplicates: count("duplicate"),
    uploadRequired: count("upload_required"),
    failed: count("failed"),
    unsupported: count("unsupported"),
    ready: count("ready"),
  };
}

export const BATCH_FILTERS = [
  "all",
  "processing",
  "protected",
  "duplicates",
  "failed",
] as const;

export type BatchFilter = (typeof BATCH_FILTERS)[number];

export function matchesBatchFilter(status: BatchItemStatus, filter: BatchFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "processing":
      return status === "processing" || status === "ready";
    case "protected":
      return status === "protected";
    case "duplicates":
      return status === "duplicate";
    case "failed":
      return status === "failed" || status === "unsupported" || status === "upload_required";
  }
}

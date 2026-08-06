/**
 * Bounded title-detail follow queue with structured diagnostics.
 */

import { canonicalUrl, hostOf } from "./url.server";
import { isRecognizedExternalDetailHost } from "./page-extract.server";

export type DetailFollowSkipReason =
  | "no_links_extracted"
  | "listing_not_detected"
  | "title_score_below_threshold"
  | "duplicate"
  | "deadline"
  | "cross_domain"
  | "already_crawled"
  | "invalid_url"
  | "queue_limit_reached"
  | "depth_limit_reached"
  /** @deprecated use `duplicate` */
  | "duplicate_url"
  /** @deprecated use `cross_domain` */
  | "cross_domain_not_allowed"
  /** @deprecated use `title_score_below_threshold` */
  | "score_below_threshold"
  /** @deprecated use `deadline` */
  | "budget_exhausted"
  /** @deprecated use `deadline` */
  | "scan_deadline_reached"
  /** @deprecated use `title_score_below_threshold` */
  | "title_mismatch";

export interface DetailFollowLogEntry {
  at: string;
  event:
    | "listing_detected"
    | "links_extracted"
    | "title_candidates_scored"
    | "candidate_queued"
    | "candidate_skipped"
    | "candidate_crawled"
    | "evidence_result";
  url?: string;
  count?: number;
  reason?: DetailFollowSkipReason | string;
  detail?: string;
}

import { MAX_DEPTH, MAX_DETAIL_DRAIN, MAX_DETAIL_QUEUE } from "./discovery-config";

/** Recursive listing / mirror follow — do not stall after a handful of URLs. */
export const DETAIL_FOLLOW_MAX_QUEUE = MAX_DETAIL_QUEUE;
export const DETAIL_FOLLOW_MAX_PER_PAGE = 20;
/** Max outbound hop depth from a seed listing (movie → category → mirror). */
export const DETAIL_FOLLOW_MAX_DEPTH = MAX_DEPTH;
/** Per-drain batch size during the detail-follow phase (loop until empty). */
export const DETAIL_FOLLOW_DRAIN_CAP = MAX_DETAIL_DRAIN;

export interface DetailFollowQueuedItem {
  url: string;
  depth: number;
}

export class DetailFollowRecorder {
  private queue: DetailFollowQueuedItem[] = [];
  private seen = new Set<string>();
  private logs: DetailFollowLogEntry[] = [];
  private processed = 0;

  private log(
    event: DetailFollowLogEntry["event"],
    extra?: Omit<DetailFollowLogEntry, "at" | "event">,
  ): void {
    const entry: DetailFollowLogEntry = {
      at: new Date().toISOString(),
      event,
      ...extra,
    };
    this.logs.push(entry);
    if (typeof process !== "undefined" && process.env?.NODE_ENV !== "test") {
      const parts = [
        "[copyright-detail-follow]",
        event,
        extra?.url ?? "",
        extra?.reason ?? "",
        extra?.detail ?? "",
        extra?.count != null ? `count=${extra.count}` : "",
      ].filter(Boolean);
      console.info(parts.join(" "));
    }
  }

  recordListingDetected(url: string, linkCount: number): void {
    this.log("listing_detected", { url, count: linkCount });
  }

  recordLinksExtracted(url: string, count: number): void {
    this.log("links_extracted", { url, count });
  }

  recordTitleCandidatesScored(url: string, count: number): void {
    this.log("title_candidates_scored", { url, count });
  }

  enqueueCandidates(input: {
    pageUrl: string;
    candidates: string[];
    inspectedUrls: Set<string>;
    titles: string[];
    /** Depth of the page that discovered these candidates (children = fromDepth + 1). */
    fromDepth?: number;
  }): string[] {
    const pageHost = hostOf(input.pageUrl);
    const accepted: string[] = [];
    const childDepth = Math.max(0, (input.fromDepth ?? 0) + 1);
    this.recordTitleCandidatesScored(input.pageUrl, input.candidates.length);

    if (childDepth > DETAIL_FOLLOW_MAX_DEPTH) {
      for (const raw of input.candidates.slice(0, DETAIL_FOLLOW_MAX_PER_PAGE)) {
        this.log("candidate_skipped", {
          url: raw,
          reason: "depth_limit_reached",
          detail: `depth=${childDepth}`,
        });
      }
      return accepted;
    }

    for (const raw of input.candidates.slice(0, DETAIL_FOLLOW_MAX_PER_PAGE)) {
      if (this.queue.length >= DETAIL_FOLLOW_MAX_QUEUE) {
        this.log("candidate_skipped", {
          url: raw,
          reason: "queue_limit_reached",
        });
        continue;
      }
      let url: string;
      try {
        url = canonicalUrl(raw);
      } catch {
        this.log("candidate_skipped", { url: raw, reason: "invalid_url" });
        continue;
      }
      if (this.seen.has(url)) {
        this.log("candidate_skipped", { url, reason: "duplicate" });
        continue;
      }
      if (input.inspectedUrls.has(url)) {
        this.log("candidate_skipped", { url, reason: "already_crawled" });
        continue;
      }
      const host = hostOf(url);
      if (pageHost && host && host !== pageHost && !isRecognizedExternalDetailHost(url, pageHost)) {
        this.log("candidate_skipped", {
          url,
          reason: "cross_domain",
          detail: `${pageHost} -> ${host}`,
        });
        continue;
      }
      this.seen.add(url);
      this.queue.push({ url, depth: childDepth });
      accepted.push(url);
      this.log("candidate_queued", {
        url,
        detail: `depth=${childDepth}`,
      });
    }
    return accepted;
  }

  drain(limit = DETAIL_FOLLOW_MAX_QUEUE): DetailFollowQueuedItem[] {
    return this.queue.splice(0, limit);
  }

  remaining(): number {
    return this.queue.length;
  }

  peek(): string[] {
    return this.queue.map((item) => item.url);
  }

  recordCrawled(url: string): void {
    this.processed += 1;
    this.log("candidate_crawled", { url });
  }

  recordEvidenceResult(url: string, detail: string, reason?: string): void {
    this.log("evidence_result", { url, detail, reason });
  }

  recordSkipped(url: string, reason: DetailFollowSkipReason, detail?: string): void {
    this.log("candidate_skipped", { url, reason, detail });
  }

  getLogs(): DetailFollowLogEntry[] {
    return [...this.logs];
  }

  stats(): {
    detail_links_discovered: number;
    detail_pages_queued: number;
    detail_links_processed: number;
    detail_links_remaining: number;
  } {
    const discovered = this.logs
      .filter((l) => l.event === "title_candidates_scored")
      .reduce((sum, l) => sum + (l.count ?? 0), 0);
    const queued = this.logs.filter((l) => l.event === "candidate_queued").length;
    return {
      detail_links_discovered: discovered,
      detail_pages_queued: queued,
      detail_links_processed: this.processed,
      detail_links_remaining: this.queue.length,
    };
  }
}

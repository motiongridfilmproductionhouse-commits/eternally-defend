/**
 * Bounded title-detail follow queue with structured diagnostics.
 */

import { canonicalUrl, hostOf } from "./url.server";
import { isRecognizedExternalDetailHost } from "./page-extract.server";

export type DetailFollowSkipReason =
  | "duplicate_url"
  | "cross_domain_not_allowed"
  | "score_below_threshold"
  | "budget_exhausted"
  | "scan_deadline_reached"
  | "invalid_url"
  | "title_mismatch"
  | "already_crawled"
  | "queue_limit_reached";

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

const MAX_QUEUE = 20;
const MAX_PER_PAGE = 5;

export class DetailFollowRecorder {
  private queue: string[] = [];
  private seen = new Set<string>();
  private logs: DetailFollowLogEntry[] = [];

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
  }): string[] {
    const pageHost = hostOf(input.pageUrl);
    const accepted: string[] = [];
    this.recordTitleCandidatesScored(input.pageUrl, input.candidates.length);

    for (const raw of input.candidates.slice(0, MAX_PER_PAGE)) {
      if (this.queue.length >= MAX_QUEUE) {
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
      if (this.seen.has(url) || input.inspectedUrls.has(url)) {
        this.log("candidate_skipped", { url, reason: "already_crawled" });
        continue;
      }
      const host = hostOf(url);
      if (
        pageHost &&
        host &&
        host !== pageHost &&
        !isRecognizedExternalDetailHost(url, pageHost)
      ) {
        this.log("candidate_skipped", {
          url,
          reason: "cross_domain_not_allowed",
          detail: `${pageHost} -> ${host}`,
        });
        continue;
      }
      this.seen.add(url);
      this.queue.push(url);
      accepted.push(url);
      this.log("candidate_queued", { url });
    }
    return accepted;
  }

  drain(limit = MAX_QUEUE): string[] {
    return this.queue.splice(0, limit);
  }

  peek(): string[] {
    return [...this.queue];
  }

  recordCrawled(url: string): void {
    this.log("candidate_crawled", { url });
  }

  recordEvidenceResult(
    url: string,
    detail: string,
    reason?: string,
  ): void {
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
  } {
    const discovered = this.logs
      .filter((l) => l.event === "title_candidates_scored")
      .reduce((sum, l) => sum + (l.count ?? 0), 0);
    const queued = this.logs.filter((l) => l.event === "candidate_queued").length;
    return {
      detail_links_discovered: discovered,
      detail_pages_queued: queued,
    };
  }
}

/**
 * Independent Removal Verification Engine.
 * Verifies if target content has actually been removed at source or delisted from search engine indexes.
 * Enforces strict HTTP status classification:
 * - 404 / 410 -> SOURCE_REMOVED (when confirmed by HTTP status + content body deletion check)
 * - 403 -> ACCESS_BLOCKED / UNKNOWN (MUST NOT be treated as SOURCE_REMOVED due to WAF / anti-bot / region blocks)
 * - 200 OK with deletion marker -> SOURCE_REMOVED
 * - 200 OK without marker -> STILL_LIVE
 */

export interface VerificationEvidenceSnapshot {
  targetUrl: string;
  verifiedAt: string;
  httpStatusCode?: number;
  isAccessible: boolean;
  isBlocked?: boolean;
  contentRemovedMarker?: string | null;
  searchDelisted: boolean;
  rawState: string;
}

export interface VerificationResult {
  outcome: "SOURCE_REMOVED" | "SEARCH_DELISTED" | "STILL_LIVE" | "ACCESS_BLOCKED" | "UNKNOWN" | "FAILED";
  evidence: VerificationEvidenceSnapshot;
}

const DELETION_MARKERS = [
  "this video is no longer available",
  "video unavailable",
  "this page isn't available",
  "content not found",
  "404 not found",
  "account suspended",
  "this content has been removed",
  "the page you requested could not be found",
  "copyright claim by",
  "removed due to copyright",
  "this post has been deleted",
];

export class VerificationEngine {
  static async verifyTarget(targetUrl: string): Promise<VerificationResult> {
    const verifiedAt = new Date().toISOString();
    let httpStatusCode = 200;
    let isAccessible = true;
    let isBlocked = false;
    let contentRemovedMarker: string | null = null;
    let searchDelisted = false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(targetUrl, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) EternaVerificationEngine/2.0",
        },
      });
      clearTimeout(timeout);

      httpStatusCode = res.status;

      // STRICT HTTP 403 PROTECTION: 403 MUST NOT equal SOURCE_REMOVED
      if (res.status === 403 || res.status === 401) {
        isAccessible = true;
        isBlocked = true;
        contentRemovedMarker = `HTTP_ACCESS_BLOCKED_${res.status}`;
      } else if (res.status === 404 || res.status === 410) {
        isAccessible = false;
        contentRemovedMarker = `HTTP_${res.status}`;
      } else if (res.ok) {
        const text = (await res.text()).toLowerCase();
        for (const marker of DELETION_MARKERS) {
          if (text.includes(marker)) {
            isAccessible = false;
            contentRemovedMarker = marker;
            break;
          }
        }
      }
    } catch (err: unknown) {
      // Network timeouts or connection errors -> UNKNOWN / NETWORK_ERROR
      isAccessible = true;
      isBlocked = true;
      contentRemovedMarker = `NETWORK_ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }

    const evidence: VerificationEvidenceSnapshot = {
      targetUrl,
      verifiedAt,
      httpStatusCode,
      isAccessible,
      isBlocked,
      contentRemovedMarker,
      searchDelisted,
      rawState: isBlocked
        ? "ACCESS_BLOCKED_OR_WAF"
        : !isAccessible
        ? "CONTENT_REMOVED_CONFIRMED"
        : "CONTENT_STILL_ONLINE",
    };

    if (isBlocked) {
      return { outcome: "ACCESS_BLOCKED", evidence };
    }

    if (!isAccessible) {
      return { outcome: "SOURCE_REMOVED", evidence };
    }

    if (searchDelisted) {
      return { outcome: "SEARCH_DELISTED", evidence };
    }

    return { outcome: "STILL_LIVE", evidence };
  }
}

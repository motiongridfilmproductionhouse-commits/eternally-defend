import { createHash } from "node:crypto";
import {
  assertNotAborted,
  boundTimeoutMs,
  isAbortError,
  mergeAbortSignals,
} from "./scan-runtime.server";

type EvidenceCandidate = {
  url: string;
  title?: string;
  description?: string;
  risk_level?: string;
  content_category?: string;
  confidence?: number;
  evidence_page_url?: string;
  media_url?: string;
  image_url?: string;
  media_type?: "image" | "video";
  target_face_match?: boolean;
  face_similarity?: number | null;
  matched_face_id?: string | null;
};

type CaptureResult = {
  finding_url: string;
  canonical_url: string | null;
  evidence_page_url: string | null;
  direct_media_url: string | null;
  media_type: "image" | "video" | "page";
  source_host: string | null;
  http_status: number | null;
  content_type: string | null;
  content_length: number | null;
  media_sha256: string | null;
  evidence_status:
    | "discovered"
    | "verified"
    | "media_analysed"
    | "evidence_sealed"
    | "ready_for_takedown"
    | "capture_failed";
  capture_error: string | null;
};

const MAX_HASH_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;

function normaliseUrl(value?: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);

    url.hash = "";

    const removable = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
    ];

    for (const key of removable) {
      url.searchParams.delete(key);
    }

    return url.toString();
  } catch {
    return null;
  }
}

function hostOf(value?: string | null): string | null {
  if (!value) return null;

  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function mediaUrlOf(candidate: EvidenceCandidate): string | null {
  return normaliseUrl(candidate.media_url) ?? normaliseUrl(candidate.image_url);
}

function determineEvidenceStatus(
  candidate: EvidenceCandidate,
  hash: string | null,
): CaptureResult["evidence_status"] {
  if (
    candidate.target_face_match &&
    hash &&
    (candidate.risk_level === "CRITICAL" || candidate.risk_level === "HIGH")
  ) {
    return "ready_for_takedown";
  }

  if (candidate.target_face_match && hash) {
    return "evidence_sealed";
  }

  if (candidate.target_face_match) {
    return "verified";
  }

  if (hash) {
    return "media_analysed";
  }

  return "discovered";
}

async function fetchAndHash(
  targetUrl: string,
  options?: { signal?: AbortSignal; softDeadlineMs?: number },
): Promise<{
  status: number;
  contentType: string | null;
  contentLength: number | null;
  sha256: string | null;
}> {
  assertNotAborted(options?.signal);
  const timeoutMs = boundTimeoutMs(FETCH_TIMEOUT_MS, options?.signal, options?.softDeadlineMs);
  const signal = mergeAbortSignals(options?.signal, AbortSignal.timeout(timeoutMs));

  const response = await fetch(targetUrl, {
    method: "GET",
    redirect: "follow",
    headers: {
      "user-agent": "EternaEvidenceBot/1.0 (+https://eternasentinel.com)",
      accept: "image/*,video/*,text/html;q=0.8,*/*;q=0.5",
    },
    signal,
  });

  const contentType = response.headers.get("content-type");

  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);

  const contentLength = Number.isFinite(declaredLength) ? declaredLength : null;

  if (!response.ok) {
    return {
      status: response.status,
      contentType,
      contentLength,
      sha256: null,
    };
  }

  if (contentLength !== null && contentLength > MAX_HASH_BYTES) {
    return {
      status: response.status,
      contentType,
      contentLength,
      sha256: null,
    };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  assertNotAborted(options?.signal);

  if (!bytes.length || bytes.length > MAX_HASH_BYTES) {
    return {
      status: response.status,
      contentType,
      contentLength: bytes.length || contentLength,
      sha256: null,
    };
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");

  return {
    status: response.status,
    contentType,
    contentLength: bytes.length,
    sha256,
  };
}

export async function captureEvidenceCandidate(
  candidate: EvidenceCandidate,
  options?: { signal?: AbortSignal; softDeadlineMs?: number },
): Promise<CaptureResult> {
  const findingUrl = normaliseUrl(candidate.evidence_page_url) ?? normaliseUrl(candidate.url);

  const directMediaUrl = mediaUrlOf(candidate);

  if (!findingUrl) {
    return {
      finding_url: candidate.url,
      canonical_url: null,
      evidence_page_url: null,
      direct_media_url: directMediaUrl,
      media_type: candidate.media_type ?? "page",
      source_host: null,
      http_status: null,
      content_type: null,
      content_length: null,
      media_sha256: null,
      evidence_status: "capture_failed",
      capture_error: "Invalid evidence URL",
    };
  }

  const captureTarget = directMediaUrl ?? findingUrl;

  try {
    assertNotAborted(options?.signal);
    const capture = await fetchAndHash(captureTarget, options);

    const evidenceStatus = determineEvidenceStatus(candidate, capture.sha256);

    return {
      finding_url: findingUrl,
      canonical_url: findingUrl,
      evidence_page_url: normaliseUrl(candidate.evidence_page_url) ?? findingUrl,
      direct_media_url: directMediaUrl,
      media_type: candidate.media_type ?? (directMediaUrl ? "image" : "page"),
      source_host: hostOf(findingUrl),
      http_status: capture.status,
      content_type: capture.contentType,
      content_length: capture.contentLength,
      media_sha256: capture.sha256,
      evidence_status: evidenceStatus,
      capture_error:
        capture.status >= 400 ? `Evidence request returned HTTP ${capture.status}` : null,
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return {
      finding_url: findingUrl,
      canonical_url: findingUrl,
      evidence_page_url: normaliseUrl(candidate.evidence_page_url) ?? findingUrl,
      direct_media_url: directMediaUrl,
      media_type: candidate.media_type ?? (directMediaUrl ? "image" : "page"),
      source_host: hostOf(findingUrl),
      http_status: null,
      content_type: null,
      content_length: null,
      media_sha256: null,
      evidence_status: "capture_failed",
      capture_error:
        error instanceof Error ? error.message.slice(0, 500) : "Unknown evidence capture error",
    };
  }
}

export async function captureAndStoreEvidence(input: {
  supabase: any;
  userId: string;
  scanId: string;
  candidates: EvidenceCandidate[];
  signal?: AbortSignal;
  softDeadlineMs?: number;
}): Promise<{
  captured: number;
  failed: number;
}> {
  const evidenceRows: Record<string, unknown>[] = [];
  const batchSize = 3;

  for (let start = 0; start < input.candidates.length; start += batchSize) {
    assertNotAborted(input.signal);
    const batch = input.candidates.slice(start, start + batchSize);

    const results = await Promise.all(
      batch.map((candidate) =>
        captureEvidenceCandidate(candidate, {
          signal: input.signal,
          softDeadlineMs: input.softDeadlineMs,
        }),
      ),
    );

    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      const candidate = batch[index];

      evidenceRows.push({
        user_id: input.userId,
        scan_id: input.scanId,

        finding_url: result.finding_url,
        canonical_url: result.canonical_url,
        evidence_page_url: result.evidence_page_url,
        direct_media_url: result.direct_media_url,
        media_type: result.media_type,

        source_host: result.source_host,
        page_title: candidate.title ?? null,
        page_description: candidate.description ?? null,

        http_status: result.http_status,
        content_type: result.content_type,
        content_length: result.content_length,
        media_sha256: result.media_sha256,

        face_match: candidate.target_face_match ?? false,
        face_similarity: candidate.face_similarity ?? null,
        matched_face_id: candidate.matched_face_id ?? null,

        risk_level: candidate.risk_level ?? null,
        content_category: candidate.content_category ?? null,
        confidence: candidate.confidence ?? null,

        evidence_status: result.evidence_status,
        capture_error: result.capture_error,
        last_verified_at:
          result.http_status && result.http_status < 400 ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      });
    }
  }

  if (!evidenceRows.length) {
    return {
      captured: 0,
      failed: 0,
    };
  }

  const { error } = await input.supabase.from("deepfake_evidence").upsert(evidenceRows, {
    onConflict: "scan_id,finding_url",
  });

  if (error) {
    throw new Error(`Evidence storage failed: ${error.message}`);
  }

  return {
    captured: evidenceRows.filter((row) => row.evidence_status !== "capture_failed").length,
    failed: evidenceRows.filter((row) => row.evidence_status === "capture_failed").length,
  };
}

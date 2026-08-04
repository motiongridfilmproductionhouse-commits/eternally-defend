import { createHash } from "node:crypto";
import {
  captureEvidenceCandidate,
} from "./evidence-capture.server";
import {
  filterCandidatesByTargetFace,
} from "./face-filter.server";
import {
  finalizeDeepfakeFinding,
  isClientVisibleClassification,
} from "./page-evidence.server";
import {
  normalizeCanonicalUrl,
  verifyCandidateUrls,
} from "./url-verification.server";

export const MANUAL_LEAD_STATES = [
  "submitted",
  "parsing",
  "source_resolved",
  "crawl_pending",
  "crawled",
  "identity_check_pending",
  "review_required",
  "evidence_ready",
  "rejected",
  "failed",
] as const;

export type ManualLeadState = (typeof MANUAL_LEAD_STATES)[number];

export const MANUAL_CLASSIFICATIONS = [
  "manual lead",
  "identity match confirmed",
  "identity match rejected",
  "manipulation suspected",
  "probable deepfake",
  "verified deepfake only after review",
  "unrelated result",
  "requires human review",
] as const;

export type ManualEvidenceUrlKind =
  | "google_images_search"
  | "google_images_viewer"
  | "source_page"
  | "direct_image";

export type ManualEvidenceDiagnostics = {
  manual_urls_submitted: number;
  google_viewer_urls_parsed: number;
  selected_results_resolved: number;
  source_pages_found: number;
  pages_crawled: number;
  images_extracted: number;
  faces_compared: number;
  identity_matches: number;
  evidence_packages_ready: number;
  failed_resolutions: number;
  duplicate_leads: number;
};

export type ManualEvidenceLeadRecord = {
  id?: string;
  user_id: string;
  scan_id?: string | null;
  profile_id?: string | null;
  target_name: string;
  submitted_url: string;
  submitted_url_kind: ManualEvidenceUrlKind;
  selected_result_fragment?: string | null;
  source_page_url?: string | null;
  original_image_url?: string | null;
  source_domain?: string | null;
  page_title?: string | null;
  surrounding_text?: string | null;
  related_links?: string[];
  extracted_images?: string[];
  google_result_screenshot_path?: string | null;
  source_page_screenshot_path?: string | null;
  capture_timestamp?: string | null;
  media_sha256?: string | null;
  perceptual_hash?: string | null;
  face_similarity_score?: number | null;
  identity_confidence_score?: number | null;
  discovery_path?: string[];
  processing_status: ManualLeadState;
  error_reason?: string | null;
  classification?: string | null;
  duplicate_of_lead_id?: string | null;
  reviewer_source_page_url?: string | null;
  reviewer_image_url?: string | null;
  reviewer_notes?: string | null;
};

type ManualProcessTarget = {
  name: string;
  aliases: string[];
  handles: string[];
};

const DIRECT_IMAGE_RE =
  /\.(?:avif|bmp|gif|jpe?g|png|webp)(?:[?#].*)?$/i;

const HOOK_PATH = "/api/public/hooks/deepfake-manual-evidence-execute";

function cleanUrl(value: string): string {
  return value.trim();
}

function hostOf(value?: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isGoogleHost(hostname: string): boolean {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  return host === "google.com" || host.startsWith("google.") || host.endsWith(".google.com");
}

function isGoogleImagesSearchUrl(url: URL): boolean {
  return (
    isGoogleHost(url.hostname) &&
    (
      url.pathname.includes("/search") ||
      url.pathname.includes("/imgres") ||
      url.searchParams.get("tbm") === "isch" ||
      url.searchParams.get("udm") === "2"
    )
  );
}

export function splitManualEvidenceUrls(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[\r\n,\t ]+/)) {
    const value = raw.trim();
    if (!value) continue;
    if (!/^https?:\/\//i.test(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function classifyManualEvidenceUrl(input: string): {
  kind: ManualEvidenceUrlKind;
  selectedResultFragment: string | null;
  exactSubmittedUrl: string;
} {
  const value = cleanUrl(input);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Manual evidence URL must be a valid http(s) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Manual evidence URL must use http:// or https://.");
  }

  if (isGoogleImagesSearchUrl(url)) {
    const fragment = url.hash ? url.hash.slice(1) : null;
    return {
      kind: fragment?.includes("sv=")
        ? "google_images_viewer"
        : "google_images_search",
      selectedResultFragment: fragment,
      exactSubmittedUrl: value,
    };
  }

  return {
    kind: DIRECT_IMAGE_RE.test(url.pathname)
      ? "direct_image"
      : "source_page",
    selectedResultFragment: null,
    exactSubmittedUrl: value,
  };
}

function decodeMaybeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidates = [value];
  try {
    candidates.push(decodeURIComponent(value));
  } catch {
    // Keep original candidate only.
  }
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.toString();
      }
    } catch {
      // Not a direct URL.
    }
  }
  return null;
}

function unwrapGoogleRedirect(value: string | null | undefined): string | null {
  const direct = decodeMaybeUrl(value);
  if (!direct) return null;
  try {
    const parsed = new URL(direct);
    if (!isGoogleHost(parsed.hostname)) return direct;
    return (
      decodeMaybeUrl(parsed.searchParams.get("imgrefurl")) ??
      decodeMaybeUrl(parsed.searchParams.get("url")) ??
      decodeMaybeUrl(parsed.searchParams.get("q")) ??
      decodeMaybeUrl(parsed.searchParams.get("u")) ??
      decodeMaybeUrl(parsed.searchParams.get("ru")) ??
      direct
    );
  } catch {
    return direct;
  }
}

function firstExternalGoogleParam(url: URL): {
  sourcePageUrl: string | null;
  imageUrl: string | null;
} {
  const sourcePageUrl =
    unwrapGoogleRedirect(url.searchParams.get("imgrefurl")) ??
    unwrapGoogleRedirect(url.searchParams.get("ru")) ??
    unwrapGoogleRedirect(url.searchParams.get("url")) ??
    unwrapGoogleRedirect(url.searchParams.get("q"));
  const imageUrl =
    decodeMaybeUrl(url.searchParams.get("imgurl")) ??
    decodeMaybeUrl(url.searchParams.get("mediaurl"));
  return { sourcePageUrl, imageUrl };
}

export function extractGoogleUrlHints(submittedUrl: string): {
  sourcePageUrl: string | null;
  imageUrl: string | null;
  selectedResultFragment: string | null;
} {
  const url = new URL(submittedUrl);
  const direct = firstExternalGoogleParam(url);
  if (direct.sourcePageUrl || direct.imageUrl) {
    return {
      ...direct,
      selectedResultFragment: url.hash ? url.hash.slice(1) : null,
    };
  }

  const hash = url.hash ? url.hash.slice(1) : "";
  const hashParams = new URLSearchParams(hash.startsWith("?") ? hash.slice(1) : hash);
  const fromHash = {
    sourcePageUrl:
      unwrapGoogleRedirect(hashParams.get("imgrefurl")) ??
      unwrapGoogleRedirect(hashParams.get("ru")) ??
      unwrapGoogleRedirect(hashParams.get("url")),
    imageUrl:
      decodeMaybeUrl(hashParams.get("imgurl")) ??
      decodeMaybeUrl(hashParams.get("mediaurl")),
  };
  if (fromHash.sourcePageUrl || fromHash.imageUrl) {
    return {
      ...fromHash,
      selectedResultFragment: hash || null,
    };
  }

  const decodedHash = (() => {
    try {
      return decodeURIComponent(hash);
    } catch {
      return hash;
    }
  })();
  const urls = decodedHash.match(/https?:\/\/[^\s"'<>|\\]+/g) ?? [];
  const external = urls.filter((item) => {
    try {
      return !isGoogleHost(new URL(item).hostname);
    } catch {
      return false;
    }
  });

  return {
    sourcePageUrl: external[0] ?? null,
    imageUrl: external.find((item) => DIRECT_IMAGE_RE.test(new URL(item).pathname)) ?? null,
    selectedResultFragment: hash || null,
  };
}

async function resolveWithPlaywright(submittedUrl: string): Promise<{
  sourcePageUrl: string | null;
  imageUrl: string | null;
  googleScreenshotHash: string | null;
  error: string | null;
}> {
  let chromium: any;
  try {
    const dynamicImport = new Function("moduleName", "return import(moduleName)") as (
      moduleName: string,
    ) => Promise<any>;
    chromium = (await dynamicImport("playwright")).chromium;
  } catch {
    return {
      sourcePageUrl: null,
      imageUrl: null,
      googleScreenshotHash: null,
      error: "Playwright is not installed in this runtime.",
    };
  }

  let browser: any = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1365, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    });
    await page.goto(submittedUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await page.waitForTimeout(800);

    const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
    const googleScreenshotHash = screenshot
      ? `sha256:${createHash("sha256").update(screenshot).digest("hex")}`
      : null;

    const result = await page.evaluate(() => {
      const asUrl = (value: string | null | undefined): string | null => {
        if (!value) return null;
        try {
          return new URL(value, location.href).toString();
        } catch {
          return null;
        }
      };
      const anchors = Array.from(document.querySelectorAll("a"));
      const visitAnchor =
        anchors.find((a) => /\bvisit\b/i.test(a.textContent ?? "")) ??
        anchors.find((a) => /imgrefurl=|[?&]url=|[?&]q=|[?&]ru=/i.test(a.getAttribute("href") ?? ""));
      const sourcePageUrl = asUrl(visitAnchor?.getAttribute("href"));
      const selectedImg =
        document.querySelector("[aria-selected='true'] img") ??
        document.querySelector("img[src^='http']") ??
        document.querySelector("img[data-src^='http']");
      const imageUrl =
        asUrl(selectedImg?.getAttribute("src")) ??
        asUrl(selectedImg?.getAttribute("data-src"));
      return { sourcePageUrl, imageUrl };
    });

    return {
      sourcePageUrl: unwrapGoogleRedirect(result.sourcePageUrl) ?? result.sourcePageUrl,
      imageUrl: decodeMaybeUrl(result.imageUrl),
      googleScreenshotHash,
      error: null,
    };
  } catch (error) {
    return {
      sourcePageUrl: null,
      imageUrl: null,
      googleScreenshotHash: null,
      error: error instanceof Error ? error.message.slice(0, 500) : String(error),
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function resolveSubmittedManualUrl(submittedUrl: string): Promise<{
  kind: ManualEvidenceUrlKind;
  selectedResultFragment: string | null;
  sourcePageUrl: string | null;
  imageUrl: string | null;
  googleScreenshotPath: string | null;
  errorReason: string | null;
}> {
  const classified = classifyManualEvidenceUrl(submittedUrl);
  if (classified.kind === "source_page") {
    return {
      kind: classified.kind,
      selectedResultFragment: null,
      sourcePageUrl: classified.exactSubmittedUrl,
      imageUrl: null,
      googleScreenshotPath: null,
      errorReason: null,
    };
  }
  if (classified.kind === "direct_image") {
    return {
      kind: classified.kind,
      selectedResultFragment: null,
      sourcePageUrl: null,
      imageUrl: classified.exactSubmittedUrl,
      googleScreenshotPath: null,
      errorReason: null,
    };
  }

  const hints = extractGoogleUrlHints(classified.exactSubmittedUrl);
  if (hints.sourcePageUrl || hints.imageUrl) {
    return {
      kind: classified.kind,
      selectedResultFragment: classified.selectedResultFragment ?? hints.selectedResultFragment,
      sourcePageUrl: hints.sourcePageUrl,
      imageUrl: hints.imageUrl,
      googleScreenshotPath: null,
      errorReason: null,
    };
  }

  const rendered = await resolveWithPlaywright(classified.exactSubmittedUrl);
  if (rendered.sourcePageUrl || rendered.imageUrl) {
    return {
      kind: classified.kind,
      selectedResultFragment: classified.selectedResultFragment,
      sourcePageUrl: rendered.sourcePageUrl,
      imageUrl: rendered.imageUrl,
      googleScreenshotPath: rendered.googleScreenshotHash,
      errorReason: null,
    };
  }

  return {
    kind: classified.kind,
    selectedResultFragment: classified.selectedResultFragment,
    sourcePageUrl: null,
    imageUrl: null,
    googleScreenshotPath: rendered.googleScreenshotHash,
    errorReason:
      rendered.error ??
      "Source page could not be resolved automatically.",
  };
}

export function createEmptyManualEvidenceDiagnostics(): ManualEvidenceDiagnostics {
  return {
    manual_urls_submitted: 0,
    google_viewer_urls_parsed: 0,
    selected_results_resolved: 0,
    source_pages_found: 0,
    pages_crawled: 0,
    images_extracted: 0,
    faces_compared: 0,
    identity_matches: 0,
    evidence_packages_ready: 0,
    failed_resolutions: 0,
    duplicate_leads: 0,
  };
}

export function manualLeadInitialDedupeKey(submittedUrl: string): string {
  return cleanUrl(submittedUrl);
}

export function manualLeadResolvedDedupeKey(input: {
  sourcePageUrl?: string | null;
  imageUrl?: string | null;
  perceptualHash?: string | null;
}): string | null {
  if (input.perceptualHash) return `phash:${input.perceptualHash}`;
  if (input.imageUrl) return `image:${normalizeCanonicalUrl(input.imageUrl)}`;
  if (input.sourcePageUrl) return `source:${normalizeCanonicalUrl(input.sourcePageUrl)}`;
  return null;
}

function perceptualHashFromSha256(sha256: string | null): string | null {
  return sha256 ? `sha256-prefix:${sha256.slice(0, 16)}` : null;
}

async function updateLead(input: {
  supabase: any;
  leadId: string;
  patch: Partial<ManualEvidenceLeadRecord> & Record<string, unknown>;
}) {
  const { error } = await input.supabase
    .from("deepfake_manual_leads")
    .update({
      ...input.patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.leadId);
  if (error) throw new Error(error.message);
}

async function markDuplicateAfterResolution(input: {
  supabase: any;
  lead: ManualEvidenceLeadRecord & { id: string };
  resolvedKey: string | null;
}): Promise<string | null> {
  if (!input.resolvedKey) return null;
  const { data, error } = await input.supabase
    .from("deepfake_manual_leads")
    .select("id")
    .eq("user_id", input.lead.user_id)
    .eq("target_name", input.lead.target_name)
    .eq("resolved_dedupe_key", input.resolvedKey)
    .neq("id", input.lead.id)
    .limit(1);
  if (error) return null;
  return data?.[0]?.id ?? null;
}

async function hashSourcePageScreenshot(sourcePageUrl: string): Promise<string | null> {
  try {
    const dynamicImport = new Function("moduleName", "return import(moduleName)") as (
      moduleName: string,
    ) => Promise<any>;
    const { chromium } = await dynamicImport("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
      await page.goto(sourcePageUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
      const screenshot = await page.screenshot({ fullPage: true });
      return `sha256:${createHash("sha256").update(screenshot).digest("hex")}`;
    } finally {
      await browser.close().catch(() => undefined);
    }
  } catch {
    return null;
  }
}

function findingRowFromManual(input: {
  userId: string;
  scanId: string;
  lead: ManualEvidenceLeadRecord & { id: string };
  url: string;
  pageTitle: string | null;
  pageText: string;
  classification: ReturnType<typeof finalizeDeepfakeFinding>;
}) {
  const classification =
    input.classification.finding_classification === "VERIFIED_DEEPFAKE"
      ? "PROBABLE_DEEPFAKE"
      : input.classification.finding_classification;
  return {
    user_id: input.userId,
    scan_id: input.scanId,
    url: input.url,
    source_host: hostOf(input.url),
    page_title: input.pageTitle,
    snippet: input.lead.surrounding_text ?? input.pageText.slice(0, 500),
    query: "manual evidence",
    risk_level: input.classification.risk_level,
    content_category: input.classification.content_category,
    confidence: input.classification.confidence,
    is_synthetic: input.classification.is_synthetic,
    face_referenced: input.classification.face_referenced,
    takedown_recommended: false,
    target_face_match: input.lead.face_similarity_score
      ? input.lead.face_similarity_score >= 88
      : false,
    face_similarity: input.lead.face_similarity_score ?? null,
    ai_reasoning:
      "Manual evidence lead. Verified-deepfake status requires human review.",
    finding_classification: classification,
    page_type: input.classification.page_type,
    identity_confidence: input.classification.identity_confidence,
    synthetic_media_confidence:
      input.classification.synthetic_media_confidence,
    matched_evidence: [
      ...input.classification.matched_evidence,
      "discovery:manual-lead",
    ],
    classification_explanation:
      input.classification.classification_explanation,
    discovered_url: input.lead.submitted_url,
    final_url: input.url,
    canonical_url: normalizeCanonicalUrl(input.url),
    http_status: null,
    redirect_chain: [input.lead.submitted_url, input.url],
    crawled_at: new Date().toISOString(),
    url_verification_status: "URL_VERIFIED",
    url_rejection_reason: null,
  };
}

export async function processManualEvidenceLead(input: {
  supabase: any;
  leadId: string;
  signal?: AbortSignal;
}): Promise<{ status: ManualLeadState; reason: string | null }> {
  const { data: leadRow, error } = await input.supabase
    .from("deepfake_manual_leads")
    .select("*")
    .eq("id", input.leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!leadRow) throw new Error("Manual lead not found.");

  const lead = leadRow as ManualEvidenceLeadRecord & { id: string };
  const discoveryPath = [
    ...((lead.discovery_path as string[] | undefined) ?? []),
    "manual_lead",
  ];

  try {
    await updateLead({
      supabase: input.supabase,
      leadId: lead.id,
      patch: {
        processing_status: "parsing",
        error_reason: null,
        discovery_path: discoveryPath,
      },
    });

    const existingOverrideSource =
      lead.reviewer_source_page_url ?? lead.source_page_url ?? null;
    const existingOverrideImage =
      lead.reviewer_image_url ?? lead.original_image_url ?? null;
    const resolved = existingOverrideSource || existingOverrideImage
      ? {
          kind: lead.submitted_url_kind,
          selectedResultFragment: lead.selected_result_fragment ?? null,
          sourcePageUrl: existingOverrideSource,
          imageUrl: existingOverrideImage,
          googleScreenshotPath: lead.google_result_screenshot_path ?? null,
          errorReason: null,
        }
      : await resolveSubmittedManualUrl(lead.submitted_url);
    if (
      resolved.kind.startsWith("google_images") &&
      resolved.selectedResultFragment?.includes("sv=")
    ) {
      discoveryPath.push("google_images_viewer_sv_fragment");
    } else if (resolved.kind.startsWith("google_images")) {
      discoveryPath.push("google_images_search");
    }

    if (!resolved.sourcePageUrl && !resolved.imageUrl) {
      await updateLead({
        supabase: input.supabase,
        leadId: lead.id,
        patch: {
          submitted_url_kind: resolved.kind,
          selected_result_fragment: resolved.selectedResultFragment,
          google_result_screenshot_path: resolved.googleScreenshotPath,
          processing_status: "failed",
          error_reason:
            resolved.errorReason ??
            "Source page could not be resolved automatically.",
          classification: "requires human review",
          discovery_path: discoveryPath,
        },
      });
      return { status: "failed", reason: resolved.errorReason };
    }

    const captureTimestamp = new Date().toISOString();
    await updateLead({
      supabase: input.supabase,
      leadId: lead.id,
      patch: {
        submitted_url_kind: resolved.kind,
        selected_result_fragment: resolved.selectedResultFragment,
        source_page_url: resolved.sourcePageUrl,
        original_image_url: resolved.imageUrl,
        source_domain: hostOf(resolved.sourcePageUrl),
        google_result_screenshot_path: resolved.googleScreenshotPath,
        capture_timestamp: captureTimestamp,
        processing_status: "source_resolved",
        error_reason: null,
        discovery_path: discoveryPath,
      },
    });

    const sourceUrl = resolved.sourcePageUrl;
    const imageUrl = resolved.imageUrl;
    if (!sourceUrl) {
      const capture = await captureEvidenceCandidate({
        url: imageUrl!,
        image_url: imageUrl!,
        media_url: imageUrl!,
        media_type: "image",
      });
      const pHash = perceptualHashFromSha256(capture.media_sha256);
      const resolvedKey = manualLeadResolvedDedupeKey({
        imageUrl,
        perceptualHash: pHash,
      });
      const duplicateOf = await markDuplicateAfterResolution({
        supabase: input.supabase,
        lead: { ...lead, original_image_url: imageUrl },
        resolvedKey,
      });
      await updateLead({
        supabase: input.supabase,
        leadId: lead.id,
        patch: {
          resolved_dedupe_key: resolvedKey,
          duplicate_of_lead_id: duplicateOf,
          media_sha256: capture.media_sha256,
          perceptual_hash: pHash,
          processing_status: duplicateOf ? "rejected" : "identity_check_pending",
          error_reason: duplicateOf
            ? "Duplicate manual lead after source resolution."
            : "Direct image lead requires face comparison or reviewer source-page override.",
          classification: duplicateOf
            ? "unrelated result"
            : "requires human review",
          discovery_path: [...discoveryPath, "direct_image"],
        },
      });
      return {
        status: duplicateOf ? "rejected" : "identity_check_pending",
        reason: duplicateOf
          ? "Duplicate manual lead after source resolution."
          : null,
      };
    }

    await updateLead({
      supabase: input.supabase,
      leadId: lead.id,
      patch: { processing_status: "crawl_pending" },
    });

    const target: ManualProcessTarget = {
      name: lead.target_name,
      aliases: [],
      handles: [],
    };
    const verification = await verifyCandidateUrls(
      [
        {
          url: sourceUrl,
          title: lead.target_name,
          description: "Manual evidence lead",
          query: "manual evidence",
          source: "manual_evidence",
          image_url: imageUrl ?? undefined,
          media_url: imageUrl ?? undefined,
          thumbnail_url: imageUrl ?? undefined,
          threat_signals: ["manual"],
        },
      ],
      target,
      { maxPages: 1, signal: input.signal },
    );

    if (!verification.verified.length) {
      const reason =
        verification.rejected[0]?.rejection_reason ??
        "Source page could not be crawled or did not match the protected identity.";
      await updateLead({
        supabase: input.supabase,
        leadId: lead.id,
        patch: {
          processing_status: "failed",
          error_reason: reason,
          classification: "requires human review",
        },
      });
      return { status: "failed", reason };
    }

    const verified = verification.verified;
    const primary = verified[0];
    const extractedImages = Array.from(
      new Set(
        verified
          .map((item) => item.image_url ?? item.media_url ?? item.thumbnail_url)
          .filter((item): item is string => Boolean(item)),
      ),
    );

    await updateLead({
      supabase: input.supabase,
      leadId: lead.id,
      patch: {
        processing_status: "crawled",
        page_title: primary.page_title,
        source_domain: primary.verified_domain ?? hostOf(primary.final_url),
        surrounding_text: primary.page_text.slice(0, 2000),
        extracted_images: extractedImages,
        related_links: primary.related_links ?? [],
        source_page_screenshot_path: await hashSourcePageScreenshot(primary.final_url),
        discovery_path: [...discoveryPath, "source_page_crawled"],
      },
    });

    let faceChecked = verified as typeof verification.verified;
    let faceSimilarity = 0;
    let faceMatched = false;
    let faceRejected = false;
    if (lead.profile_id && extractedImages.length) {
      await updateLead({
        supabase: input.supabase,
        leadId: lead.id,
        patch: { processing_status: "identity_check_pending" },
      });
      const faceResults = await filterCandidatesByTargetFace({
        supabase: input.supabase,
        userId: lead.user_id,
        profileId: lead.profile_id,
        candidates: verified,
        similarityThreshold: 88,
        signal: input.signal,
      });
      faceChecked = [
        ...(faceResults.matched as unknown as typeof verification.verified),
        ...(faceResults.errors as unknown as typeof verification.verified),
      ];
      faceSimilarity = Math.max(
        0,
        ...[
          ...faceResults.matched,
          ...faceResults.rejected,
          ...faceResults.errors,
        ].map((item) =>
          typeof item.face_similarity === "number" ? item.face_similarity : 0,
        ),
      );
      faceMatched = faceResults.matched.length > 0;
      faceRejected =
        faceResults.rejected.length > 0 &&
        faceResults.matched.length === 0 &&
        faceResults.errors.length === 0;
    }

    if (faceRejected) {
      await updateLead({
        supabase: input.supabase,
        leadId: lead.id,
        patch: {
          processing_status: "rejected",
          face_similarity_score: faceSimilarity,
          classification: "identity match rejected",
          error_reason:
            "Face comparison rejected: discovered image does not match the enrolled identity.",
        },
      });
      return { status: "rejected", reason: "Face mismatch." };
    }

    const candidate = faceChecked[0] ?? primary;
    const finalized = finalizeDeepfakeFinding({
      url: primary.final_url,
      title: primary.page_title,
      description: primary.page_description,
      page_text: primary.page_text,
      page_inspected: primary.page_inspected,
      query: "manual evidence",
      target,
      target_face_match: faceMatched,
      face_similarity: faceSimilarity || null,
      is_synthetic: null,
      content_category: null,
      existing_reasoning: null,
      existing_category: null,
      existing_confidence: null,
    });

    const capture = await captureEvidenceCandidate({
      url: primary.final_url,
      evidence_page_url: primary.final_url,
      image_url:
        (candidate as any).image_url ??
        (candidate as any).media_url ??
        imageUrl ??
        undefined,
      media_url:
        (candidate as any).media_url ??
        (candidate as any).image_url ??
        imageUrl ??
        undefined,
      media_type: "image",
      target_face_match: faceMatched,
      face_similarity: faceSimilarity || null,
      confidence: finalized.confidence,
      risk_level: finalized.risk_level,
      content_category: finalized.content_category ?? undefined,
    });
    const pHash = perceptualHashFromSha256(capture.media_sha256);
    const resolvedKey = manualLeadResolvedDedupeKey({
      sourcePageUrl: primary.final_url,
      imageUrl:
        (candidate as any).image_url ??
        (candidate as any).media_url ??
        imageUrl,
      perceptualHash: pHash,
    });
    const duplicateOf = await markDuplicateAfterResolution({
      supabase: input.supabase,
      lead: { ...lead, source_page_url: primary.final_url },
      resolvedKey,
    });

    if (lead.scan_id) {
      const { error: discoveryError } = await input.supabase
        .from("deepfake_discoveries")
        .upsert(
          {
            user_id: lead.user_id,
            scan_id: lead.scan_id,
            source: "manual_evidence",
            search_query: "manual evidence",
            page_url: primary.final_url,
            canonical_url: primary.canonical_url,
            source_host: primary.verified_domain ?? hostOf(primary.final_url),
            page_title: primary.page_title,
            snippet: primary.page_description,
            image_url: imageUrl,
            thumbnail_url: imageUrl,
            media_type: imageUrl ? "image" : null,
            analysis_status: "url_verified",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "scan_id,page_url" },
        );
      if (discoveryError) {
        console.warn("[DEEPFAKE:MANUAL] discovery upsert failed:", discoveryError.message);
      }

      const row = findingRowFromManual({
        userId: lead.user_id,
        scanId: lead.scan_id,
        lead: {
          ...lead,
          face_similarity_score: faceSimilarity || null,
          surrounding_text: primary.page_text.slice(0, 500),
        },
        url: primary.final_url,
        pageTitle: primary.page_title,
        pageText: primary.page_text,
        classification: finalized,
      });
      const { error: findingError } = await input.supabase
        .from("deepfake_findings")
        .upsert(row, { onConflict: "scan_id,url" });
      if (findingError) {
        console.warn("[DEEPFAKE:MANUAL] finding upsert failed:", findingError.message);
      }
    }

    const humanClassification =
      duplicateOf
        ? "unrelated result"
        : faceMatched
          ? "identity match confirmed"
          : isClientVisibleClassification(finalized.finding_classification)
            ? "probable deepfake"
            : "requires human review";
    const finalState: ManualLeadState = duplicateOf
      ? "rejected"
      : humanClassification === "requires human review" ||
          humanClassification === "identity match confirmed" ||
          humanClassification === "probable deepfake"
        ? "review_required"
        : "evidence_ready";

    await updateLead({
      supabase: input.supabase,
      leadId: lead.id,
      patch: {
        processing_status: finalState,
        resolved_dedupe_key: resolvedKey,
        duplicate_of_lead_id: duplicateOf,
        media_sha256: capture.media_sha256,
        perceptual_hash: pHash,
        face_similarity_score: faceSimilarity || null,
        identity_confidence_score: finalized.identity_confidence,
        classification: humanClassification,
        error_reason: duplicateOf
          ? "Duplicate manual lead after source resolution."
          : null,
      },
    });

    return { status: finalState, reason: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 500) : String(error);
    await updateLead({
      supabase: input.supabase,
      leadId: lead.id,
      patch: {
        processing_status: "failed",
        error_reason: reason,
        classification: "requires human review",
      },
    });
    return { status: "failed", reason };
  }
}

export async function processManualEvidenceLeadsById(input: {
  supabase: any;
  leadIds: string[];
}): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;
  for (const leadId of input.leadIds) {
    const result = await processManualEvidenceLead({
      supabase: input.supabase,
      leadId,
    });
    processed++;
    if (result.status === "failed") failed++;
  }
  return { processed, failed };
}

function normalizeOrigin(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function resolveManualEvidenceWorkerUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = env.DEEPFAKE_MANUAL_EVIDENCE_WORKER_URL?.trim();
  if (explicit) {
    try {
      return new URL(explicit).toString();
    } catch {
      return null;
    }
  }
  const candidates = [
    env.DEEPFAKE_MANUAL_EVIDENCE_WORKER_BASE_URL,
    env.SITE_URL,
    env.APP_URL,
    env.PUBLIC_APP_URL,
    env.VITE_SITE_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined,
  ];
  for (const candidate of candidates) {
    const origin = candidate ? normalizeOrigin(candidate) : null;
    if (origin) return `${origin}${HOOK_PATH}`;
  }
  return null;
}

function manualWorkerSecret(env: NodeJS.ProcessEnv = process.env): string {
  const value =
    env.DEEPFAKE_MANUAL_EVIDENCE_WORKER_SECRET?.trim() ??
    env.COPYRIGHT_SCAN_WORKER_SECRET?.trim();
  if (!value) {
    throw new Error("DEEPFAKE_MANUAL_EVIDENCE_WORKER_SECRET is not configured.");
  }
  return value;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqualHex(actualHex: string, expectedHex: string): boolean {
  if (!/^[0-9a-f]+$/i.test(actualHex) || actualHex.length !== expectedHex.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < expectedHex.length; i++) {
    diff |= actualHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  }
  return diff === 0;
}

export async function signManualEvidenceWorkerRequest(
  body: string,
  timestamp = Date.now(),
): Promise<{ signature: string; timestamp: string }> {
  return {
    timestamp: String(timestamp),
    signature: await hmacSha256Hex(manualWorkerSecret(), `${timestamp}.${body}`),
  };
}

export async function verifyManualEvidenceWorkerRequest(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
): Promise<{ ok: boolean; reason: string }> {
  if (!timestampHeader || !signatureHeader) {
    return { ok: false, reason: "missing_header" };
  }
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: "invalid_timestamp" };
  }
  if (Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) {
    return { ok: false, reason: "timestamp_outside_window" };
  }
  let expected: string;
  try {
    expected = await hmacSha256Hex(manualWorkerSecret(), `${timestamp}.${rawBody}`);
  } catch {
    return { ok: false, reason: "secret_missing" };
  }
  return constantTimeEqualHex(signatureHeader, expected)
    ? { ok: true, reason: "ok" }
    : { ok: false, reason: "signature_mismatch" };
}

export async function dispatchManualEvidenceWorker(
  leadIds: string[],
): Promise<{ dispatched: boolean; reason: string | null }> {
  const workerUrl = resolveManualEvidenceWorkerUrl();
  if (!workerUrl) {
    return { dispatched: false, reason: "manual evidence worker URL is not configured" };
  }
  const body = JSON.stringify({ lead_ids: leadIds });
  let signed: { signature: string; timestamp: string };
  try {
    signed = await signManualEvidenceWorkerRequest(body);
  } catch (error) {
    return {
      dispatched: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  try {
    fetch(workerUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-eterna-timestamp": signed.timestamp,
        "x-eterna-signature": signed.signature,
      },
      body,
    }).catch((error) => {
      console.warn("[DEEPFAKE:MANUAL] worker dispatch failed:", error);
    });
    return { dispatched: true, reason: null };
  } catch (error) {
    return {
      dispatched: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

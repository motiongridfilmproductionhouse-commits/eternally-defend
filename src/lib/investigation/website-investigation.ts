/**
 * Website Investigation modal — types, response normalization, and URL helpers.
 */

export type WebsiteInvestigationModalState = "idle" | "investigating" | "completed" | "failed";

export interface WebsiteInvestigationResult {
  url: string;
  domain: string;
  threatScore: number;
  riskLevel: string;
  pageTitle: string | null;
  pageStatus: number | null;
  reachable: boolean;
  whoisRegistrar: string | null;
  whoisCreatedAt: string | null;
  whoisUpdatedAt: string | null;
  whoisExpiresAt: string | null;
  whoisAbuseEmail: string | null;
  whoisNameservers: string[];
  hostingProvider: string | null;
  ipAddress: string | null;
  country: string | null;
  city: string | null;
  cdn: string | null;
  waf: string | null;
  cms: string | null;
  framework: string | null;
  sslStatus: string | null;
  embeddedPlayers: string[];
  downloadLinks: string[];
  fileHostLinks: string[];
  torrentIndicators: string[];
  piracyIndicators: string[];
  evidenceFindings: string[];
  classification: string | null;
  investigatedAt: string;
}

export type NormalizedInvestigationOutcome =
  | { kind: "result"; result: WebsiteInvestigationResult }
  | { kind: "job"; jobId: string }
  | { kind: "error"; message: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url;
  }
}

function sslStatusFromUrl(url: string, httpStatus: number | null): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "No HTTPS";
    if (httpStatus && httpStatus >= 200 && httpStatus < 400) return "HTTPS reachable";
    if (httpStatus) return `HTTPS (${httpStatus})`;
    return "HTTPS";
  } catch {
    return "Unknown";
  }
}

/** Resolve investigation URL from copyright match or generic record shapes. */
export function resolveInvestigationUrl(match: unknown): string | null {
  const m = asRecord(match);
  if (!m) return null;

  const evidence = asRecord(m.evidence);
  const distribution = evidence ? asRecord(evidence.distribution) : null;

  const candidates = [m.url, m.source_url, m.canonical_url, m.final_url, distribution?.url];

  for (const candidate of candidates) {
    const value = asString(candidate);
    if (value && /^https?:\/\//i.test(value)) return value;
  }
  return null;
}

/** Normalize API payloads: response.investigation, response.data, or raw infrastructure report. */
export function normalizeInvestigationResponse(
  response: unknown,
  opts?: { classification?: string | null; fallbackUrl?: string | null },
): NormalizedInvestigationOutcome {
  const root = asRecord(response);
  if (!root) {
    return { kind: "error", message: "Invalid investigation response." };
  }

  const jobId = asString(root.jobId) ?? asString(root.job_id);
  const status = asString(root.status)?.toLowerCase();
  if (jobId && status !== "completed" && status !== "failed") {
    return { kind: "job", jobId };
  }

  const payload = asRecord(root.investigation) ?? asRecord(root.data) ?? root;

  if (status === "failed") {
    return {
      kind: "error",
      message: asString(root.error) ?? asString(payload.error) ?? "Investigation failed.",
    };
  }

  const normalized = normalizeInvestigationRecord(payload, opts);
  if (normalized) return { kind: "result", result: normalized };

  return { kind: "error", message: "No investigation data in response." };
}

export function normalizeInvestigationRecord(
  record: unknown,
  opts?: { classification?: string | null; fallbackUrl?: string | null },
): WebsiteInvestigationResult | null {
  const r = asRecord(record);
  if (!r) return null;

  const url =
    asString(r.url) ?? asString(r.finalUrl) ?? asString(r.final_url) ?? opts?.fallbackUrl ?? null;
  if (!url) return null;

  const dns = asRecord(r.dns);
  const whois = asRecord(r.whois);
  const http = asRecord(r.http);
  const page = asRecord(r.page);
  const provider = asRecord(r.provider);
  const risk = asRecord(r.risk);
  const ip = asRecord(r.ip);
  const cdnRaw = r.cdn;
  const cdnString = typeof cdnRaw === "string" ? cdnRaw : asString(asRecord(cdnRaw)?.provider);

  const httpStatus = asNumber(http?.status);
  const pageEvidence = asStringArray(page?.evidence);

  const embeddedPlayers: string[] = [];
  const downloadLinks: string[] = [];
  const torrentIndicators: string[] = [];
  const piracyIndicators: string[] = [];

  if (page?.hasStreaming === true) embeddedPlayers.push("Embedded streaming iframe/player");
  if (page?.hasVideo === true) embeddedPlayers.push("HTML5 or JS video player");
  if (page?.hasDownload === true) downloadLinks.push("Download links detected on page");
  if (page?.hasTorrent === true) torrentIndicators.push("Torrent file reference");
  if (page?.hasMagnet === true) torrentIndicators.push("Magnet link reference");

  for (const item of pageEvidence) {
    if (/embed|stream|player|video/i.test(item)) embeddedPlayers.push(item);
    else if (/download/i.test(item)) downloadLinks.push(item);
    else if (/torrent|magnet/i.test(item)) torrentIndicators.push(item);
    else piracyIndicators.push(item);
  }

  const threatScore =
    asNumber(r.threatScore) ?? asNumber(r.threat_score) ?? asNumber(risk?.score) ?? 0;

  const riskLevel =
    asString(r.riskLevel) ??
    asString(r.risk_level) ??
    asString(risk?.level) ??
    asString(risk?.severity) ??
    "Unknown";

  return {
    url,
    domain: asString(r.domain) ?? asString(r.hostname) ?? domainFromUrl(url),
    threatScore,
    riskLevel,
    pageTitle: asString(page?.title) ?? asString(r.pageTitle) ?? asString(r.page_title),
    pageStatus: httpStatus,
    reachable: httpStatus != null && httpStatus >= 200 && httpStatus < 500,
    whoisRegistrar: asString(whois?.registrar),
    whoisCreatedAt: asString(whois?.createdAt) ?? asString(whois?.created_at),
    whoisUpdatedAt: asString(whois?.updatedAt) ?? asString(whois?.updated_at),
    whoisExpiresAt: asString(whois?.expiresAt) ?? asString(whois?.expires_at),
    whoisAbuseEmail: asString(whois?.abuseEmail) ?? asString(whois?.abuse_email),
    whoisNameservers: asStringArray(whois?.nameservers),
    hostingProvider:
      asString(provider?.name) ?? asString(provider?.organization) ?? asString(provider?.hosting),
    ipAddress: asString(dns?.ipv4) ?? asString(ip?.ip),
    country: asString(ip?.country) ?? asString(provider?.country),
    city: asString(ip?.city),
    cdn: cdnString,
    waf: cdnString === "Cloudflare" ? "Cloudflare WAF/CDN" : null,
    cms: asString(page?.cms),
    framework: asString(page?.framework),
    sslStatus: sslStatusFromUrl(url, httpStatus),
    embeddedPlayers,
    downloadLinks,
    fileHostLinks: asStringArray(r.fileHostLinks ?? r.file_host_links),
    torrentIndicators,
    piracyIndicators,
    evidenceFindings: pageEvidence.length ? pageEvidence : piracyIndicators,
    classification: opts?.classification ?? asString(r.classification),
    investigatedAt:
      asString(r.investigatedAt) ??
      asString(r.investigated_at) ??
      asString(r.scannedAt) ??
      asString(r.scanned_at) ??
      new Date().toISOString(),
  };
}

export async function pollInvestigationJob(
  fetchJob: (jobId: string) => Promise<unknown>,
  jobId: string,
  opts?: { intervalMs?: number; maxAttempts?: number; signal?: AbortSignal },
): Promise<NormalizedInvestigationOutcome> {
  const intervalMs = opts?.intervalMs ?? 1_500;
  const maxAttempts = opts?.maxAttempts ?? 40;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (opts?.signal?.aborted) {
      return { kind: "error", message: "Investigation cancelled." };
    }

    const response = await fetchJob(jobId);
    console.log("[website-investigation] poll response", response);
    const outcome = normalizeInvestigationResponse(response);
    if (outcome.kind === "result" || outcome.kind === "error") return outcome;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return { kind: "error", message: "Investigation timed out while waiting for results." };
}

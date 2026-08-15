/**
 * On-domain copyright contact discovery — server side.
 *
 * Runs opportunistically during normal protection/discovery scans. It fetches a
 * host's OWN published legal/contact/copyright pages, extracts a literally
 * published on-domain mailbox, and records a `DISCOVERED_UNVERIFIED`
 * removal-route candidate for operator review in /admin/removal-routes.
 *
 * It never sends anything, never verifies a route, never touches the production
 * allowlist and never writes over an operator decision (VERIFIED / REJECTED /
 * MANUAL_REVIEW rows are left untouched).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { decidePlatformRoute } from "./removal-route-policy";
import {
  DISCOVERY_VERIFICATION_METHOD,
  LEGAL_PAGE_PATHS,
  buildEvidenceExcerpt,
  contentHash,
  evaluateDiscoveredContact,
  extractLegalLinks,
  extractEmails,
  hostOfUrl,
  normalizeDomain,
  rankContactCandidates,
  type ContactCandidate,
} from "./contact-discovery";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_PAGES = 10;

async function fetchText(url: string): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
    });
    const body = res.ok ? (await res.text()).slice(0, 400_000) : "";
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: "" };
  } finally {
    clearTimeout(timer);
  }
}

export interface ContactDiscoveryResult {
  domain: string;
  /** True only when an on-domain published contact was found and passed policy. */
  found: boolean;
  candidate: ContactCandidate | null;
  evidenceExcerpt: string | null;
  pageHash: string | null;
  pagesInspected: string[];
  rejected: Array<{ email: string; reasons: string[] }>;
  skippedReason: string | null;
}

/**
 * Inspects the publicly available legal/contact/copyright pages of an
 * independent host. Returns a proposal only — nothing is stored here.
 */
export async function discoverOnDomainCopyrightContact(
  targetUrl: string,
): Promise<ContactDiscoveryResult> {
  const domain = hostOfUrl(targetUrl) ?? "";
  const empty: ContactDiscoveryResult = {
    domain,
    found: false,
    candidate: null,
    evidenceExcerpt: null,
    pageHash: null,
    pagesInspected: [],
    rejected: [],
    skippedReason: null,
  };

  if (!domain) return { ...empty, skippedReason: "Target URL could not be parsed." };

  // Only independent hosts are eligible for the email route at all. Platforms,
  // CDN/proxy fronts, registrars and search surfaces are handled by the
  // human-action / manual-escalation workflows.
  const route = decidePlatformRoute(targetUrl);
  if (route.routeType !== "EMAIL_DMCA" || !route.emailEligible) {
    return {
      ...empty,
      skippedReason: `Host routes to ${route.routeType}; not an automated-email candidate.`,
    };
  }

  const origin = `https://${domain}`;
  const pages: string[] = [origin, ...LEGAL_PAGE_PATHS.map((p) => `${origin}${p}`)];
  const inspected: string[] = [];
  const rejected: Array<{ email: string; reasons: string[] }> = [];
  let best: { candidate: ContactCandidate; content: string } | null = null;
  let discoveredLinksAdded = false;

  for (let i = 0; i < pages.length && inspected.length < MAX_PAGES; i++) {
    const url = pages[i]!;
    const res = await fetchText(url);
    if (!res.ok || !res.body) continue;
    inspected.push(url);

    // Follow legal/contact links advertised on the homepage once.
    if (!discoveredLinksAdded && i === 0) {
      discoveredLinksAdded = true;
      for (const link of extractLegalLinks(res.body, url)) {
        if (!pages.includes(link)) pages.push(link);
      }
    }

    const emails = extractEmails(res.body);
    if (emails.length === 0) continue;

    const ranked = rankContactCandidates(emails, url, domain);
    for (const email of emails) {
      if (ranked.some((r) => r.email === email)) continue;
      const evaluation = evaluateDiscoveredContact({
        domain,
        email,
        sourceUrl: url,
        pageContent: res.body,
      });
      if (!evaluation.eligible && !rejected.some((r) => r.email === email)) {
        rejected.push({ email, reasons: evaluation.reasons });
      }
    }

    for (const candidate of ranked) {
      const evaluation = evaluateDiscoveredContact({
        domain,
        email: candidate.email,
        sourceUrl: url,
        pageContent: res.body,
      });
      if (!evaluation.eligible) {
        if (!rejected.some((r) => r.email === candidate.email)) {
          rejected.push({ email: candidate.email, reasons: evaluation.reasons });
        }
        continue;
      }
      if (!best || candidate.priority > best.candidate.priority) {
        best = { candidate, content: res.body };
      }
      break;
    }

    // A dedicated DMCA/copyright page with a specific mailbox is good enough.
    if (best && best.candidate.priority >= 0.95) break;
  }

  if (!best) {
    return {
      ...empty,
      pagesInspected: inspected,
      rejected,
      skippedReason:
        inspected.length === 0
          ? "No legal/contact page could be fetched from the host."
          : "No on-domain copyright contact published on the inspected pages.",
    };
  }

  return {
    domain,
    found: true,
    candidate: best.candidate,
    evidenceExcerpt: buildEvidenceExcerpt(best.content, best.candidate.email),
    pageHash: contentHash(best.content),
    pagesInspected: inspected,
    rejected,
    skippedReason: null,
  };
}

export interface RecordDiscoveredCandidateInput {
  supabase: any;
  result: ContactDiscoveryResult;
  /** Finding / case association for operator context. */
  findingId?: string | null;
  caseId?: string | null;
  findingUrl?: string | null;
  sourceType?: string | null;
}

export type RecordDiscoveredCandidateOutcome =
  | { stored: false; reason: string }
  | { stored: true; domain: string; recipient: string; status: "DISCOVERED_UNVERIFIED" };

/**
 * Writes (or refreshes) a DISCOVERED_UNVERIFIED candidate. Operator decisions
 * are never overwritten.
 */
export async function recordDiscoveredRouteCandidate(
  input: RecordDiscoveredCandidateInput,
): Promise<RecordDiscoveredCandidateOutcome> {
  const { supabase, result } = input;
  if (!result.found || !result.candidate) {
    return { stored: false, reason: result.skippedReason ?? "No eligible contact discovered." };
  }

  const domain = normalizeDomain(result.domain);
  const recipient = result.candidate.email;
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from("domain_enforcement_routes")
    .select("id,verification_status,recipient_email")
    .eq("domain", domain)
    .maybeSingle();

  const operatorDecided = ["VERIFIED", "REJECTED", "MANUAL_REVIEW", "STALE"];
  if (existing && operatorDecided.includes(String(existing.verification_status ?? ""))) {
    return {
      stored: false,
      reason: `Route for ${domain} already holds operator state ${existing.verification_status}; left untouched.`,
    };
  }

  const payload = {
    domain,
    route_type: "EMAIL_DMCA",
    platform_kind: "independent_site",
    recipient_email: recipient,
    contact: recipient,
    contact_type: "COPYRIGHT",
    preferred_method: "EMAIL",
    // Never VERIFIED. Operator promotion happens only in /admin/removal-routes.
    verification_status: "DISCOVERED_UNVERIFIED",
    verification_method: DISCOVERY_VERIFICATION_METHOD,
    authoritative_source_url: result.candidate.sourceUrl,
    source_url: result.candidate.sourceUrl,
    confidence: Math.min(0.5, result.candidate.priority / 2),
    evidence_snapshot: {
      excerpt: result.evidenceExcerpt,
      html_hash: result.pageHash,
      pages_inspected: result.pagesInspected,
      rejected_addresses: result.rejected,
      discovery_method: DISCOVERY_VERIFICATION_METHOD,
      recorded_at: now,
    },
    discovered_at: now,
    discovery_finding_id: input.findingId ?? null,
    discovery_case_id: input.caseId ?? null,
    discovery_finding_url: input.findingUrl ?? null,
    discovery_source_type: input.sourceType ?? null,
    verified_at: null,
    verified_by: null,
    last_checked_at: now,
    notes:
      "Automatically discovered from the host's own published legal/contact page. Requires operator verification before any send.",
    updated_at: now,
  };

  const { error } = existing
    ? await supabase.from("domain_enforcement_routes").update(payload).eq("id", existing.id)
    : await supabase.from("domain_enforcement_routes").insert(payload);

  if (error) return { stored: false, reason: error.message };

  return { stored: true, domain, recipient, status: "DISCOVERED_UNVERIFIED" };
}

/**
 * Convenience used by scan pipelines: discover + record in one best-effort step.
 * Failures are swallowed — contact discovery must never break a scan.
 */
export async function discoverAndRecordRouteCandidate(args: {
  supabase: any;
  targetUrl: string;
  findingId?: string | null;
  caseId?: string | null;
  sourceType?: string | null;
}): Promise<RecordDiscoveredCandidateOutcome> {
  try {
    const result = await discoverOnDomainCopyrightContact(args.targetUrl);
    return await recordDiscoveredRouteCandidate({
      supabase: args.supabase,
      result,
      findingId: args.findingId ?? null,
      caseId: args.caseId ?? null,
      findingUrl: args.targetUrl,
      sourceType: args.sourceType ?? null,
    });
  } catch (err) {
    return { stored: false, reason: err instanceof Error ? err.message : "discovery failed" };
  }
}

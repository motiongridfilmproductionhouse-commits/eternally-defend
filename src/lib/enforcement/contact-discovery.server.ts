/**
 * On-domain copyright contact discovery — server side.
 *
 * Runs opportunistically during normal protection/discovery scans. It fetches a
 * host's OWN authoritative pages (/dmca, /copyright, /legal, /terms, /contact
 * and equivalents advertised by the site itself), extracts a mailbox only when
 * the site's own visible page content publishes it as a contact, and records a
 * `DISCOVERED_UNVERIFIED` removal-route candidate for operator review in
 * /admin/removal-routes.
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
  contentHash,
  extractLegalLinks,
  extractEmails,
  hostOfUrl,
  normalizeDomain,
  rankContactCandidates,
  type ContactCandidate,
} from "./contact-discovery";
import {
  evaluateAuthoritativeEvidence,
  extractVisibleText,
  type AuthoritativePageKind,
  type VerificationMethodCandidate,
} from "./authoritative-evidence";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_PAGES = 12;

/** Page-kind preference when several authoritative pages publish an address. */
const KIND_RANK: AuthoritativePageKind[] = ["CONTACT", "TERMS", "LEGAL", "COPYRIGHT", "DMCA"];

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
  /** True only when an authoritative on-domain published contact was found. */
  found: boolean;
  candidate: ContactCandidate | null;
  evidenceExcerpt: string | null;
  pageHash: string | null;
  pagesInspected: string[];
  rejected: Array<{ email: string; reasons: string[] }>;
  skippedReason: string | null;
  /** Which kind of authoritative page published the address. */
  pageKind: AuthoritativePageKind | null;
  /** Method an operator may pick in /admin/removal-routes. Never applied here. */
  methodCandidate: VerificationMethodCandidate | null;
  /** The real authoritative page URL the address was read from. */
  evidenceUrl: string | null;
  /** Discovery confidence (always < 1; never sufficient to auto-send). */
  confidence: number;
  /** Human-readable authority signals for the operator. */
  signals: string[];
}

const EMPTY_EXTRAS = {
  pageKind: null,
  methodCandidate: null,
  evidenceUrl: null,
  confidence: 0,
  signals: [] as string[],
};

/**
 * Inspects the publicly available authoritative pages of an independent host.
 * Returns a proposal only — nothing is stored here.
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
    ...EMPTY_EXTRAS,
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
  let best: {
    candidate: ContactCandidate;
    evaluation: ReturnType<typeof evaluateAuthoritativeEvidence>;
    content: string;
  } | null = null;
  let discoveredLinksAdded = false;

  function noteRejection(email: string, reasons: string[]) {
    if (!rejected.some((r) => r.email === email)) rejected.push({ email, reasons });
  }

  function isBetter(
    next: ReturnType<typeof evaluateAuthoritativeEvidence>,
    nextPriority: number,
  ): boolean {
    if (!best) return true;
    const a = KIND_RANK.indexOf(best.evaluation.pageKind as AuthoritativePageKind);
    const b = KIND_RANK.indexOf(next.pageKind as AuthoritativePageKind);
    if (b !== a) return b > a;
    return nextPriority > best.candidate.priority;
  }

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

    // Only visible content counts as organisational publication.
    const visible = extractVisibleText(res.body);
    const emails = extractEmails(visible);
    if (emails.length === 0) continue;

    const ranked = rankContactCandidates(emails, url, domain);
    for (const email of emails) {
      if (ranked.some((r) => r.email === email)) continue;
      const evaluation = evaluateAuthoritativeEvidence({
        domain,
        email,
        sourceUrl: url,
        html: res.body,
      });
      if (!evaluation.supported) noteRejection(email, evaluation.reasons);
    }

    for (const candidate of ranked) {
      const evaluation = evaluateAuthoritativeEvidence({
        domain,
        email: candidate.email,
        sourceUrl: url,
        html: res.body,
      });
      if (!evaluation.supported) {
        noteRejection(candidate.email, evaluation.reasons);
        continue;
      }
      if (isBetter(evaluation, candidate.priority)) {
        best = { candidate, evaluation, content: res.body };
      }
      break;
    }

    // A dedicated DMCA page with a specific mailbox is good enough.
    if (best && best.evaluation.pageKind === "DMCA" && best.candidate.priority >= 0.95) break;
  }

  if (!best) {
    return {
      ...empty,
      pagesInspected: inspected,
      rejected,
      skippedReason:
        inspected.length === 0
          ? "No authoritative page could be fetched from the host."
          : "No copyright/legal contact is published on the host's own authoritative pages.",
    };
  }

  return {
    domain,
    found: true,
    candidate: best.candidate,
    evidenceExcerpt: best.evaluation.excerpt,
    pageHash: contentHash(best.content),
    pagesInspected: inspected,
    rejected,
    skippedReason: null,
    pageKind: best.evaluation.pageKind,
    methodCandidate: best.evaluation.methodCandidate,
    evidenceUrl: best.candidate.sourceUrl,
    confidence: best.evaluation.confidence,
    signals: best.evaluation.signals,
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
  | {
      stored: true;
      domain: string;
      recipient: string;
      status: "DISCOVERED_UNVERIFIED";
      pageKind: AuthoritativePageKind | null;
      evidenceUrl: string | null;
    };

/**
 * Writes (or refreshes) a DISCOVERED_UNVERIFIED candidate. Operator decisions
 * are never overwritten and historical evidence is preserved, never deleted.
 * Idempotent per domain: the table is keyed on `domain`.
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
    .select("id,verification_status,recipient_email,evidence_snapshot")
    .eq("domain", domain)
    .maybeSingle();

  const operatorDecided = ["VERIFIED", "REJECTED", "MANUAL_REVIEW", "STALE"];
  if (existing && operatorDecided.includes(String(existing.verification_status ?? ""))) {
    return {
      stored: false,
      reason: `Route for ${domain} already holds operator state ${existing.verification_status}; left untouched.`,
    };
  }

  // Preserve prior discovery evidence instead of discarding it.
  const priorSnapshot = (existing?.evidence_snapshot ?? null) as any;
  const history: any[] = Array.isArray(priorSnapshot?.evidence_history)
    ? priorSnapshot.evidence_history.slice(-9)
    : [];
  if (priorSnapshot && (priorSnapshot.excerpt || priorSnapshot.evidence_url)) {
    const { evidence_history: _drop, ...snapshotWithoutHistory } = priorSnapshot;
    history.push(snapshotWithoutHistory);
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
    authoritative_source_url: result.evidenceUrl ?? result.candidate.sourceUrl,
    source_url: result.evidenceUrl ?? result.candidate.sourceUrl,
    confidence: Math.min(0.5, result.confidence || result.candidate.priority / 2),
    evidence_snapshot: {
      excerpt: result.evidenceExcerpt,
      evidence_url: result.evidenceUrl,
      authoritative_page_kind: result.pageKind,
      verification_method_candidate: result.methodCandidate,
      authority_signals: result.signals,
      visible_text_verified: true,
      html_hash: result.pageHash,
      pages_inspected: result.pagesInspected,
      rejected_addresses: result.rejected,
      discovery_method: DISCOVERY_VERIFICATION_METHOD,
      recorded_at: now,
      evidence_history: history,
    },
    discovered_at: now,
    discovery_finding_id: input.findingId ?? null,
    discovery_case_id: input.caseId ?? null,
    discovery_finding_url: input.findingUrl ?? null,
    discovery_source_type: input.sourceType ?? null,
    verified_at: null,
    verified_by: null,
    last_checked_at: now,
    notes: `Automatically discovered on the host's own ${result.pageKind ?? "legal"} page. Requires operator verification before any send.`,
    updated_at: now,
  };

  const { error } = existing
    ? await supabase.from("domain_enforcement_routes").update(payload).eq("id", existing.id)
    : await supabase.from("domain_enforcement_routes").insert(payload);

  if (error) return { stored: false, reason: error.message };

  return {
    stored: true,
    domain,
    recipient,
    status: "DISCOVERED_UNVERIFIED",
    pageKind: result.pageKind,
    evidenceUrl: result.evidenceUrl,
  };
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

export interface ReprocessSummary {
  examined: number;
  upgraded: number;
  unchanged: number;
  dryRun: boolean;
  results: Array<{
    domain: string;
    upgraded: boolean;
    reason: string;
    pageKind?: AuthoritativePageKind | null;
    evidenceUrl?: string | null;
    recipient?: string | null;
  }>;
}

/**
 * Re-runs authoritative-evidence discovery for existing DISCOVERED_UNVERIFIED
 * routes. Idempotent (upsert-by-domain), never promotes a route, never deletes
 * history and never touches operator-decided rows. `dryRun` writes nothing.
 */
export async function reprocessDiscoveredRouteCandidates(args: {
  supabase: any;
  limit?: number;
  dryRun?: boolean;
  domains?: string[];
}): Promise<ReprocessSummary> {
  const dryRun = args.dryRun !== false;
  const limit = Math.max(1, Math.min(args.limit ?? 25, 200));

  let query = args.supabase
    .from("domain_enforcement_routes")
    .select("id,domain,verification_status,source_url,authoritative_source_url")
    .eq("verification_status", "DISCOVERED_UNVERIFIED")
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (args.domains?.length) query = query.in("domain", args.domains.map(normalizeDomain));

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const summary: ReprocessSummary = {
    examined: 0,
    upgraded: 0,
    unchanged: 0,
    dryRun,
    results: [],
  };

  for (const row of (data ?? []) as any[]) {
    const domain = normalizeDomain(row.domain);
    if (!domain) continue;
    summary.examined += 1;
    const result = await discoverOnDomainCopyrightContact(`https://${domain}/`);

    if (!result.found) {
      summary.unchanged += 1;
      summary.results.push({
        domain,
        upgraded: false,
        reason: result.skippedReason ?? "No authoritative evidence found.",
      });
      continue;
    }

    if (dryRun) {
      summary.upgraded += 1;
      summary.results.push({
        domain,
        upgraded: true,
        reason: "Authoritative evidence available (dry run — nothing written).",
        pageKind: result.pageKind,
        evidenceUrl: result.evidenceUrl,
        recipient: result.candidate?.email ?? null,
      });
      continue;
    }

    const stored = await recordDiscoveredRouteCandidate({
      supabase: args.supabase,
      result,
      findingUrl: row.source_url ?? null,
      sourceType: "route_reprocess",
    });
    if (stored.stored) {
      summary.upgraded += 1;
      summary.results.push({
        domain,
        upgraded: true,
        reason: "Evidence upgraded; route remains DISCOVERED_UNVERIFIED.",
        pageKind: stored.pageKind,
        evidenceUrl: stored.evidenceUrl,
        recipient: stored.recipient,
      });
    } else {
      summary.unchanged += 1;
      summary.results.push({ domain, upgraded: false, reason: stored.reason });
    }
  }

  return summary;
}

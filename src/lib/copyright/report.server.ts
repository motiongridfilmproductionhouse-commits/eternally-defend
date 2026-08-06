/**
 * Copyright threat intelligence report generation (server-only).
 *
 * Fetches a completed investigation, enriches verified sources with domain
 * intelligence, embeds preserved evidence images, renders the dossier PDF and
 * stores it in the evidence vault.
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { putObject, getSignedGetUrl } from "@/lib/aws/s3.server";
import { readStoredObject } from "@/lib/copyright/storage.server";
import { enrichDomainIntel } from "@/lib/copyright/domain-intel.server";
import type { DomainIntel } from "@/lib/copyright/domain-intel";
import { parseRecentActivity } from "@/lib/copyright/scan-activity";
import {
  buildCopyrightReportModel,
  selectReportMatches,
  type CopyrightReportModel,
  type ReportMatchRow,
  type ReportScanRow,
} from "@/lib/copyright/report-model";
import { renderCopyrightReportPdf, type ThreatScreenshot } from "@/lib/copyright/report-pdf.server";

type AnySupabase = SupabaseClient<any, any, any>;

const MAX_ENRICHED_DOMAINS = 12;
const MAX_EMBEDDED_SCREENSHOTS = 12;

export interface GeneratedCopyrightReport {
  reportId: string;
  storageKey: string;
  sha256: string;
  bytes: number;
  threats: number;
  generatedAt: string;
  fileName: string;
}

function hashOf(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function screenshotKeyFor(match: ReportMatchRow): string | null {
  const ev = rec(match.evidence);
  const dist = rec(ev.distribution);
  const candidates = [dist.evidence_screenshot, ev.evidence_screenshot, ev.reference_key];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate && !candidate.startsWith("http"))
      return candidate;
  }
  return null;
}

function contentTypeForKey(key: string): string {
  if (/\.png$/i.test(key)) return "image/png";
  if (/\.webp$/i.test(key)) return "image/webp";
  return "image/jpeg";
}

async function resolveClientName(supabase: AnySupabase, userId: string | null): Promise<string> {
  if (!userId) return "Eterna Client";
  try {
    const { data } = await supabase
      .from("profiles")
      .select("display_name,full_name,legal_name,company_name,email")
      .eq("id", userId)
      .maybeSingle();
    const row = rec(data);
    for (const key of ["legal_name", "company_name", "full_name", "display_name", "email"]) {
      const value = row[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    /* profile lookup is best-effort */
  }
  return "Eterna Client";
}

/** Build the report model for a scan, without rendering. */
export async function buildReportForScan(
  supabase: AnySupabase,
  scanId: string,
): Promise<{ model: CopyrightReportModel; screenshots: ThreatScreenshot[] } | null> {
  const { data: scan, error } = await supabase
    .from("copyright_scans")
    .select("*")
    .eq("id", scanId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!scan) return null;

  const { data: matchRows, error: matchError } = await supabase
    .from("copyright_matches")
    .select("*")
    .eq("scan_id", scanId)
    .order("confidence", { ascending: false });
  if (matchError) throw new Error(matchError.message);

  const matches = (matchRows ?? []) as unknown as ReportMatchRow[];
  const verified = selectReportMatches(matches);

  // Domain intelligence for the highest-confidence verified domains.
  const domainIntel: Record<string, DomainIntel | undefined> = {};
  const seen = new Set<string>();
  for (const match of verified) {
    const dist = rec(rec(match.evidence).distribution);
    const domain =
      typeof dist.domain === "string" && dist.domain
        ? dist.domain
        : (() => {
            try {
              return new URL(match.source_url).hostname.replace(/^www\./, "").toLowerCase();
            } catch {
              return null;
            }
          })();
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    if (seen.size > MAX_ENRICHED_DOMAINS) break;
    try {
      domainIntel[domain] = await enrichDomainIntel(match.source_url);
    } catch (enrichError) {
      console.warn(
        "[copyright-report] domain enrichment failed:",
        domain,
        enrichError instanceof Error ? enrichError.message : enrichError,
      );
    }
  }

  // Preserved evidence images from the vault.
  const screenshots: ThreatScreenshot[] = [];
  for (const match of verified.slice(0, MAX_EMBEDDED_SCREENSHOTS)) {
    const key = screenshotKeyFor(match);
    if (!key) continue;
    try {
      const bytes = await readStoredObject(key);
      if (bytes?.length) {
        screenshots.push({ matchId: match.id, bytes, contentType: contentTypeForKey(key) });
      }
    } catch (readError) {
      console.warn(
        "[copyright-report] evidence image unavailable:",
        key,
        readError instanceof Error ? readError.message : readError,
      );
    }
  }

  const scanRow = scan as unknown as ReportScanRow & { user_id?: string | null };
  const stats = rec(scanRow.stats);
  const timelineEvents = parseRecentActivity(stats)
    .filter((event) => event.threat === "verified_finding" || event.threat === "high_risk")
    .map((event) => ({
      occurred_at: event.occurred_at,
      label: `${event.stage_label} — ${event.hostname} (${event.threat_label})`,
    }));

  const model = buildCopyrightReportModel({
    scan: scanRow,
    matches,
    clientName: await resolveClientName(supabase, scanRow.user_id ?? null),
    generatedAt: new Date().toISOString(),
    domainIntel,
    screenshotMatchIds: screenshots.map((shot) => shot.matchId),
    timelineEvents,
    hash: hashOf,
  });

  return { model, screenshots };
}

/** Render and store the dossier for a scan; returns metadata for scan stats. */
export async function generateAndStoreCopyrightReport(
  supabase: AnySupabase,
  scanId: string,
  userId: string,
): Promise<GeneratedCopyrightReport | null> {
  const built = await buildReportForScan(supabase, scanId);
  if (!built) return null;

  const bytes = await renderCopyrightReportPdf(built.model, built.screenshots);
  const slug =
    built.model.protectedAsset
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "investigation";
  const fileName = `eterna-threat-intelligence-${slug}.pdf`;
  const storageKey = `clients/${userId}/evidence/reports/${scanId}/${fileName}`;

  await putObject({ key: storageKey, body: bytes, contentType: "application/pdf" });

  return {
    reportId: built.model.reportId,
    storageKey,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    threats: built.model.threats.length,
    generatedAt: built.model.generatedAt,
    fileName,
  };
}

/** Persist report metadata onto the scan's stats payload. */
export async function attachReportToScanStats(
  supabase: AnySupabase,
  scanId: string,
  report: GeneratedCopyrightReport,
): Promise<void> {
  const { data } = await supabase
    .from("copyright_scans")
    .select("stats")
    .eq("id", scanId)
    .maybeSingle();
  const stats = rec(rec(data).stats);
  await supabase
    .from("copyright_scans")
    .update({
      stats: {
        ...stats,
        threat_report: {
          report_id: report.reportId,
          storage_key: report.storageKey,
          file_name: report.fileName,
          sha256: report.sha256,
          bytes: report.bytes,
          threats: report.threats,
          generated_at: report.generatedAt,
        },
      } as never,
    })
    .eq("id", scanId);
}

/** Best-effort auto-generation hook used when a scan completes. */
export async function autoGenerateCopyrightReport(
  supabase: AnySupabase,
  scanId: string,
  userId: string,
): Promise<void> {
  try {
    const report = await generateAndStoreCopyrightReport(supabase, scanId, userId);
    if (report) await attachReportToScanStats(supabase, scanId, report);
  } catch (error) {
    console.warn(
      "[copyright-report] auto generation failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

/** Signed download URL for a stored report. */
export async function signReportUrl(storageKey: string): Promise<string> {
  return getSignedGetUrl(storageKey, 900);
}

/**
 * Deepfake threat report generation (server-only).
 *
 * Loads an owned scan + client-visible findings + profile identity data,
 * renders the dossier PDF, stores it in the evidence vault, and records
 * metadata in generated_reports.
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { putObject, getSignedGetUrl } from "@/lib/aws/s3.server";
import { filterClientFindings } from "./client-results.server";
import { normalizeClientFinding } from "./results-dashboard";
import {
  buildDeepfakeReportModel,
  type DeepfakeReportModel,
  type ReportFindingInput,
  type ReportProfileInput,
  type ReportScanInput,
} from "./report-model";
import { renderDeepfakeReportPdf } from "./report-pdf.server";

type AnySupabase = SupabaseClient<any, any, any>;

export interface GeneratedDeepfakeReport {
  reportId: string;
  storageKey: string;
  sha256: string;
  bytes: number;
  findings: number;
  generatedAt: string;
  fileName: string;
  scanId: string;
  profileId: string | null;
  historyId: string | null;
}

function hashOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function resolveClientName(
  supabase: AnySupabase,
  userId: string | null,
): Promise<string> {
  if (!userId) return "Eterna Client";
  try {
    const { data } = await supabase
      .from("profiles")
      .select("display_name,full_name,legal_name,company_name,email")
      .eq("id", userId)
      .maybeSingle();
    const row = rec(data);
    for (const key of [
      "legal_name",
      "company_name",
      "full_name",
      "display_name",
      "email",
    ]) {
      const value = row[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    /* profile lookup is best-effort */
  }
  return "Eterna Client";
}

async function loadProfile(
  supabase: AnySupabase,
  userId: string,
  profileId: string | null | undefined,
): Promise<ReportProfileInput | null> {
  if (!profileId) return null;

  const { data, error } = await supabase
    .from("deepfake_target_profiles")
    .select("id,target_name,authorization_status,rekognition_collection_id")
    .eq("id", profileId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const { count } = await supabase
    .from("deepfake_reference_faces")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId);

  return {
    id: data.id,
    target_name: data.target_name,
    authorization_status: data.authorization_status,
    rekognition_collection_id: data.rekognition_collection_id,
    reference_face_count: count ?? 0,
  };
}

/** Resolve which scan to report on for a profile (or explicit scan). */
export async function resolveDeepfakeReportScan(
  supabase: AnySupabase,
  userId: string,
  input: { scanId?: string; profileId?: string },
): Promise<ReportScanInput> {
  if (input.scanId) {
    const { data, error } = await supabase
      .from("deepfake_scans")
      .select("*")
      .eq("id", input.scanId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Scan not found.");
    if (input.profileId && data.profile_id && data.profile_id !== input.profileId) {
      throw new Error("Selected scan does not belong to this identity profile.");
    }
    return data as ReportScanInput;
  }

  if (!input.profileId) {
    throw new Error("Select a protected identity profile or scan first.");
  }

  const { data, error } = await supabase
    .from("deepfake_scans")
    .select("*")
    .eq("user_id", userId)
    .eq("profile_id", input.profileId)
    .neq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message);
  const scans = (data ?? []) as ReportScanInput[];
  if (!scans.length) {
    throw new Error(
      "No Deepfake Intelligence scans found for this protected identity yet.",
    );
  }

  const preferred =
    scans.find((scan) =>
      ["completed", "partial", "running"].includes(scan.status),
    ) ?? scans[0];

  return preferred;
}

/** Build the report model for a scan without rendering. */
export async function buildReportForDeepfakeScan(
  supabase: AnySupabase,
  userId: string,
  scanId: string,
  profileId?: string | null,
): Promise<DeepfakeReportModel | null> {
  const { data: scan, error } = await supabase
    .from("deepfake_scans")
    .select("*")
    .eq("id", scanId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!scan) return null;

  const scanRow = scan as ReportScanInput;
  const resolvedProfileId = profileId ?? scanRow.profile_id ?? null;
  const profile = await loadProfile(supabase, userId, resolvedProfileId);

  if (resolvedProfileId && !profile) {
    throw new Error("Protected identity profile was not found or is not accessible.");
  }

  const { data: findingRows, error: findingError } = await supabase
    .from("deepfake_findings")
    .select("*")
    .eq("scan_id", scanId)
    .eq("user_id", userId)
    .order("confidence", { ascending: false });
  if (findingError) throw new Error(findingError.message);

  const target = {
    name: scanRow.target_name,
    aliases: scanRow.aliases ?? [],
    handles: scanRow.handles ?? [],
  };

  const visible = filterClientFindings(
    (findingRows ?? []) as Array<{
      scan_id: string;
      url: string;
      page_title?: string | null;
      snippet?: string | null;
      finding_classification?: string | null;
      url_verification_status?: string | null;
      final_url?: string | null;
      canonical_url?: string | null;
      discovered_url?: string | null;
      [key: string]: unknown;
    }>,
    target,
    scanId,
  );

  const findings: ReportFindingInput[] = [];
  for (const row of visible) {
    const normalized = normalizeClientFinding(row);
    if (!normalized) continue;
    findings.push({
      ...normalized,
      face_similarity:
        typeof row.face_similarity === "number" ? row.face_similarity : null,
      target_face_match:
        typeof row.target_face_match === "boolean"
          ? row.target_face_match
          : null,
    });
  }

  return buildDeepfakeReportModel({
    scan: scanRow,
    findings,
    profile,
    clientName: await resolveClientName(supabase, userId),
    generatedAt: new Date().toISOString(),
    hash: hashOf,
  });
}

async function findExistingReport(
  supabase: AnySupabase,
  userId: string,
  scanId: string,
): Promise<GeneratedDeepfakeReport | null> {
  const { data, error } = await supabase
    .from("generated_reports")
    .select("*")
    .eq("user_id", userId)
    .eq("kind", "Deepfake Threat Report")
    .eq("status", "Ready")
    .order("created_at", { ascending: false })
    .limit(25);

  if (error || !data?.length) return null;

  for (const row of data) {
    const filters = rec(row.filters);
    if (filters.scan_id !== scanId) continue;
    const storageKey =
      typeof filters.storage_key === "string" ? filters.storage_key : null;
    if (!storageKey) continue;
    return {
      reportId:
        typeof filters.report_id === "string"
          ? filters.report_id
          : row.id,
      storageKey,
      sha256: typeof filters.sha256 === "string" ? filters.sha256 : "",
      bytes: typeof filters.bytes === "number" ? filters.bytes : 0,
      findings:
        typeof row.findings_count === "number" ? row.findings_count : 0,
      generatedAt:
        typeof filters.generated_at === "string"
          ? filters.generated_at
          : row.created_at,
      fileName:
        typeof filters.file_name === "string"
          ? filters.file_name
          : "eterna-deepfake-report.pdf",
      scanId,
      profileId:
        typeof filters.profile_id === "string" ? filters.profile_id : null,
      historyId: row.id,
    };
  }

  return null;
}

async function persistReportHistory(
  supabase: AnySupabase,
  userId: string,
  report: GeneratedDeepfakeReport,
  protectedIdentity: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("generated_reports")
    .insert({
      user_id: userId,
      name: `Deepfake Threat Report — ${protectedIdentity}`,
      kind: "Deepfake Threat Report",
      status: "Ready",
      findings_count: report.findings,
      filters: {
        scan_id: report.scanId,
        profile_id: report.profileId,
        storage_key: report.storageKey,
        file_name: report.fileName,
        sha256: report.sha256,
        bytes: report.bytes,
        report_id: report.reportId,
        generated_at: report.generatedAt,
      },
    })
    .select("id")
    .maybeSingle();

  if (error) {
    console.warn(
      "[deepfake-report] history insert failed:",
      error.message,
    );
    return null;
  }

  return data?.id ?? null;
}

/** Render and store the dossier; returns download metadata. */
export async function generateAndStoreDeepfakeReport(
  supabase: AnySupabase,
  userId: string,
  input: { scanId?: string; profileId?: string; force?: boolean },
): Promise<GeneratedDeepfakeReport> {
  const scan = await resolveDeepfakeReportScan(supabase, userId, {
    scanId: input.scanId,
    profileId: input.profileId,
  });

  if (!input.force) {
    const existing = await findExistingReport(supabase, userId, scan.id);
    if (existing) return existing;
  }

  const model = await buildReportForDeepfakeScan(
    supabase,
    userId,
    scan.id,
    input.profileId ?? scan.profile_id,
  );
  if (!model) throw new Error("Scan not found.");

  const bytes = await renderDeepfakeReportPdf(model);
  const slug =
    model.protectedIdentity
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "protected-identity";
  const fileName = `eterna-deepfake-threat-report-${slug}.pdf`;
  const storageKey = `clients/${userId}/evidence/deepfake-reports/${scan.id}/${fileName}`;

  await putObject({
    key: storageKey,
    body: bytes,
    contentType: "application/pdf",
  });

  const report: GeneratedDeepfakeReport = {
    reportId: model.reportId,
    storageKey,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    findings: model.findings.length,
    generatedAt: model.generatedAt,
    fileName,
    scanId: scan.id,
    profileId: model.profileId,
    historyId: null,
  };

  report.historyId = await persistReportHistory(
    supabase,
    userId,
    report,
    model.protectedIdentity,
  );

  return report;
}

export async function signDeepfakeReportUrl(
  storageKey: string,
): Promise<string> {
  return getSignedGetUrl(storageKey, 900);
}

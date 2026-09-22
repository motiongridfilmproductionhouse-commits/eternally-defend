/**
 * Reputation Intelligence / Web Scan — public web-discovery dispatch.
 *
 * Extracted verbatim (behavior-preserving) from
 * src/routes/api/public/hooks/scan-orchestrator.ts so it can be called both
 * from the normal per-user cron tick (scan-orchestrator.ts, one row at a
 * time, on its own cadence) and from an admin-gated bulk audit run
 * (src/lib/protection/admin-bulk-web-scan.functions.ts, many users, on
 * demand) without duplicating the discovery/merge/persist logic.
 *
 * Runs ONLY the public web-search/discovery workflow: it calls /api/scan
 * (the discovery pipeline) and persists results via persistScanCore. It
 * never submits takedowns, sends notices, or triggers enforcement — those
 * are separate modules (copyright_intel, youtube_removal, etc.) with their
 * own dispatch files.
 */

export interface ReputationWebScanOutcome {
  status: string;
  candidates_found: number;
  verified_findings: number;
  blocked_reason: string | null;
}

export interface ReputationWebScanOptions {
  /**
   * When true, persistScanCore skips its best-effort AWS Rekognition face
   * analysis step for this run's hits. The normal per-user cron tick leaves
   * this false (unchanged, existing behavior); callers that must guarantee
   * no face/identity module runs (the admin bulk web-discovery audit) pass
   * true.
   */
  skipFaceAnalysis?: boolean;
}

export async function runReputationWebScan(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  userId: string,
  opts: ReputationWebScanOptions = {},
): Promise<ReputationWebScanOutcome> {
  const [{ data: profile }, { data: assets }] = await Promise.all([
    supabaseAdmin.from("protection_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("digital_assets").select("*").eq("user_id", userId),
  ]);
  if (!profile) {
    return {
      status: "FAILED",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: "NO_PROTECTION_PROFILE",
    };
  }

  const { data: aliasRows } = await supabaseAdmin
    .from("protection_profile_aliases")
    .select("alias")
    .eq("profile_id", profile.id)
    .eq("active", true);

  const query = (profile.display_name || profile.verified_name || "").trim();
  if (!query) {
    return {
      status: "FAILED",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: "NO_SUBJECT_NAME",
    };
  }

  const aliasNames = (aliasRows ?? [])
    .map((a: { alias: string }) => a.alias)
    .filter((a: string) => a && a.toLowerCase() !== query.toLowerCase());

  const handles: string[] = [];
  const instagramHandles: string[] = [];
  const isInstagramAsset = (channelUrl: unknown, metadata: unknown): boolean =>
    (typeof channelUrl === "string" && channelUrl.toLowerCase().includes("instagram.com")) ||
    (typeof metadata === "object" &&
      metadata !== null &&
      (metadata as Record<string, unknown>).platform === "instagram");
  for (const a of assets ?? []) {
    if (!a.handle) continue;
    const clean = String(a.handle).replace(/^@/, "");
    handles.push(clean);
    if (isInstagramAsset(a.channel_url, a.metadata)) instagramHandles.push(clean);
  }
  for (const s of Array.isArray(profile.official_socials) ? profile.official_socials : []) {
    const rec = s as Record<string, unknown>;
    const handle = rec?.handle;
    if (typeof handle !== "string" || !handle.trim()) continue;
    const clean = handle.replace(/^@/, "");
    handles.push(clean);
    if (rec.platform === "instagram" || isInstagramAsset(rec.url, undefined)) {
      instagramHandles.push(clean);
    }
  }

  const publicBase = process.env.PUBLIC_APP_URL ?? "https://eternally-defend.lovable.app";

  /*
   * A single all-sources /api/scan call routinely exceeded the hosted
   * request budget and died at the edge with HTTP 524 (observed as
   * blocked_reason=scan_http_524, 0 candidates, module stuck "Partial —
   * retrying"). The pipeline itself is fine — the payload was simply too
   * large for one request. So the orchestrator now runs the same sources in
   * small segments, each with its own client-side timeout below the gateway
   * limit, and merges the results. A slow/failed segment degrades that
   * segment only instead of losing the whole scan.
   */
  const SEGMENTS: string[][] = [
    ["web", "blogs", "forums", "reviews"],
    ["news", "x"],
    ["youtube"],
    ["reddit"],
    ["instagram"],
  ];
  const SEGMENT_TIMEOUT_MS = 50_000;

  const basePayload = {
    query,
    aliases: aliasNames.slice(0, 20),
    handles: Array.from(new Set(handles)).slice(0, 20),
    instagramHandles: Array.from(new Set(instagramHandles)).slice(0, 5),
    monthFilter: "30d" as const,
  };

  type Report = import("@/routes/api/scan").ReputationReport;
  const reports: Report[] = [];
  const failures: string[] = [];

  const settled = await Promise.allSettled(
    SEGMENTS.map(async (sources) => {
      const label = sources.join("+");
      try {
        const res = await fetch(`${publicBase}/api/scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...basePayload, sources }),
          signal: AbortSignal.timeout(SEGMENT_TIMEOUT_MS),
        });
        if (!res.ok) {
          failures.push(`${label}:http_${res.status}`);
          return null;
        }
        const report = (await res.json()) as Report;
        if (!report?.ok) {
          failures.push(`${label}:${(report?.error ?? "scan_failed").slice(0, 60)}`);
          return null;
        }
        return report;
      } catch (err) {
        const message = (err as Error).name === "TimeoutError" ? "timeout" : (err as Error).message;
        failures.push(`${label}:${String(message).slice(0, 60)}`);
        return null;
      }
    }),
  );

  for (const entry of settled) {
    if (entry.status === "fulfilled" && entry.value) reports.push(entry.value);
  }

  if (reports.length === 0) {
    return {
      status: "PROVIDER_LIMITED",
      candidates_found: 0,
      verified_findings: 0,
      blocked_reason: (failures.join(" | ") || "SCAN_UNAVAILABLE").slice(0, 200),
    };
  }

  const candidates = reports.reduce((sum, r) => sum + (r.totals?.total ?? 0), 0);
  const verified = reports.reduce(
    (sum, r) => sum + (r.totals?.critical ?? 0) + (r.totals?.high ?? 0),
    0,
  );

  try {
    const { persistScanCore } = await import("@/lib/scans.functions");
    const { mapReputationReportToPersistInput } = await import("@/lib/scan/persist-mapping");

    // Merge every successful segment into one scan row so the dashboard sees
    // a single run per cadence, not five.
    const mapped = reports.map(mapReputationReportToPersistInput);
    const merged = {
      ...mapped[0],
      sources: Array.from(new Set(mapped.flatMap((m) => m.sources ?? []))),
      params: {
        period: mapped[0].period,
        sources: Array.from(new Set(mapped.flatMap((m) => m.sources ?? []))),
      },
      hits: mapped.flatMap((m) => m.hits),
      totals: {
        total: mapped.reduce((s, m) => s + (m.totals?.total ?? 0), 0),
        unique: mapped.reduce((s, m) => s + (m.totals?.unique ?? 0), 0),
        duplicatesRemoved: mapped.reduce((s, m) => s + (m.totals?.duplicatesRemoved ?? 0), 0),
      },
    };
    await persistScanCore(supabaseAdmin, userId, merged, {
      skipFaceAnalysis: opts.skipFaceAnalysis ?? false,
    });
  } catch (err) {
    console.error("[reputation-web-scan] persist failed", userId, err);
    return {
      status: "PARTIAL",
      candidates_found: candidates,
      verified_findings: 0,
      blocked_reason: "PERSIST_FAILED",
    };
  }

  if (failures.length) {
    return {
      status: "PARTIAL",
      candidates_found: candidates,
      verified_findings: verified,
      blocked_reason: failures.join(" | ").slice(0, 200),
    };
  }

  return {
    status: "COMPLETED",
    candidates_found: candidates,
    verified_findings: verified,
    blocked_reason: null,
  };
}

/**
 * Revalidate / deactivate stale official-catalog and YouTube promotional
 * distribution_sources without deleting audit history.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  isAuthorizedCatalogHost,
  isNeverMonitoredDomain,
  isYouTubeHost,
} from "./official-platforms";
import { hostOf } from "./url.server";

type DB = SupabaseClient<Database>;

export function isStaleOfficialMonitoredSource(opts: {
  url: string;
  domain?: string | null;
  content_type?: string | null;
  classification?: string | null;
}): boolean {
  const url = opts.url || `https://${opts.domain ?? ""}/`;
  if (isYouTubeHost(url) || isAuthorizedCatalogHost(url) || isNeverMonitoredDomain(url)) {
    return true;
  }
  const host = (opts.domain ?? hostOf(url) ?? "").toLowerCase();
  if (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtu.be" ||
    host === "watch.plex.tv" ||
    host.endsWith(".plex.tv") ||
    host === "plex.tv"
  ) {
    return true;
  }
  const ct = `${opts.content_type ?? ""} ${opts.classification ?? ""}`.toLowerCase();
  if (
    ct.includes("trailer") ||
    ct.includes("official") ||
    ct.includes("catalog") ||
    ct.includes("cinema") ||
    ct.includes("promo")
  ) {
    // Only auto-deactivate when host is also a never-monitor / catalog host.
    return isNeverMonitoredDomain(url) || isAuthorizedCatalogHost(url);
  }
  return false;
}

/**
 * Soft-deactivate YouTube / Plex / authorized-catalog false-positive sources.
 * Preserves rows and incidents for audit; marks incidents inactive for counters.
 */
export async function deactivateStaleOfficialSources(
  supabase: DB,
  opts?: { userId?: string; limit?: number },
): Promise<{ sourcesDeactivated: number; incidentsDeactivated: number }> {
  let q = supabase
    .from("distribution_sources")
    .select("id, url, domain, content_type, status, monitor_enabled, evidence")
    .neq("status", "deactivated")
    .limit(opts?.limit ?? 200);
  if (opts?.userId) q = q.eq("user_id", opts.userId);

  const { data, error } = await q;
  if (error || !data?.length) {
    return { sourcesDeactivated: 0, incidentsDeactivated: 0 };
  }

  const stale = data.filter((row) =>
    isStaleOfficialMonitoredSource({
      url: row.url,
      domain: row.domain,
      content_type: row.content_type,
      classification:
        row.evidence && typeof row.evidence === "object"
          ? String((row.evidence as Record<string, unknown>).classification ?? "")
          : null,
    }),
  );

  let sourcesDeactivated = 0;
  let incidentsDeactivated = 0;
  const nowIso = new Date().toISOString();

  for (const row of stale) {
    const priorEvidence =
      row.evidence && typeof row.evidence === "object"
        ? (row.evidence as Record<string, unknown>)
        : {};
    const { error: uErr } = await supabase
      .from("distribution_sources")
      .update({
        status: "deactivated",
        monitor_enabled: false,
        evidence: {
          ...priorEvidence,
          deactivated_at: nowIso,
          deactivation_reason:
            "Stale official/catalog/YouTube promotional source — hostname alone is not piracy; deactivated without deleting audit history.",
          deactivation_kind: "stale_official_false_positive",
        } as Database["public"]["Tables"]["distribution_sources"]["Update"]["evidence"],
      })
      .eq("id", row.id);
    if (uErr) continue;
    sourcesDeactivated += 1;

    // Soft-deactivate incidents for accurate counters (audit rows retained).
    const { data: incidents } = await supabase
      .from("distribution_incidents")
      .select("id, evidence")
      .eq("source_id", row.id)
      .limit(100);

    for (const inc of incidents ?? []) {
      const ev =
        inc.evidence && typeof inc.evidence === "object"
          ? (inc.evidence as Record<string, unknown>)
          : {};
      if (ev.active === false) continue;
      const { error: iErr } = await supabase
        .from("distribution_incidents")
        .update({
          evidence: {
            ...ev,
            active: false,
            deactivated_at: nowIso,
            deactivation_reason:
              "Parent source deactivated as stale official/catalog false positive.",
          } as Database["public"]["Tables"]["distribution_incidents"]["Update"]["evidence"],
        })
        .eq("id", inc.id);
      if (!iErr) incidentsDeactivated += 1;
    }
  }

  return { sourcesDeactivated, incidentsDeactivated };
}

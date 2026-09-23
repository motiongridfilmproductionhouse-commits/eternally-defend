/**
 * Pre-Enrollment Intelligence — production entry point for one scan run.
 *
 * Called only from staff-authorised server functions after the scan row exists.
 * Loads the locked identity from the scan, wires the real providers, and runs
 * the scan with the service-role client (background work has no user session).
 */

import type { IdentityTargetProfile } from "./identity-resolution";
import { runProspectScanSafely, type RunnerResult } from "./runner";
import { createProspectStore } from "./store.server";
import { fetchPublicPage, productionDetector, productionExecutors } from "./providers.server";

/** Hard ceiling so a stuck provider can never leave a scan "running" forever. */
const SCAN_DEADLINE_MS = 280_000;

export async function executeProspectScan(scanId: string): Promise<RunnerResult | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;

  const { data: scan, error } = await db
    .from("prospect_scans")
    .select("id, prospect_id, status")
    .eq("id", scanId)
    .maybeSingle();
  if (error || !scan) throw new Error(`Prospect scan ${scanId} not found`);
  // Atomic claim: a scan runs exactly once. A rescan is always a new run.
  const { data: claimed } = await db
    .from("prospect_scans")
    .update({ status: "running" })
    .eq("id", scanId)
    .eq("status", "queued")
    .select("id");
  if (!claimed?.length) return null;

  const { data: identity, error: identityError } = await db
    .from("prospect_identities")
    .select("*")
    .eq("id", scan.prospect_id)
    .maybeSingle();
  if (identityError || !identity) throw new Error(`Prospect identity for scan ${scanId} not found`);

  const handles = Array.isArray(identity.known_handles) ? (identity.known_handles as string[]) : [];
  const target: IdentityTargetProfile = {
    name: identity.display_name,
    aliases: identity.aliases ?? [],
    profession: identity.profession,
    organization: identity.organization,
    countryRegion: identity.country_region,
    knownWebsite: identity.known_website,
    knownProfileUrl: identity.known_profile_url,
    knownHandles: handles,
    knownWorks: identity.known_works ?? [],
    linkedEntities: identity.linked_entities ?? [],
    nameIsAmbiguous: identity.name_is_ambiguous ?? false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_DEADLINE_MS);
  try {
    return await runProspectScanSafely(
      {
        store: createProspectStore(db, scanId, scan.prospect_id),
        executors: productionExecutors(),
        fetchPage: fetchPublicPage,
        detector: productionDetector(),
        signal: controller.signal,
      },
      { target },
    );
  } finally {
    clearTimeout(timer);
  }
}

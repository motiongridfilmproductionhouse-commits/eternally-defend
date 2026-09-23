/**
 * Pre-Enrollment Intelligence — production entry point for scan steps.
 *
 * Serverless runtimes (Cloudflare Workers, Vercel) only keep background work
 * alive for a short window, so a scan advances in bounded, resumable steps.
 * Each step:
 *   1. takes a short lease on the scan row (one step at a time, ever),
 *   2. re-derives all state from stored rows and runs as many units as fit,
 *   3. releases the lease.
 * Steps are started by the staff server functions only (after the staff check).
 */

import { randomUUID } from "node:crypto";
import type { IdentityTargetProfile } from "./identity-resolution";
import { runProspectScanStepSafely } from "./runner";
import { createProspectStore } from "./store.server";
import { fetchPublicPage, productionDetector, productionExecutors } from "./providers.server";

const LEASE_GRACE_MS = 15_000;

export interface AdvanceResult {
  status: string;
  done: boolean;
  leased: boolean;
  unitsRun: number;
}

export async function advanceProspectScan(
  scanId: string,
  budgetMs = 20_000,
): Promise<AdvanceResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;

  const { data: scan, error } = await db
    .from("prospect_scans")
    .select("id, prospect_id, status")
    .eq("id", scanId)
    .maybeSingle();
  if (error || !scan) throw new Error(`Prospect scan ${scanId} not found`);
  if (!["queued", "running"].includes(scan.status)) {
    return { status: scan.status, done: true, leased: false, unitsRun: 0 };
  }

  const leaseId = randomUUID();
  const nowIso = new Date().toISOString();
  const { data: claimed } = await db
    .from("prospect_scans")
    .update({
      worker_lease_until: new Date(Date.now() + budgetMs + LEASE_GRACE_MS).toISOString(),
      worker_lease_id: leaseId,
    })
    .eq("id", scanId)
    .in("status", ["queued", "running"])
    .or(`worker_lease_until.is.null,worker_lease_until.lt.${nowIso}`)
    .select("id");
  if (!claimed?.length) return { status: scan.status, done: false, leased: false, unitsRun: 0 };

  try {
    const { data: identity, error: identityError } = await db
      .from("prospect_identities")
      .select("*")
      .eq("id", scan.prospect_id)
      .maybeSingle();
    if (identityError || !identity)
      throw new Error(`Prospect identity for scan ${scanId} not found`);

    const handles = Array.isArray(identity.known_handles)
      ? (identity.known_handles as string[])
      : [];
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
    const timer = setTimeout(() => controller.abort(), budgetMs + 10_000);
    try {
      const result = await runProspectScanStepSafely(
        {
          store: createProspectStore(db, scanId, scan.prospect_id),
          executors: productionExecutors(),
          fetchPage: fetchPublicPage,
          detector: productionDetector(),
          signal: controller.signal,
        },
        { target },
        { budgetMs },
      );
      const { data: after } = await db
        .from("prospect_scans")
        .select("status")
        .eq("id", scanId)
        .single();
      return {
        status: after?.status ?? scan.status,
        done: result.done,
        leased: true,
        unitsRun: result.unitsRun,
      };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await db
      .from("prospect_scans")
      .update({ worker_lease_until: null, worker_lease_id: null })
      .eq("id", scanId)
      .eq("worker_lease_id", leaseId);
  }
}

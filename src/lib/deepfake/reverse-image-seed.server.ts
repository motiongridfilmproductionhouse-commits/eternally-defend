/**
 * Reverse-image seeding for deepfake / synthetic-media scans.
 *
 * Text queries cannot find an anonymously posted face-swap. The client's own
 * enrolled reference face is therefore published as a short-lived signed URL
 * and pushed through the reverse-image providers; returned pages enter the
 * normal deepfake candidate pipeline (crawl → classify → face verification),
 * so this only widens discovery and never asserts a finding on its own.
 *
 * Scoped to the authenticated account's own reference faces only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  reverseImageProvidersConfigured,
  reverseImageSearch,
} from "@/lib/discovery/reverse-image.server";
import { classifyPlatform } from "@/lib/media/platform-classifier";
import { isBlockedHost } from "./queries";
import type { DiscoveredLead } from "./multi-provider-discovery.server";

const REFERENCE_BUCKET = "deepfake-reference-faces";

export interface DeepfakeReverseImageSeed {
  leads: DiscoveredLead[];
  diagnostics: {
    configured_providers: string[];
    reference_faces_used: number;
    providers_succeeded: string[];
    providers_failed: Array<{ provider: string; reason: string }>;
    raw_candidates: number;
    seeded_leads: number;
    skipped: number;
    error?: string;
  };
}

export async function seedDeepfakeLeadsFromReferenceFaces({
  supabase,
  userId,
  subject,
  maxFaces = 2,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, "public", any>;
  userId: string;
  subject: string;
  maxFaces?: number;
}): Promise<DeepfakeReverseImageSeed> {
  const configured = reverseImageProvidersConfigured();
  const diagnostics: DeepfakeReverseImageSeed["diagnostics"] = {
    configured_providers: configured,
    reference_faces_used: 0,
    providers_succeeded: [],
    providers_failed: [],
    raw_candidates: 0,
    seeded_leads: 0,
    skipped: 0,
  };
  if (!configured.length) {
    return { leads: [], diagnostics: { ...diagnostics, error: "no_reverse_image_provider" } };
  }

  try {
    const { data: faces, error } = await supabase
      .from("deepfake_reference_faces")
      .select("id, storage_path")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(maxFaces);
    if (error) throw new Error(error.message);

    const paths = (faces ?? [])
      .map((face: { storage_path: string | null }) => face.storage_path)
      .filter((path: string | null): path is string => Boolean(path));
    if (!paths.length) {
      return { leads: [], diagnostics: { ...diagnostics, error: "no_reference_face_enrolled" } };
    }

    const seen = new Set<string>();
    const leads: DiscoveredLead[] = [];

    for (const path of paths) {
      const { data: signed, error: signError } = await supabase.storage
        .from(REFERENCE_BUCKET)
        .createSignedUrl(path, 900);
      if (signError || !signed?.signedUrl) {
        diagnostics.skipped += 1;
        continue;
      }
      diagnostics.reference_faces_used += 1;

      const report = await reverseImageSearch(signed.signedUrl, { subjectHint: subject });
      diagnostics.raw_candidates += report.candidates.length;
      for (const provider of report.providersSucceeded) {
        if (!diagnostics.providers_succeeded.includes(provider)) {
          diagnostics.providers_succeeded.push(provider);
        }
      }
      diagnostics.providers_failed.push(...report.providersFailed);

      for (const candidate of report.candidates) {
        const url = candidate.pageUrl;
        if (!url || seen.has(url)) {
          diagnostics.skipped += 1;
          continue;
        }
        const platform = candidate.platform ?? classifyPlatform(url);
        if (!platform || platform.isInfrastructure || platform.isSearchSurface) {
          diagnostics.skipped += 1;
          continue;
        }
        if (isBlockedHost(url)) {
          diagnostics.skipped += 1;
          continue;
        }
        seen.add(url);
        leads.push({
          url,
          title: candidate.title ?? "",
          description: candidate.source ?? "",
          query: `reverse_image_search(${candidate.matchType})`,
          source: `reverse_image:${candidate.provider}`,
          thumbnail_url: candidate.thumbnailUrl ?? undefined,
          image_url: candidate.imageUrl ?? undefined,
        });
      }
    }

    diagnostics.seeded_leads = leads.length;
    return { leads, diagnostics };
  } catch (err) {
    return { leads: [], diagnostics: { ...diagnostics, error: (err as Error).message } };
  }
}

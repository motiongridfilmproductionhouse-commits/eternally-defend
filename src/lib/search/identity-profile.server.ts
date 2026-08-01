/**
 * Persist / load resolved search identities.
 * Never overwrites reviewer-approved or user-provided aliases with AI/heuristic ones.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AliasSource,
  PersistedIdentityHints,
  SearchExpansionResult,
} from "./identity-types";
import { invalidateIdentityExpansionCache } from "./identity-search-expander.server";
import { normalizeKey } from "./identity-knowledge.server";

type DB = SupabaseClient<any>;

export type StoredAlias = {
  alias: string;
  source: AliasSource;
  active: boolean;
};

/** Load reviewer/user persisted identity hints for expansion. */
export async function loadPersistedIdentityHints(
  supabase: DB,
  opts: {
    userId: string;
    query: string;
    knownAliases?: string[];
  },
): Promise<PersistedIdentityHints | null> {
  try {
    const needles = [opts.query, ...(opts.knownAliases ?? [])]
      .map((n) => n.trim())
      .filter(Boolean);
    if (!needles.length) return null;
    const { data } = await supabase
      .from("search_identity_profiles")
      .select("*")
      .eq("user_id", opts.userId)
      .order("updated_at", { ascending: false })
      .limit(25);
    if (!data?.length) return null;
    const normNeedles = new Set(needles.map((n) => normalizeKey(n)));
    const match = data.find((row) => {
      const names = [
        row.canonical_name,
        row.corrected_name,
        ...((row.aliases as string[] | null) ?? []),
        ...((row.local_language_names as string[] | null) ?? []),
      ]
        .filter(Boolean)
        .map((n) => normalizeKey(String(n)));
      return names.some((n) => normNeedles.has(n));
    });
    if (!match) return null;
    const detailed = Array.isArray(match.aliases_detailed)
      ? (match.aliases_detailed as StoredAlias[])
      : [];
    return {
      canonicalName: match.reviewer_confirmed ? String(match.canonical_name) : null,
      aliases: [
        ...((match.aliases as string[] | null) ?? []),
        ...detailed
          .filter((a) => a.active && a.source !== "rejected")
          .map((a) => a.alias),
      ],
      handles: (match.official_handles as string[] | null) ?? [],
      localLanguageNames: (match.local_language_names as string[] | null) ?? [],
      reviewerConfirmed: Boolean(match.reviewer_confirmed),
      rejectedAliases: detailed
        .filter((a) => a.source === "rejected" || !a.active)
        .map((a) => a.alias),
    };
  } catch {
    return null;
  }
}

function uniqueHandles(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const t = v.trim();
    if (!t) continue;
    const key = normalizeKey(t) || t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function mergeAliasLists(
  existing: StoredAlias[],
  incoming: Array<{ alias: string; source: AliasSource }>,
): StoredAlias[] {
  const map = new Map<string, StoredAlias>();
  for (const row of existing) {
    map.set(normalizeKey(row.alias) || row.alias, row);
  }
  for (const row of incoming) {
    const key = normalizeKey(row.alias) || row.alias;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { alias: row.alias, source: row.source, active: true });
      continue;
    }
    // Never overwrite approved/user aliases; never revive rejected as active discovery.
    if (prev.source === "reviewer_approved" || prev.source === "user_provided") continue;
    if (prev.source === "rejected") continue;
    map.set(key, { ...prev, alias: row.alias, source: row.source, active: true });
  }
  return [...map.values()];
}

export async function upsertSearchIdentityProfile(
  supabase: DB,
  opts: {
    userId: string;
    expansion: SearchExpansionResult;
    entityType?: string;
  },
): Promise<{ id: string } | null> {
  const expansion = opts.expansion;
  // Never commit a spelling-corrected celebrity name while resolution is ambiguous.
  const canonical = expansion.ambiguous
    ? expansion.canonicalName?.trim() || null
    : expansion.canonicalName?.trim() ||
      expansion.correctedQuery.trim() ||
      expansion.originalQuery.trim();
  if (!canonical) return null;

  const { data: existing } = await supabase
    .from("search_identity_profiles")
    .select("*")
    .eq("user_id", opts.userId)
    .eq("canonical_name", canonical)
    .maybeSingle();

  const existingAliases = Array.isArray(existing?.aliases_detailed)
    ? (existing.aliases_detailed as StoredAlias[])
    : [];

  const incoming: Array<{ alias: string; source: AliasSource }> = [];
  for (const [alias, source] of Object.entries(expansion.aliasSources)) {
    incoming.push({ alias, source });
  }
  for (const alias of expansion.aliases) {
    if (!incoming.some((i) => normalizeKey(i.alias) === normalizeKey(alias))) {
      incoming.push({ alias, source: expansion.aliasSources[alias] ?? "ai_discovered" });
    }
  }

  const mergedDetailed = mergeAliasLists(existingAliases, incoming);
  const activeAliases = mergedDetailed.filter((a) => a.active && a.source !== "rejected").map((a) => a.alias);

  // Preserve manually confirmed canonical when reviewer locked it.
  const canonicalName =
    existing?.reviewer_confirmed && existing?.canonical_name
      ? existing.canonical_name
      : canonical;

  const payload = {
    user_id: opts.userId,
    canonical_name: canonicalName,
    corrected_name: expansion.correctedQuery,
    entity_type: opts.entityType ?? expansion.entityType,
    aliases: activeAliases,
    aliases_detailed: mergedDetailed,
    local_language_names: expansion.localLanguageNames,
    former_names: expansion.formerNames,
    nicknames: expansion.nicknames,
    official_handles: expansion.usernames,
    related_shows: expansion.relatedShows,
    related_films: expansion.relatedFilms,
    character_names: expansion.characterNames,
    professions: expansion.professions,
    organizations: expansion.organizations,
    identity_confidence: expansion.confidence,
    identity_ambiguous: expansion.ambiguous,
    identity_last_resolved_at: new Date().toISOString(),
    identity_resolution_source: expansion.resolutionSource,
    last_expansion: {
      original_query: expansion.originalQuery,
      search_queries: expansion.searchQueries,
      ambiguity_candidates: expansion.ambiguityCandidates,
      diagnostics: expansion.diagnostics,
    },
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("search_identity_profiles")
    .upsert(payload, { onConflict: "user_id,canonical_name" })
    .select("id")
    .single();

  if (error || !data) {
    console.warn("[identity-profile] upsert failed:", error?.message);
    return null;
  }
  return { id: data.id as string };
}

export async function mutateIdentityAlias(
  supabase: DB,
  opts: {
    userId: string;
    profileId: string;
    action:
      | "add_alias"
      | "remove_alias"
      | "approve_alias"
      | "reject_alias"
      | "mark_handle"
      | "confirm_identity"
      | "report_wrong_identity";
    value: string;
    canonicalName?: string;
  },
): Promise<{ ok: boolean; profileId?: string }> {
  const { data: profile } = await supabase
    .from("search_identity_profiles")
    .select("*")
    .eq("id", opts.profileId)
    .eq("user_id", opts.userId)
    .maybeSingle();
  if (!profile) return { ok: false };

  let detailed = Array.isArray(profile.aliases_detailed)
    ? ([...profile.aliases_detailed] as StoredAlias[])
    : [];
  const value = opts.value.trim();
  const key = normalizeKey(value);

  const upsertAlias = (source: AliasSource, active: boolean) => {
    const idx = detailed.findIndex((a) => (normalizeKey(a.alias) || a.alias) === key);
    if (idx >= 0) detailed[idx] = { alias: value, source, active };
    else detailed.push({ alias: value, source, active });
  };

  let reviewerConfirmed = Boolean(profile.reviewer_confirmed);
  let canonicalName = profile.canonical_name as string;
  let handles = Array.isArray(profile.official_handles)
    ? [...(profile.official_handles as string[])]
    : [];

  switch (opts.action) {
    case "add_alias":
      upsertAlias("user_provided", true);
      break;
    case "remove_alias":
      detailed = detailed.filter((a) => (normalizeKey(a.alias) || a.alias) !== key);
      break;
    case "approve_alias":
      upsertAlias("reviewer_approved", true);
      break;
    case "reject_alias":
      upsertAlias("rejected", false);
      break;
    case "mark_handle":
      if (!handles.some((h) => normalizeKey(h) === key)) handles.push(value);
      break;
    case "confirm_identity":
      reviewerConfirmed = true;
      if (opts.canonicalName?.trim()) canonicalName = opts.canonicalName.trim();
      else if (value) canonicalName = value;
      break;
    case "report_wrong_identity":
      reviewerConfirmed = false;
      break;
    default:
      break;
  }

  const activeAliases = detailed
    .filter((a) => a.active && a.source !== "rejected")
    .map((a) => a.alias);

  // If confirming to a canonical name that already exists for this user,
  // merge into that row instead of violating UNIQUE(user_id, canonical_name).
  if (
    opts.action === "confirm_identity" &&
    canonicalName &&
    normalizeKey(canonicalName) !== normalizeKey(String(profile.canonical_name ?? ""))
  ) {
    const { data: existingCanon } = await supabase
      .from("search_identity_profiles")
      .select("id")
      .eq("user_id", opts.userId)
      .eq("canonical_name", canonicalName)
      .maybeSingle();
    if (existingCanon?.id && existingCanon.id !== opts.profileId) {
      const { data: targetRow } = await supabase
        .from("search_identity_profiles")
        .select("*")
        .eq("id", existingCanon.id)
        .eq("user_id", opts.userId)
        .maybeSingle();
      const targetDetailed = Array.isArray(targetRow?.aliases_detailed)
        ? (targetRow!.aliases_detailed as StoredAlias[])
        : [];
      const mergedDetailed = mergeAliasLists(
        targetDetailed,
        detailed.map((a) => ({ alias: a.alias, source: a.source })),
      );
      const mergedHandles = uniqueHandles([
        ...((targetRow?.official_handles as string[] | null) ?? []),
        ...handles,
      ]);
      const mergedAliases = mergedDetailed
        .filter((a) => a.active && a.source !== "rejected")
        .map((a) => a.alias);
      const { error: mergeErr } = await supabase
        .from("search_identity_profiles")
        .update({
          aliases: mergedAliases,
          aliases_detailed: mergedDetailed,
          official_handles: mergedHandles,
          reviewer_confirmed: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingCanon.id)
        .eq("user_id", opts.userId);
      if (!mergeErr) {
        await supabase
          .from("search_identity_profiles")
          .delete()
          .eq("id", opts.profileId)
          .eq("user_id", opts.userId);
      }
      invalidateIdentityExpansionCache({ all: true });
      return mergeErr
        ? { ok: false }
        : { ok: true, profileId: existingCanon.id as string };
    }
  }

  const { error } = await supabase
    .from("search_identity_profiles")
    .update({
      canonical_name: canonicalName,
      aliases: activeAliases,
      aliases_detailed: detailed,
      official_handles: handles,
      reviewer_confirmed: reviewerConfirmed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", opts.profileId)
    .eq("user_id", opts.userId);

  invalidateIdentityExpansionCache({ userId: opts.userId, all: false });
  invalidateIdentityExpansionCache({ all: true });
  return error ? { ok: false } : { ok: true, profileId: opts.profileId };
}

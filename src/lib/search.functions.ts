import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  expansionDiagnostics,
  resolveAndExpandSearchQuerySafe,
} from "@/lib/search/identity-search-expander.server";
import {
  loadPersistedIdentityHints,
  mutateIdentityAlias,
  upsertSearchIdentityProfile,
} from "@/lib/search/identity-profile.server";
import { invalidateIdentityExpansionCache } from "@/lib/search/identity-search-expander.server";

const moduleEnum = z.enum([
  "general",
  "reputation",
  "deepfake",
  "impersonation",
  "copyright",
  "youtube",
  "reddit",
  "news",
  "social",
  "image",
  "monitoring",
  "manual",
]);

/** Preview identity expansion for scan UIs (fail-open). */
export const previewSearchExpansion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        query: z.string().trim().min(1).max(200),
        entityType: z.string().trim().max(40).optional(),
        module: moduleEnum.optional().default("general"),
        knownAliases: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
        knownHandles: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
        country: z.string().trim().max(80).optional(),
        language: z.string().trim().max(40).optional(),
        persist: z.boolean().optional().default(false),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const persistedProfile = await loadPersistedIdentityHints(context.supabase, {
      userId: context.userId,
      query: data.query,
      knownAliases: data.knownAliases,
    }).catch(() => null);
    const expansion = await resolveAndExpandSearchQuerySafe({
      query: data.query,
      entityType: data.entityType,
      module: data.module,
      knownAliases: data.knownAliases,
      knownHandles: data.knownHandles,
      country: data.country,
      language: data.language,
      userId: context.userId,
      persistedProfile,
    });

    let profileId: string | null = null;
    if (data.persist) {
      const saved = await upsertSearchIdentityProfile(context.supabase, {
        userId: context.userId,
        expansion,
        entityType: data.entityType,
      }).catch(() => null);
      profileId = saved?.id ?? null;
    } else {
      // Surface an existing profile id even when preview does not re-persist.
      profileId = persistedProfile?.profileId ?? null;
    }

    return {
      expansion: expansionDiagnostics(expansion),
      searchingAs: expansion.canonicalName ?? expansion.correctedQuery,
      alsoSearching: [
        ...expansion.aliases,
        ...expansion.localLanguageNames,
        ...expansion.characterNames,
        ...expansion.relatedShows.map((s) => `${s} (show)`),
      ].slice(0, 12),
      removableAliases: expansion.aliases.slice(0, 12),
      ambiguous: expansion.ambiguous,
      ambiguityCandidates: expansion.ambiguityCandidates,
      searchQueries: expansion.searchQueries,
      profileId,
    };
  });

export const updateSearchIdentityAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        profileId: z.string().uuid(),
        action: z.enum([
          "add_alias",
          "remove_alias",
          "approve_alias",
          "reject_alias",
          "mark_handle",
          "confirm_identity",
          "report_wrong_identity",
        ]),
        value: z.string().trim().min(1).max(200),
        canonicalName: z.string().trim().max(200).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const result = await mutateIdentityAlias(context.supabase, {
      userId: context.userId,
      profileId: data.profileId,
      action: data.action,
      value: data.value,
      canonicalName: data.canonicalName,
    });
    invalidateIdentityExpansionCache({ userId: context.userId });
    if (!result.ok) throw new Error("Could not update identity alias.");
    return { ok: true, profileId: result.profileId ?? data.profileId };
  });

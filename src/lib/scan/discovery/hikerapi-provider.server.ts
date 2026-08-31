/**
 * HikerAPI discovery adapter — Instagram account search, registered in the
 * DiscoveryRouter alongside Brave/SerpApi/Google/Gemini.
 *
 * Deliberately the CHEAPEST possible HikerAPI call (one account-search
 * request per query, no follow-on media/tagged/comments calls): the router
 * fans every discovery query out to every healthy provider, and a scan can
 * generate dozens of queries (aliases, AI-research expansions, etc.), so
 * anything more expensive here would defeat "cost-efficient discovery" the
 * moment HikerAPI is enabled. The deeper, per-profile capabilities (own
 * media, reels, tagged media, comments) live in ./hikerapi-instagram.server
 * and run at most once per scan, only for already-identity-linked handles —
 * see that file's header comment for the full cost-control rationale.
 */

import { isHikerApiEnabled, searchAccounts, canonicalProfileUrl } from "./hikerapi-client.server";
import { ProviderError, type SearchProviderAdapter } from "./provider";
import type { DiscoveryHit } from "./types";

export const hikerapiProvider: SearchProviderAdapter = {
  id: "hikerapi",
  label: "HikerAPI (Instagram)",

  isConfigured() {
    return isHikerApiEnabled();
  },

  async search(query, limit, signal) {
    if (!isHikerApiEnabled()) {
      throw new ProviderError("auth_failed", "HikerAPI is not enabled (HIKERAPI_ENABLED/HIKERAPI_ACCESS_KEY)");
    }

    const users = await searchAccounts(query, signal);
    const capped = users.slice(0, Math.min(Math.max(limit, 1), 10));

    const hits: DiscoveryHit[] = [];
    for (const u of capped) {
      if (!u.username) continue;
      hits.push({
        url: canonicalProfileUrl(u.username),
        title: u.full_name || u.username,
        description: u.biography ?? undefined,
        author: u.username,
        media: u.profile_pic_url_hd || u.profile_pic_url
          ? { thumbnail: u.profile_pic_url ?? undefined, thumbnailHi: u.profile_pic_url_hd ?? undefined }
          : undefined,
        provider: "hikerapi",
        // Extra, non-DiscoveryHit-standard fields — the interface allows
        // arbitrary passthrough keys ([key: string]: unknown), and
        // hikerapi-instagram.server.ts's deep-dive step reads these back to
        // avoid a redundant getUserByUsername lookup for the same account.
        instagramUserId: String(u.pk),
        instagramIsPrivate: u.is_private ?? undefined,
        instagramIsVerified: u.is_verified ?? undefined,
        instagramFollowerCount: u.follower_count ?? undefined,
      });
    }
    return hits;
  },
};

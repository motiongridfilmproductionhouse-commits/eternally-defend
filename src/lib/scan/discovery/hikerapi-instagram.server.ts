/**
 * HikerAPI — Instagram deep-dive discovery, run at most once per scan.
 *
 * This is deliberately NOT wired through DiscoveryRouter.search() (see
 * ./hikerapi-provider.server.ts for the cheap, router-registered account
 * search). Tagged media, own media/reels, and comments only make sense for
 * an already-identified profile — running them once per free-text query
 * (as the router would) could multiply into dozens of HikerAPI requests per
 * scan (one per alias/AI-research-expansion query), which is exactly what
 * Task 9's cost controls forbid. Instead this runs once per scan, only for:
 *
 *   1. Instagram usernames already confirmed as this client's own handle
 *      (protection_profiles/digital_assets — passed in as `instagramHandles`,
 *      the highest-value case: someone else's post TAGGING the client's real
 *      account is a strong reputation-risk signal), and
 *   2. At most one best-guess account resolved from the plain-text query
 *      (name/alias) via HikerAPI's own account search, only when no known
 *      handle exists at all — never both, and never more than one guess.
 *
 * A hard per-scan request budget (HikerApiRequestBudget) bounds the total
 * number of HikerAPI calls regardless of how many handles/candidates exist,
 * mirroring the shape of the existing AiCallBudget
 * (src/lib/scan/openai/client.server.ts) rather than inventing a new
 * budgeting concept.
 *
 * Output is RawHit-compatible (src/routes/api/scan.ts's RawHit is a
 * structural superset of DiscoveryHit) so these results merge into
 * `mergedRuns` exactly the way runReddit's/runYouTube's raw hits already do
 * — no new merge/dedup/persistence path, no new threat-classification path.
 * A HikerAPI-sourced hit is never treated as pre-classified: it enters the
 * same buildReport() classification/verification pipeline as any other
 * source, only carrying enough metadata to skip redundant page extraction.
 */

import {
  canonicalMediaUrl,
  canonicalProfileUrl,
  getUserByUsername,
  getUserTaggedMedias,
  getUserMedias,
  getUserClips,
  isHikerApiEnabled,
  type HikerMedia,
  type HikerUser,
} from "./hikerapi-client.server";
import { ProviderError } from "./provider";

/** Mirrors AiCallBudget's shape (src/lib/scan/openai/client.server.ts) — take-until-exhausted. */
export class HikerApiRequestBudget {
  private used = 0;
  constructor(private readonly max: number) {}
  get remaining(): number {
    return Math.max(0, this.max - this.used);
  }
  take(): boolean {
    if (this.used >= this.max) return false;
    this.used++;
    return true;
  }
}

function defaultBudgetSize(): number {
  const raw = Number(process.env.HIKERAPI_MAX_REQUESTS_PER_SCAN ?? 8);
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 30) : 8;
}

/** Minimal shape this module needs from RawHit — kept structural, not imported, to avoid a cycle with scan.ts. */
interface HikerApiRawHit {
  url: string;
  title?: string;
  description?: string;
  author?: string;
  date?: string;
  publishedDate?: string;
  media?: { thumbnail?: string; thumbnailHi?: string; instagramMediaPk?: string };
  pageText?: string;
}

function mediaToHit(media: HikerMedia): HikerApiRawHit {
  const caption = media.caption_text?.trim() || undefined;
  return {
    url: canonicalMediaUrl(media),
    title: media.user?.username ? `Instagram — @${media.user.username}` : "Instagram post",
    description: caption,
    author: media.user?.username ?? undefined,
    date: media.taken_at ?? undefined,
    publishedDate: media.taken_at ?? undefined,
    media: {
      thumbnail: media.thumbnail_url ?? undefined,
      thumbnailHi: media.thumbnail_url ?? undefined,
      // Marker so the extraction stage skips re-fetching this URL — HikerAPI
      // already gave us the structured caption/metadata (same convention as
      // the existing `media.videoId` skip for YouTube API leads).
      instagramMediaPk: media.pk,
    },
    // Pre-populated exactly like a successful Crawl4AI/plain-fetch extraction
    // would set it, so downstream classification has real text to work with
    // even though the extraction stage itself is skipped for this hit.
    pageText: caption,
  };
}

async function resolveHandle(
  username: string,
  budget: HikerApiRequestBudget,
  signal?: AbortSignal,
): Promise<HikerUser | null> {
  if (!budget.take()) return null;
  try {
    return await getUserByUsername(username, signal);
  } catch (e) {
    console.warn(
      `[scan:hikerapi] resolve @${username} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

/**
 * @param query Primary client name (used only as a last-resort account-search
 *   fallback when no known Instagram handle is available).
 * @param instagramHandles Known/confirmed Instagram usernames for this client
 *   (from protection_profiles/digital_assets) — see scan-orchestrator.ts and
 *   src/routes/api/scan.ts for how this is threaded in. Distinct from the
 *   generic, mixed-platform `handles[]` already in the request body: only
 *   Instagram-specific handles belong here, so a YouTube/TikTok handle is
 *   never sent to getUserByUsername and misresolved against an unrelated
 *   Instagram account.
 */
export async function runHikerApiInstagram(
  query: string,
  instagramHandles: string[],
  signal?: AbortSignal,
): Promise<{ raw: HikerApiRawHit[]; error?: string; requestsUsed: number }> {
  if (!isHikerApiEnabled()) {
    return { raw: [], requestsUsed: 0 };
  }

  const budget = new HikerApiRequestBudget(defaultBudgetSize());
  const raw: HikerApiRawHit[] = [];
  const seenMediaUrls = new Set<string>();
  const seenProfileUrls = new Set<string>();

  const addMedia = (media: HikerMedia) => {
    const hit = mediaToHit(media);
    if (seenMediaUrls.has(hit.url)) return;
    seenMediaUrls.add(hit.url);
    raw.push(hit);
  };

  const profiles: HikerUser[] = [];
  const cleanHandles = Array.from(
    new Set(instagramHandles.map((h) => h.replace(/^@/, "").trim().toLowerCase()).filter(Boolean)),
  ).slice(0, 3); // a client has at most a small handful of legitimate official accounts

  try {
    if (cleanHandles.length) {
      for (const handle of cleanHandles) {
        const user = await resolveHandle(handle, budget, signal);
        if (user) profiles.push(user);
      }
    } else if (query.trim()) {
      // No known handle at all — one best-guess account-search call, top
      // result only. This is intentionally the ONLY place a free-text name
      // can turn into a "confirmed" profile for the deep-dive step; being
      // wrong here only means we deep-dive an unrelated public account, not
      // that we misattribute content to the client (buildReport's identity
      // verification stage still gates any resulting finding).
      if (budget.take()) {
        const { searchAccounts } = await import("./hikerapi-client.server");
        const found = await searchAccounts(query.trim(), signal);
        if (found[0]) profiles.push(found[0]);
      }
    }

    for (const profile of profiles) {
      if (!profile.username) continue;
      const profileUrl = canonicalProfileUrl(profile.username);
      if (!seenProfileUrls.has(profileUrl)) {
        seenProfileUrls.add(profileUrl);
        raw.push({
          url: profileUrl,
          title: profile.full_name || profile.username,
          description: profile.biography ?? undefined,
          author: profile.username,
          media: profile.profile_pic_url_hd
            ? { thumbnail: profile.profile_pic_url ?? undefined, thumbnailHi: profile.profile_pic_url_hd ?? undefined }
            : undefined,
        });
      }

      const userId = String(profile.pk);

      // Tagged media first — the highest reputation-risk-relevant signal
      // (someone ELSE posting about the client), one page only.
      if (budget.take()) {
        try {
          const tagged = await getUserTaggedMedias(userId, undefined, signal);
          for (const m of tagged.items) addMedia(m);
        } catch (e) {
          console.warn(
            `[scan:hikerapi] tagged media for @${profile.username} failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      // Own recent media, one page only.
      if (budget.take()) {
        try {
          const medias = await getUserMedias(userId, undefined, signal);
          for (const m of medias.items) addMedia(m);
        } catch (e) {
          console.warn(
            `[scan:hikerapi] user medias for @${profile.username} failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      // Own reels, one page only — only if budget remains (medias/tagged
      // already cover the account; reels are a nice-to-have, not essential).
      if (budget.remaining > 0 && budget.take()) {
        try {
          const clips = await getUserClips(userId, undefined, signal);
          for (const m of clips.items) addMedia(m);
        } catch (e) {
          console.warn(
            `[scan:hikerapi] user clips for @${profile.username} failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }
  } catch (e) {
    const message =
      e instanceof ProviderError
        ? e.message
        : e instanceof Error
          ? e.message
          : "HikerAPI Instagram discovery failed";
    console.error(`[scan:hikerapi] ${message}`);
    return { raw, error: message, requestsUsed: defaultBudgetSize() - budget.remaining };
  }

  return { raw, requestsUsed: defaultBudgetSize() - budget.remaining };
}

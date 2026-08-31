/**
 * HikerAPI (https://api.hikerapi.com) — Instagram data provider, server-side only.
 *
 * Authenticates with the `x-access-key` header (never a query param, never
 * exposed to the client). Endpoints below were verified against HikerAPI's
 * live OpenAPI spec (https://api.hikerapi.com/openapi.json) on 2026-08-31 —
 * not guessed. Follows this codebase's discovery-provider conventions
 * exactly: `fetchJsonWithTimeout` for the timeout wrapper, `ProviderError` +
 * `classifyHttpFailure`/`classifyThrownFailure` for error shape, no
 * automatic retries (HikerAPI bills per request — retrying an ambiguous
 * failure risks double-billing; the DiscoveryRouter's own transient-failure
 * tracking already gives cross-query resilience, same as every other
 * provider in this file's family).
 */

import {
  classifyHttpFailure,
  classifyThrownFailure,
  fetchJsonWithTimeout,
  ProviderError,
} from "./provider";

const DEFAULT_BASE_URL = "https://api.hikerapi.com";
const TIMEOUT_MS = 15_000;

export function hikerApiKey(): string {
  return (process.env.HIKERAPI_ACCESS_KEY ?? "").trim();
}

/**
 * Take-until-exhausted per-scan request counter — mirrors AiCallBudget's
 * shape (src/lib/scan/openai/client.server.ts). Shared by both HikerAPI
 * tiers (Tier 1's account-search cap in hikerapi-provider.server.ts and
 * Tier 2's deep-dive cap in hikerapi-instagram.server.ts) rather than each
 * defining its own counter class.
 */
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

export function hikerApiBaseUrl(): string {
  return (process.env.HIKERAPI_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
}

/**
 * Opt-in: HikerAPI is a new, paid, usage-based integration — unlike the
 * always-on-if-configured providers, it must be explicitly enabled so
 * adding the key alone can never start incurring cost.
 */
export function isHikerApiEnabled(): boolean {
  return Boolean(hikerApiKey()) && process.env.HIKERAPI_ENABLED?.trim().toLowerCase() === "true";
}

/** Instagram user object shape we rely on (subset of HikerAPI's `User`/`UserShort`). */
export interface HikerUser {
  pk: string | number;
  username?: string | null;
  full_name?: string | null;
  profile_pic_url?: string | null;
  profile_pic_url_hd?: string | null;
  is_private?: boolean | null;
  is_verified?: boolean | null;
  follower_count?: number | null;
  biography?: string | null;
}

/**
 * Instagram media object shape we rely on. In practice this varies by
 * endpoint (confirmed against live data, not assumed): `/v2/*` endpoints
 * return HikerAPI's documented flat `Media` schema (`caption_text`,
 * `thumbnail_url`), while the `/gql/*` endpoints (getUserMedias,
 * getUserClips) pass through Instagram's own internal GraphQL object
 * (`caption.text`, `image_versions2.candidates[].url`) instead — both
 * shapes are modeled here; use captionTextOf()/thumbnailUrlOf() below
 * rather than reading these fields directly.
 */
export interface HikerMedia {
  pk: string;
  id: string;
  code: string;
  taken_at?: string | null;
  taken_at_ts?: number | null;
  media_type?: number | null;
  product_type?: string | null;
  thumbnail_url?: string | null;
  user?: HikerUser | null;
  comment_count?: number | null;
  like_count?: number | null;
  play_count?: number | null;
  caption_text?: string | null;
  /** GraphQL-shape caption, e.g. from /gql/user/medias, /gql/user/clips. */
  caption?: { text?: string | null } | null;
  video_url?: string | null;
  /** GraphQL-shape image candidates, e.g. from /gql/user/medias, /gql/user/clips. */
  image_versions2?: { candidates?: { url?: string }[] } | null;
  image_versions?: unknown[];
}

export interface HikerComment {
  pk: string;
  text: string;
  user?: HikerUser | null;
  created_at_utc?: string | null;
  like_count?: number | null;
}

export interface HikerHashtag {
  id?: string | null;
  name: string;
  media_count?: number | null;
}

export interface HikerPage<T> {
  items: T[];
  nextPageId?: string | null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Pull an item array out of whatever shape a given endpoint actually
 * returns. HikerAPI's OpenAPI spec documents most responses as untyped
 * passthroughs of Instagram's own private-API JSON ("structure varies by
 * endpoint") — this defensively checks the handful of shapes that are
 * plausible per HikerAPI's own PageResponse example (`response.items`) and
 * common flat-array alternatives, rather than assuming one fixed shape.
 */
function extractItems(json: unknown): { items: unknown[]; nextPageId: string | null } {
  if (Array.isArray(json)) return { items: json, nextPageId: null };
  if (!isPlainObject(json)) return { items: [], nextPageId: null };

  const nextPageId =
    (typeof json.next_page_id === "string" && json.next_page_id) ||
    (typeof json.page_id === "string" && json.page_id) ||
    null;

  const response = isPlainObject(json.response) ? json.response : json;
  for (const key of ["items", "users", "medias", "hashtags", "comments"]) {
    const val = (response as Record<string, unknown>)[key];
    if (Array.isArray(val)) return { items: val, nextPageId };
  }
  return { items: [], nextPageId };
}

/**
 * Single authenticated GET against HikerAPI. Never logs the key (only the
 * path + query keys, never their values, ever reach console output).
 */
async function hikerGet(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  signal?: AbortSignal,
): Promise<unknown> {
  const key = hikerApiKey();
  if (!key) throw new ProviderError("auth_failed", "HIKERAPI_ACCESS_KEY is not configured");

  const url = new URL(hikerApiBaseUrl() + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  let status = 0;
  let text = "";
  try {
    const res = await fetchJsonWithTimeout(
      url.toString(),
      { method: "GET", headers: { accept: "application/json", "x-access-key": key } },
      TIMEOUT_MS,
      signal,
    );
    status = res.status;
    text = res.text;
  } catch (e) {
    throw new ProviderError(
      classifyThrownFailure(e),
      e instanceof Error ? e.message.slice(0, 200) : "HikerAPI request failed",
    );
  }

  if (status !== 200) {
    // Never interpolate the raw key into an error message; `text` is the
    // response body only, which HikerAPI does not echo the key back into.
    throw new ProviderError(
      classifyHttpFailure(status, text),
      `HikerAPI ${path} failed (${status}): ${text.slice(0, 180)}`,
      status,
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError("bad_response", `HikerAPI ${path} returned non-JSON`);
  }
}

function asUser(raw: unknown): HikerUser | null {
  if (!isPlainObject(raw)) return null;
  if (raw.pk === undefined || raw.pk === null) return null;
  return raw as unknown as HikerUser;
}

function asMedia(raw: unknown): HikerMedia | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.code !== "string" || !raw.code) return null;
  return raw as unknown as HikerMedia;
}

/**
 * GET /sys/balance — account status only, no Instagram data fetched.
 * Safe to call for connectivity checks without incurring scraping cost.
 */
export async function getBalance(
  signal?: AbortSignal,
): Promise<{ requests?: number; amount?: number; currency?: string }> {
  const json = await hikerGet("/sys/balance", {}, signal);
  return isPlainObject(json) ? (json as Record<string, unknown>) : {};
}

/** GET /v2/fbsearch/accounts — search Instagram accounts by name/alias/username text. */
export async function searchAccounts(query: string, signal?: AbortSignal): Promise<HikerUser[]> {
  const json = await hikerGet("/v2/fbsearch/accounts", { query, safe_int: true }, signal);
  const { items } = extractItems(json);
  return items.map(asUser).filter((u): u is HikerUser => u !== null);
}

/** GET /v2/user/by/username — resolve a known/likely Instagram username to a profile. */
export async function getUserByUsername(
  username: string,
  signal?: AbortSignal,
): Promise<HikerUser | null> {
  const json = await hikerGet("/v2/user/by/username", { username, safe_int: true }, signal);
  if (isPlainObject(json) && isPlainObject(json.user)) return asUser(json.user);
  return asUser(json);
}

/** GET /gql/user/medias — a user's own profile media, one page. */
export async function getUserMedias(
  userId: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<HikerPage<HikerMedia>> {
  const json = await hikerGet(
    "/gql/user/medias",
    { user_id: userId, profile_grid_items_cursor: cursor, flat: true },
    signal,
  );
  const { items, nextPageId } = extractItems(json);
  return { items: items.map(asMedia).filter((m): m is HikerMedia => m !== null), nextPageId };
}

/** GET /gql/user/clips — a user's Reels, one page. */
export async function getUserClips(
  userId: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<HikerPage<HikerMedia>> {
  const json = await hikerGet(
    "/gql/user/clips",
    { user_id: userId, max_id: cursor, flat: true },
    signal,
  );
  const { items, nextPageId } = extractItems(json);
  return { items: items.map(asMedia).filter((m): m is HikerMedia => m !== null), nextPageId };
}

/** GET /v2/user/tag/medias — media where this user is tagged by someone else. */
export async function getUserTaggedMedias(
  userId: string,
  pageId?: string,
  signal?: AbortSignal,
): Promise<HikerPage<HikerMedia>> {
  const json = await hikerGet(
    "/v2/user/tag/medias",
    { user_id: userId, page_id: pageId, safe_int: true },
    signal,
  );
  const { items, nextPageId } = extractItems(json);
  return { items: items.map(asMedia).filter((m): m is HikerMedia => m !== null), nextPageId };
}

/** GET /v2/search/hashtags — search for hashtags matching a term. */
export async function searchHashtags(query: string, signal?: AbortSignal): Promise<HikerHashtag[]> {
  const json = await hikerGet("/v2/search/hashtags", { query, safe_int: true }, signal);
  const { items } = extractItems(json);
  return items.filter(isPlainObject).map((h) => h as unknown as HikerHashtag);
}

/** GET /v2/media/info/by/url — resolve a known Instagram post/reel URL to full media info. */
export async function getMediaInfoByUrl(
  url: string,
  signal?: AbortSignal,
): Promise<HikerMedia | null> {
  const json = await hikerGet("/v2/media/info/by/url", { url, safe_int: true }, signal);
  if (isPlainObject(json) && isPlainObject(json.item)) return asMedia(json.item);
  return asMedia(json);
}

/** GET /v2/media/comments — up to 15 comments on a media, one page. */
export async function getMediaComments(
  mediaId: string,
  pageId?: string,
  signal?: AbortSignal,
): Promise<HikerPage<HikerComment>> {
  const json = await hikerGet(
    "/v2/media/comments",
    { id: mediaId, page_id: pageId, safe_int: true },
    signal,
  );
  const { items, nextPageId } = extractItems(json);
  return {
    items: items.filter(isPlainObject).map((c) => c as unknown as HikerComment),
    nextPageId,
  };
}

/**
 * Caption text regardless of which shape this endpoint returned it in —
 * confirmed against live data that /gql/user/medias and /gql/user/clips use
 * the nested `caption.text` GraphQL field, not the flat `caption_text` the
 * documented Media schema implies.
 */
export function captionTextOf(media: HikerMedia): string | undefined {
  return media.caption_text?.trim() || media.caption?.text?.trim() || undefined;
}

/**
 * Thumbnail URL regardless of shape — confirmed against live data that
 * /gql/user/medias and /gql/user/clips have no top-level `thumbnail_url` at
 * all and require reading `image_versions2.candidates[0].url` instead.
 */
export function thumbnailUrlOf(media: HikerMedia): string | undefined {
  return (
    media.thumbnail_url ??
    media.image_versions2?.candidates?.[0]?.url ??
    undefined
  );
}

/**
 * Canonical, stable Instagram post/reel URL for a media's shortcode.
 * `product_type === "clips"` is the only field confirmed (against live data)
 * to reliably distinguish a Reel — `media_type === 2` also appears on
 * ordinary video feed posts, so it is not used here.
 */
export function canonicalMediaUrl(media: HikerMedia): string {
  const kind = media.product_type === "clips" ? "reel" : "p";
  return `https://www.instagram.com/${kind}/${media.code}/`;
}

/** Canonical Instagram profile URL for a username. */
export function canonicalProfileUrl(username: string): string {
  return `https://www.instagram.com/${username.replace(/^@/, "").trim().toLowerCase()}/`;
}

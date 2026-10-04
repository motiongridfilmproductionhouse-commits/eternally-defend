/** Bounded, server-only Instagram discovery through the linked Apify connection. */

const GATEWAY_BASE = "https://connector-gateway.lovable.dev/apify";
const ACTOR_ID = "apify~instagram-scraper";
const RESULT_LIMIT = 10;
const MAX_HANDLES = 3;
const MAX_POLLS = 10;
const POLL_DELAY_MS = 2_000;

interface ActorRun {
  id?: string;
  status?: string;
  defaultDatasetId?: string;
}

interface ApifyItem extends Record<string, unknown> {
  id?: string;
  pk?: string;
  shortCode?: string;
  shortcode?: string;
  url?: string;
  inputUrl?: string;
  caption?: string;
  alt?: string;
  type?: string;
  timestamp?: string;
  takenAt?: string;
  displayUrl?: string;
  imageUrl?: string;
  videoUrl?: string;
  ownerUsername?: string;
  username?: string;
  fullName?: string;
}

export interface ApifyInstagramHit {
  url: string;
  provider: "apify_instagram";
  title?: string;
  description?: string;
  author?: string;
  date?: string;
  publishedDate?: string;
  media?: { thumbnail?: string; thumbnailHi?: string; instagramMediaPk?: string };
  pageText?: string;
}

export interface ApifyInstagramResult {
  raw: ApifyInstagramHit[];
  attempted: boolean;
  error?: string;
  runStatus?: string;
}

type RuntimeEnv = typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
  Deno?: { env?: { get?: (name: string) => string | undefined } };
};

function env(name: string): string | undefined {
  const runtime = globalThis as RuntimeEnv;
  return runtime.Deno?.env?.get?.(name) ?? runtime.process?.env?.[name];
}

function credentials(): { lovableKey: string; connectionKey: string } | null {
  const lovableKey = env("LOVABLE_API_KEY")?.trim();
  const connectionKey = env("APIFY_API_KEY")?.trim();
  return lovableKey && connectionKey ? { lovableKey, connectionKey } : null;
}

function cleanHandles(handles: string[]): string[] {
  return Array.from(
    new Set(
      handles
        .map((handle) => handle.replace(/^@/, "").trim().toLowerCase())
        .filter((handle) => /^[a-z0-9._]{1,30}$/.test(handle)),
    ),
  ).slice(0, MAX_HANDLES);
}

export function buildApifyInstagramInput(query: string, handles: string[]) {
  const verifiedHandles = cleanHandles(handles);
  const shared = {
    resultsType: "posts",
    resultsLimit: RESULT_LIMIT,
    onlyPostsNewerThan: "30 days",
    addParentData: true,
  };
  return verifiedHandles.length
    ? {
        ...shared,
        directUrls: verifiedHandles.map((handle) => `https://www.instagram.com/${handle}/`),
      }
    : {
        ...shared,
        search: query.trim().slice(0, 120),
        searchType: "user",
        searchLimit: 1,
      };
}

function authHeaders(keys: { lovableKey: string; connectionKey: string }): HeadersInit {
  return {
    Authorization: `Bearer ${keys.lovableKey}`,
    "X-Connection-Api-Key": keys.connectionKey,
    "Content-Type": "application/json",
  };
}

async function gatewayFetch(
  path: string,
  keys: { lovableKey: string; connectionKey: string },
  init: RequestInit,
): Promise<Response> {
  const response = await fetch(`${GATEWAY_BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(keys), ...init.headers },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Instagram discovery request failed [${response.status}]: ${detail}`);
  }
  return response;
}

function runData(value: unknown): ActorRun {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const data = record.data;
  return data && typeof data === "object" ? (data as ActorRun) : (record as ActorRun);
}

function stringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim() !== "")?.trim();
}

function canonicalUrl(item: ApifyItem): string | null {
  const code = stringValue(item.shortCode, item.shortcode);
  if (code) return `https://www.instagram.com/${item.type === "Video" ? "reel" : "p"}/${code}/`;
  const candidate = stringValue(item.url, item.inputUrl);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeApifyInstagramItems(items: unknown[]): ApifyInstagramHit[] {
  const seen = new Set<string>();
  const hits: ApifyInstagramHit[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as ApifyItem;
    const url = canonicalUrl(item);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const author = stringValue(item.ownerUsername, item.username);
    const caption = stringValue(item.caption, item.alt);
    const published = stringValue(item.timestamp, item.takenAt);
    const thumbnail = stringValue(item.displayUrl, item.imageUrl);
    const mediaId = stringValue(item.id, item.pk, item.shortCode, item.shortcode) ?? url;
    hits.push({
      url,
      provider: "apify_instagram",
      title: author ? `Instagram · @${author}` : "Instagram post",
      description: caption,
      author,
      date: published,
      publishedDate: published,
      media: { thumbnail, thumbnailHi: thumbnail, instagramMediaPk: mediaId },
      pageText: caption,
    });
  }
  return hits;
}

function isTerminal(status: string): boolean {
  return ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(status);
}

async function pause(signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, POLL_DELAY_MS);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Instagram discovery cancelled"));
    }, { once: true });
  });
}

export async function runApifyInstagram(
  query: string,
  instagramHandles: string[],
  signal?: AbortSignal,
): Promise<ApifyInstagramResult> {
  const keys = credentials();
  if (!keys) return { raw: [], attempted: false, error: "Instagram discovery is not configured" };
  if (!query.trim() && cleanHandles(instagramHandles).length === 0) {
    return { raw: [], attempted: false, error: "Instagram discovery needs a target" };
  }

  try {
    const startResponse = await gatewayFetch(`/acts/${ACTOR_ID}/runs`, keys, {
      method: "POST",
      body: JSON.stringify(buildApifyInstagramInput(query, instagramHandles)),
      signal,
    });
    let run = runData(await startResponse.json());
    if (!run.id) throw new Error("Instagram discovery did not return a run identifier");
    const runId = run.id;

    for (let poll = 0; poll < MAX_POLLS && !isTerminal(run.status ?? ""); poll += 1) {
      await pause(signal);
      const response = await gatewayFetch(`/actor-runs/${encodeURIComponent(runId)}`, keys, {
        method: "GET",
        signal,
      });
      run = runData(await response.json());
    }

    const status = run.status ?? "UNKNOWN";
    if (status !== "SUCCEEDED") {
      return {
        raw: [],
        attempted: true,
        runStatus: status,
        error: isTerminal(status) ? `Instagram discovery ended with ${status}` : "Instagram discovery timed out",
      };
    }
    if (!run.defaultDatasetId) {
      return { raw: [], attempted: true, runStatus: status, error: "Instagram discovery returned no dataset" };
    }

    const itemsResponse = await gatewayFetch(
      `/datasets/${encodeURIComponent(run.defaultDatasetId)}/items?clean=true&limit=${RESULT_LIMIT * MAX_HANDLES}`,
      keys,
      { method: "GET", signal },
    );
    const value: unknown = await itemsResponse.json();
    const items = Array.isArray(value)
      ? value
      : value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)
        ? ((value as { data: unknown[] }).data)
        : [];
    return { raw: normalizeApifyInstagramItems(items), attempted: true, runStatus: status };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Instagram discovery failed";
    console.error(`[scan:instagram] ${message}`);
    return { raw: [], attempted: true, error: "Instagram discovery is temporarily unavailable" };
  }
}
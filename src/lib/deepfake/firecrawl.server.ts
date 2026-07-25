// Server-only Firecrawl v2 /search wrapper for deepfake intelligence.
// Uses direct-API mode (FIRECRAWL_API_KEY starts with fc-*) — same as
// src/lib/discovery/firecrawl.server.ts.

export interface SearchHit {
  url: string;
  title?: string;
  description?: string;
  query: string;
}

interface FirecrawlSearchResponse {
  data?: Array<{ url?: string; title?: string; description?: string }>;
  web?: Array<{ url?: string; title?: string; description?: string }>;
  news?: Array<{ url?: string; title?: string; description?: string }>;
  error?: string;
}

const FC = "https://api.firecrawl.dev/v2";

function requireKey(): string {
  const k = process.env.FIRECRAWL_API_KEY;
  if (!k) throw new Error("FIRECRAWL_API_KEY is not configured");
  return k;
}

export async function firecrawlSearch(query: string, limit = 6): Promise<SearchHit[]> {
  const key = requireKey();
  const res = await fetch(`${FC}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, limit }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.warn(`[deepfake:firecrawl] ${res.status}: ${text.slice(0, 200)}`);
    return [];
  }
  let json: FirecrawlSearchResponse;
  try { json = JSON.parse(text); } catch { return []; }
  const raw = [
    ...(Array.isArray(json.data) ? json.data : []),
    ...(Array.isArray(json.web) ? json.web : []),
    ...(Array.isArray(json.news) ? json.news : []),
  ];
  const out: SearchHit[] = [];
  for (const item of raw) {
    if (!item?.url) continue;
    out.push({
      url: item.url,
      title: typeof item.title === "string" ? item.title : undefined,
      description: typeof item.description === "string" ? item.description : undefined,
      query,
    });
  }
  return out;
}

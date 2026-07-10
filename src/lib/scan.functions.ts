import { createServerFn } from "@tanstack/react-start";

export interface ScanHit {
  title: string;
  url: string;
  description: string;
  platform: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  category: "Deepfake" | "Impersonation" | "Copyright" | "News Attack" | "Unauthorized Ad" | "Viral";
  confidence: number;
}

const RISK_TERMS: { kw: string[]; category: ScanHit["category"]; sev: ScanHit["severity"]; score: number }[] = [
  { kw: ["deepfake", "ai generated", "ai-generated", "synthetic video"], category: "Deepfake", sev: "Critical", score: 30 },
  { kw: ["impersonat", "fake account", "fake profile", "scam profile"], category: "Impersonation", sev: "High", score: 22 },
  { kw: ["leaked", "pirated", "free download", "torrent", "copyright", "unauthorized"], category: "Copyright", sev: "High", score: 20 },
  { kw: ["scandal", "controversy", "expose", "hoax", "fake news"], category: "News Attack", sev: "High", score: 18 },
  { kw: ["ad campaign", "sponsored", "promoted", "endorse"], category: "Unauthorized Ad", sev: "Medium", score: 12 },
  { kw: ["viral", "trending", "reupload", "repost"], category: "Viral", sev: "Medium", score: 10 },
];

function platformFromUrl(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (h.includes("youtube") || h.includes("youtu.be")) return "YouTube";
    if (h.includes("instagram")) return "Instagram";
    if (h.includes("tiktok")) return "TikTok";
    if (h.includes("twitter") || h.includes("x.com")) return "X";
    if (h.includes("facebook") || h.includes("fb.com")) return "Facebook";
    if (h.includes("reddit")) return "Reddit";
    if (h.includes("spotify")) return "Spotify";
    return h;
  } catch { return "Web"; }
}

function classify(title: string, desc: string): { category: ScanHit["category"]; severity: ScanHit["severity"]; confidence: number } {
  const t = `${title} ${desc}`.toLowerCase();
  let best = { category: "Copyright" as ScanHit["category"], severity: "Low" as ScanHit["severity"], confidence: 55 };
  for (const r of RISK_TERMS) {
    if (r.kw.some((k) => t.includes(k))) {
      const conf = Math.min(97, 60 + r.score);
      if (conf > best.confidence) best = { category: r.category, severity: r.sev, confidence: conf };
    }
  }
  return best;
}

export const scanWeb = createServerFn({ method: "POST" })
  .inputValidator((data: { query: string; limit?: number }) => {
    const q = String(data?.query ?? "").trim();
    if (!q || q.length > 200) throw new Error("Query is required (1-200 chars)");
    const limit = Math.min(Math.max(Number(data?.limit ?? 10), 1), 20);
    return { query: q, limit };
  })
  .handler(async ({ data }): Promise<{ hits: ScanHit[]; error?: string }> => {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) return { hits: [], error: "FIRECRAWL_API_KEY missing" };

    try {
      const { default: Firecrawl } = await import("@mendable/firecrawl-js");
      const fc = new Firecrawl({ apiKey });
      const res: unknown = await fc.search(data.query, { limit: data.limit });

      // Normalize: SDK v2 may return { web: [...] } or an array on `data`
      const r = res as { web?: unknown[]; data?: unknown[] };
      const raw: unknown[] = Array.isArray(r.web) ? r.web : Array.isArray(r.data) ? r.data : [];

      const hits: ScanHit[] = raw.slice(0, data.limit).map((it) => {
        const o = it as { url?: string; title?: string; description?: string; snippet?: string };
        const url = o.url ?? "";
        const title = o.title ?? url;
        const description = o.description ?? o.snippet ?? "";
        const c = classify(title, description);
        return {
          title, url, description,
          platform: platformFromUrl(url),
          category: c.category,
          severity: c.severity,
          confidence: c.confidence,
        };
      }).filter((h) => h.url);

      return { hits };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Scan failed";
      console.error("Firecrawl scan failed:", msg);
      return { hits: [], error: msg };
    }
  });

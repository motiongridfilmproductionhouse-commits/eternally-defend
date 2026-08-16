export type Sev = "Critical" | "High" | "Medium" | "Low" | "Info";

export const SEV_WEIGHT: Record<string, number> = {
  Critical: 10,
  High: 8,
  Medium: 5,
  Low: 3,
  Info: 1,
  critical: 10,
  high: 8,
  medium: 5,
  low: 3,
  info: 1,
};

export function bucketPlatform(source: string | null | undefined): string {
  const s = (source ?? "").toLowerCase();
  if (s.includes("youtube")) return "YouTube";
  if (s.includes("tiktok")) return "TikTok";
  if (s.includes("insta")) return "Instagram";
  if (s.includes("facebook") || s.includes("fb")) return "Facebook";
  if (s.includes("twitter") || s === "x" || s.includes("x.com")) return "X";
  if (s.includes("reddit")) return "Reddit";
  if (s.includes("news")) return "News";
  if (s.includes("blog")) return "Blogs";
  if (s.includes("forum")) return "Forums";
  return source || "Web";
}

export const SPOILER_MAP: Record<string, string> = {
  defamation: "Defamation",
  "false claim": "False Claims",
  "false-claim": "False Claims",
  misinformation: "False Claims",
  "fake news": "Fake News",
  fake_news: "Fake News",
  leak: "Leaks",
  leaks: "Leaks",
  exposed: "Exposed Content",
  scandal: "Scandals",
  harassment: "Harassment",
  hate: "Hate Content",
  manipulation: "Manipulation",
  deepfake: "Manipulation",
  impersonation: "Manipulation",
};

export function spoilerCategory(riskType: string | null, tags: string[] | null): string | null {
  const bag = [(riskType ?? "").toLowerCase(), ...(tags ?? []).map((t) => t.toLowerCase())];
  for (const key of Object.keys(SPOILER_MAP)) {
    if (bag.some((b) => b.includes(key))) return SPOILER_MAP[key];
  }
  return null;
}

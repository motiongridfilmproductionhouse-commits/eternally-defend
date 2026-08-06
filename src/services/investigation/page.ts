export interface PageAnalysis {
  title?: string;
  cms?: string;
  framework?: string;
  wordpress: boolean;
  hasVideo: boolean;
  hasDownload: boolean;
  hasTorrent: boolean;
  hasMagnet: boolean;
  hasStreaming: boolean;
  evidence: string[];
}

export async function analyzePage(url: string): Promise<PageAnalysis> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "EternaAI/1.0",
    },
  });

  const html = await res.text();
  const lower = html.toLowerCase();

  const evidence: string[] = [];

  const title = html.match(/<title>(.*?)<\/title>/i)?.[1]?.trim() ?? "";

  const wordpress = lower.includes("/wp-content/") || lower.includes("/wp-json/");

  if (wordpress) evidence.push("WordPress detected");

  const hasVideo =
    lower.includes("<video") || lower.includes("jwplayer") || lower.includes("videojs");

  if (hasVideo) evidence.push("Video player detected");

  const hasDownload = lower.includes("download") || lower.includes("download now");

  if (hasDownload) evidence.push("Download links detected");

  const hasTorrent = lower.includes(".torrent");

  if (hasTorrent) evidence.push("Torrent file detected");

  const hasMagnet = lower.includes("magnet:?");

  if (hasMagnet) evidence.push("Magnet link detected");

  const hasStreaming = lower.includes("iframe") || lower.includes("embed");

  if (hasStreaming) evidence.push("Embedded streaming detected");

  return {
    title,
    cms: wordpress ? "WordPress" : "Unknown",
    framework: "Unknown",
    wordpress,
    hasVideo,
    hasDownload,
    hasTorrent,
    hasMagnet,
    hasStreaming,
    evidence,
  };
}

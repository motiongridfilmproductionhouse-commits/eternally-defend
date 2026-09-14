/**
 * Approved-source video suppression (presentation + discovery hygiene).
 *
 * Videos that belong to an approved YouTube source (e.g. an approved playlist)
 * and were already reviewed as legitimate must never resurface as web/YouTube
 * search discoveries. This module only READS the existing approval rows; it
 * changes no classification, eligibility, verification or enforcement logic.
 */

/** Extract the YouTube video id from a watch / shorts / youtu.be URL. */
export function youtubeVideoIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return id || null;
    }
    if (!/(^|\.)youtube\.com$/.test(host)) return null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** True when the video id (or its URL) is an already-approved source video. */
export function isApprovedSourceVideo(
  approvedIds: Set<string>,
  input: { videoId?: string | null; url?: string | null },
): boolean {
  if (approvedIds.size === 0) return false;
  if (input.videoId && approvedIds.has(input.videoId)) return true;
  const fromUrl = youtubeVideoIdFromUrl(input.url);
  return fromUrl ? approvedIds.has(fromUrl) : false;
}

/** Read the approved-legitimate video ids for one user. Never throws. */
export async function listApprovedSourceVideoIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (table: string) => any },
  userId: string,
): Promise<Set<string>> {
  try {
    const { data } = await supabase
      .from("approved_source_videos")
      .select("youtube_video_id")
      .eq("user_id", userId)
      .eq("review_status", "approved_legitimate")
      .limit(5000);
    return new Set(
      (data ?? [])
        .map((r: { youtube_video_id?: string | null }) => r.youtube_video_id)
        .filter((v: unknown): v is string => typeof v === "string" && v.length > 0),
    );
  } catch {
    return new Set<string>();
  }
}

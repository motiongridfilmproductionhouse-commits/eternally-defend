import { describe, expect, it } from "vitest";
import {
  isApprovedSourceVideo,
  listApprovedSourceVideoIds,
  youtubeVideoIdFromUrl,
} from "./approved-video-ids";

describe("youtubeVideoIdFromUrl", () => {
  it("parses watch, shorts and short-link URLs", () => {
    expect(youtubeVideoIdFromUrl("https://www.youtube.com/watch?v=abc123XYZ_-")).toBe("abc123XYZ_-");
    expect(youtubeVideoIdFromUrl("https://youtube.com/shorts/abc123XYZ")).toBe("abc123XYZ");
    expect(youtubeVideoIdFromUrl("https://youtu.be/abc123XYZ?t=5")).toBe("abc123XYZ");
  });

  it("ignores non-YouTube and malformed URLs", () => {
    expect(youtubeVideoIdFromUrl("https://example.com/watch?v=abc")).toBeNull();
    expect(youtubeVideoIdFromUrl("not a url")).toBeNull();
    expect(youtubeVideoIdFromUrl(null)).toBeNull();
  });
});

describe("isApprovedSourceVideo", () => {
  const approved = new Set(["abc123XYZ"]);

  it("matches by id and by URL", () => {
    expect(isApprovedSourceVideo(approved, { videoId: "abc123XYZ" })).toBe(true);
    expect(
      isApprovedSourceVideo(approved, { url: "https://www.youtube.com/watch?v=abc123XYZ" }),
    ).toBe(true);
  });

  it("does not match unrelated videos or when nothing is approved", () => {
    expect(isApprovedSourceVideo(approved, { videoId: "other" })).toBe(false);
    expect(isApprovedSourceVideo(new Set(), { videoId: "abc123XYZ" })).toBe(false);
  });
});

describe("listApprovedSourceVideoIds", () => {
  it("reads only approved-legitimate rows for the user", async () => {
    const calls: Array<[string, unknown]> = [];
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        calls.push([col, val]);
        return builder;
      },
      limit: () => Promise.resolve({ data: [{ youtube_video_id: "v1" }, { youtube_video_id: null }] }),
    };
    const supabase = { from: () => builder };

    const ids = await listApprovedSourceVideoIds(supabase, "user-1");
    expect([...ids]).toEqual(["v1"]);
    expect(calls).toEqual([
      ["user_id", "user-1"],
      ["review_status", "approved_legitimate"],
    ]);
  });

  it("returns an empty set when the read fails", async () => {
    const supabase = {
      from: () => {
        throw new Error("boom");
      },
    };
    expect((await listApprovedSourceVideoIds(supabase, "u")).size).toBe(0);
  });
});

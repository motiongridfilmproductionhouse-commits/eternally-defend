import test from "node:test";
import assert from "node:assert/strict";
import { extractVideoId, extractPlaylistId, resolveApprovedYoutubeInput } from "./resolve-youtube-source.server";

function fakeResolvedChannel(overrides: Record<string, unknown> = {}) {
  return {
    channelId: "UCcanonical000000000001",
    title: "Some Creator",
    avatarUrl: "https://example.com/avatar.jpg",
    uploadsPlaylistId: "UUcanonical000000000001",
    channelUrl: "https://www.youtube.com/channel/UCcanonical000000000001",
    recentThumbnails: [],
    ...overrides,
  } as never;
}

test("extractVideoId: standard watch URL", () => {
  assert.equal(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractVideoId: watch URL with extra query params", () => {
  assert.equal(
    extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2"),
    "dQw4w9WgXcQ",
  );
});

test("extractVideoId: youtu.be short link", () => {
  assert.equal(extractVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractVideoId: shorts URL", () => {
  assert.equal(extractVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractVideoId: embed URL", () => {
  assert.equal(extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractVideoId: bare 11-char video id", () => {
  assert.equal(extractVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("extractVideoId: a channel URL is not a video", () => {
  assert.equal(extractVideoId("https://www.youtube.com/@SomeChannel"), null);
  assert.equal(extractVideoId("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv"), null);
});

test("extractVideoId: freeform text is not a video", () => {
  assert.equal(extractVideoId("not a url at all"), null);
});

test("a bare UC... channel id input resolves to the canonical YouTube channelId via hydrateChannelById (direct-id fast path)", async () => {
  let hydratedWith: string | undefined;
  const resolved = await resolveApprovedYoutubeInput("UCcanonical000000000001", {
    hydrateChannelById: async (channelId) => ((hydratedWith = channelId), fakeResolvedChannel()),
    resolveChannelCandidates: async () => {
      throw new Error("must not fall back to search when a direct channel id is present");
    },
  });

  assert.equal(resolved.kind, "channel");
  if (resolved.kind !== "channel") throw new Error("unreachable");
  assert.equal(resolved.channelId, "UCcanonical000000000001");
  assert.equal(resolved.channelTitle, "Some Creator");
  assert.equal(resolved.uploadsPlaylistId, "UUcanonical000000000001");
  assert.equal(hydratedWith, "UCcanonical000000000001");
});

test("a full /channel/UC.../ URL resolves via resolveChannelCandidates (URL parsing happens inside that helper, not the bare-id fast path)", async () => {
  let searchedWith: string | undefined;
  const resolved = await resolveApprovedYoutubeInput(
    "https://www.youtube.com/channel/UCcanonical000000000001",
    {
      resolveChannelCandidates: async (query) => ((searchedWith = query), [fakeResolvedChannel()]),
    },
  );

  assert.equal(resolved.kind, "channel");
  if (resolved.kind !== "channel") throw new Error("unreachable");
  assert.equal(resolved.channelId, "UCcanonical000000000001");
  assert.equal(searchedWith, "https://www.youtube.com/channel/UCcanonical000000000001");
});

test("@handle / non-UC channel input resolves via resolveChannelCandidates, taking the first candidate", async () => {
  let searchedWith: string | undefined;
  const resolved = await resolveApprovedYoutubeInput("https://www.youtube.com/@SomeCreator", {
    resolveChannelCandidates: async (query) => (
      (searchedWith = query),
      [fakeResolvedChannel({ title: "Handle-resolved Creator" })]
    ),
  });

  assert.equal(resolved.kind, "channel");
  if (resolved.kind !== "channel") throw new Error("unreachable");
  assert.equal(resolved.channelTitle, "Handle-resolved Creator");
  assert.equal(searchedWith, "https://www.youtube.com/@SomeCreator");
});

test("REGRESSION: channel not found -> a clear error, not a silently empty/fabricated source", async () => {
  await assert.rejects(
    () =>
      resolveApprovedYoutubeInput("https://www.youtube.com/@NobodyHome", {
        resolveChannelCandidates: async () => [],
      }),
    /That YouTube channel could not be found\./,
  );
});

test("a single video URL still resolves via the video path (unaffected by adding channel deps-injection)", async () => {
  const resolved = await resolveApprovedYoutubeInput(
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    {
      fetchVideoDetails: async (ids) => [
        {
          videoId: ids[0],
          channelId: "UCowner00000000000000001",
          title: "A specific video",
          description: "",
          thumbnailUrl: "https://example.com/v-thumb.jpg",
          publishedAt: "2026-08-27T00:00:00.000Z",
          durationSeconds: 60,
          viewCount: 1,
          likeCount: 0,
          commentCount: 0,
          isPrivateOrDeleted: false,
        },
      ],
    },
  );

  assert.equal(resolved.kind, "video");
  if (resolved.kind !== "video") throw new Error("unreachable");
  assert.equal(resolved.videoId, "dQw4w9WgXcQ");
  assert.equal(resolved.channelId, "UCowner00000000000000001");
});

test("extractPlaylistId: playlist URL", () => {
  assert.equal(
    extractPlaylistId(
      "https://youtube.com/playlist?list=PL5qdoRCKwiZSLyFWMnXoEsYhlF9omEjuG&si=pLUc6",
    ),
    "PL5qdoRCKwiZSLyFWMnXoEsYhlF9omEjuG",
  );
});

test("extractPlaylistId: watch URL with a list param is NOT a playlist", () => {
  assert.equal(
    extractPlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL5qdoRCKwiZSLyFWMnXo"),
    null,
  );
});

test("extractPlaylistId: channel URL is not a playlist", () => {
  assert.equal(extractPlaylistId("https://youtube.com/@someone"), null);
});

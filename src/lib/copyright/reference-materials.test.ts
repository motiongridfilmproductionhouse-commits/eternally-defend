import assert from "node:assert/strict";
import test from "node:test";

import {
  appendReferenceMaterials,
  classifyYoutubeMaterial,
  materialFromYoutubeVideo,
  parseReferenceMaterials,
} from "./reference-materials";

test("classifyYoutubeMaterial labels reviews and trailers correctly", () => {
  const review = classifyYoutubeMaterial({
    videoId: "a",
    videoUrl: "https://youtube.com/watch?v=a",
    title: "Balan The Boy Movie Review",
    description: "",
    channelId: null,
    channelTitle: "Critic Channel",
    channelUrl: null,
    thumbnailUrl: "https://i.ytimg.com/vi/a/hqdefault.jpg",
    publishedAt: null,
    viewCount: null,
    likeCount: null,
    commentCount: null,
    durationSeconds: 600,
    matchedQuery: '"Balan The Boy" review',
  });
  assert.equal(review.material_type, "review_video");
  assert.equal(review.classification, "Review");

  const trailer = classifyYoutubeMaterial({
    videoId: "b",
    videoUrl: "https://youtube.com/watch?v=b",
    title: "Balan The Boy Official Trailer",
    description: "",
    channelId: null,
    channelTitle: "Studio",
    channelUrl: null,
    thumbnailUrl: "https://i.ytimg.com/vi/b/hqdefault.jpg",
    publishedAt: null,
    viewCount: null,
    likeCount: null,
    commentCount: null,
    durationSeconds: 120,
    matchedQuery: '"Balan The Boy" trailer',
  });
  assert.equal(trailer.material_type, "trailer");
  assert.equal(trailer.classification, "Promotional");
});

test("materialFromYoutubeVideo builds persisted material shape", () => {
  const material = materialFromYoutubeVideo({
    videoId: "abc12345678",
    videoUrl: "https://www.youtube.com/watch?v=abc12345678",
    title: "Balan The Boy Reaction",
    description: "",
    channelId: "ch",
    channelTitle: "Reactor",
    channelUrl: null,
    thumbnailUrl: "https://i.ytimg.com/vi/abc12345678/hqdefault.jpg",
    publishedAt: "2026-01-01T00:00:00Z",
    viewCount: 1000,
    likeCount: 50,
    commentCount: 10,
    durationSeconds: 480,
    matchedQuery: '"Balan The Boy" reaction',
  });
  assert.ok(material);
  assert.equal(material?.provider, "youtube");
  assert.equal(material?.classification, "Reaction");
});

test("parseReferenceMaterials reads reference_materials array", () => {
  const stats = {
    reference_materials: [
      {
        id: "yt::abc",
        material_type: "trailer",
        title: "Trailer",
        image_url: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
        video_url: "https://youtube.com/watch?v=abc",
        page_url: "https://youtube.com/watch?v=abc",
        source_domain: "youtube.com",
        source_name: "Studio",
        provider: "youtube",
        channel_name: "Studio",
        duration_seconds: 90,
        status: "discovered",
        classification: "Promotional",
        discovered_at: "2026-08-01T00:00:00.000Z",
      },
    ],
  };
  const rows = parseReferenceMaterials(stats);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.material_type, "trailer");
});

test("appendReferenceMaterials dedupes by image URL", () => {
  const a = materialFromYoutubeVideo({
    videoId: "x1",
    videoUrl: "https://youtube.com/watch?v=x1",
    title: "A",
    description: "",
    channelId: null,
    channelTitle: null,
    channelUrl: null,
    thumbnailUrl: "https://i.ytimg.com/vi/x1/hqdefault.jpg",
    publishedAt: null,
    viewCount: null,
    likeCount: null,
    commentCount: null,
    durationSeconds: null,
    matchedQuery: "q",
  })!;
  const b = { ...a, id: "other", title: "B" };
  const merged = appendReferenceMaterials([a], [b]);
  assert.equal(merged.length, 1);
});

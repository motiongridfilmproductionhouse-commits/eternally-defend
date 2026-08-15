import { describe, expect, it } from "vitest";
import {
  buildProvenance,
  handleFromProfileUrl,
  normalizeProfileUrl,
  parsePostUrl,
  platformFromUrl,
  postDedupeKey,
} from "./provenance";

describe("normalizeProfileUrl", () => {
  it("adds a scheme and strips query/hash/trailing slash", () => {
    expect(normalizeProfileUrl(" instagram.com/name/?utm=1#x ")).toBe("https://instagram.com/name");
  });
  it("rejects junk", () => {
    expect(normalizeProfileUrl("not a url")).toBeNull();
    expect(normalizeProfileUrl("")).toBeNull();
  });
});

describe("platformFromUrl", () => {
  it("maps known hosts", () => {
    expect(platformFromUrl("https://www.instagram.com/x")).toBe("instagram");
    expect(platformFromUrl("https://twitter.com/x")).toBe("x");
    expect(platformFromUrl("https://youtu.be/abc")).toBe("youtube");
    expect(platformFromUrl("https://example.com/x")).toBe("other");
  });
});

describe("handleFromProfileUrl", () => {
  it("extracts a handle and ignores post markers", () => {
    expect(handleFromProfileUrl("https://instagram.com/@someone")).toBe("someone");
    expect(handleFromProfileUrl("https://instagram.com/p/AbC123")).toBeNull();
  });
});

describe("parsePostUrl", () => {
  it("classifies posts and reels", () => {
    expect(parsePostUrl("https://instagram.com/p/AbC")).toMatchObject({
      platform: "instagram",
      kind: "post",
      postId: "AbC",
    });
    expect(parsePostUrl("https://instagram.com/reel/XyZ")).toMatchObject({ kind: "reel", postId: "XyZ" });
    expect(parsePostUrl("https://www.youtube.com/watch")).toMatchObject({ platform: "youtube" });
  });
});

describe("buildProvenance", () => {
  it("marks link imports self-declared and authorized imports platform-authorized", () => {
    expect(
      buildProvenance({ platform: "instagram", importMethod: "PUBLIC_LINK" }).ownership_basis,
    ).toBe("SELF_DECLARED");
    expect(
      buildProvenance({ platform: "instagram", importMethod: "AUTHORIZED_API" }).ownership_basis,
    ).toBe("PLATFORM_AUTHORIZED");
    expect(
      buildProvenance({ platform: "instagram", importMethod: "MANUAL_UPLOAD" }).ownership_basis,
    ).toBe("SELF_DECLARED");
  });

  it("preserves the original post link", () => {
    const p = buildProvenance({
      platform: "instagram",
      importMethod: "PUBLIC_LINK",
      postUrl: "https://instagram.com/p/AbC",
      mediaUrl: "https://cdn.example.com/a.jpg",
    });
    expect(p.source_post_url).toBe("https://instagram.com/p/AbC");
    expect(p.source_media_url).toBe("https://cdn.example.com/a.jpg");
  });
});

describe("postDedupeKey", () => {
  it("is stable across url noise", () => {
    expect(postDedupeKey("instagram", "https://instagram.com/p/AbC/?x=1", "m")).toBe(
      postDedupeKey("instagram", "https://instagram.com/p/AbC", "m"),
    );
  });
});

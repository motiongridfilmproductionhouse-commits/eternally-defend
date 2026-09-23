import { describe, expect, it } from "vitest";
import { resolveIdentity, type IdentityTargetProfile } from "./identity-resolution";

const target: IdentityTargetProfile = {
  name: "Anand Varghese",
  profession: "film producer",
  organization: "Greenlight Studios",
  countryRegion: "Kerala",
  knownWebsite: "https://anandvarghese.example",
  knownHandles: ["anandvarghese"],
};

describe("identity resolution", () => {
  it("never returns MATCHED on a full-name match alone", () => {
    const result = resolveIdentity(target, {
      url: "https://randomblog.example/post/123",
      title: "Anand Varghese spotted at event",
      snippet: "Anand Varghese was seen yesterday.",
    });
    expect(result.nameMatched).toBe(true);
    expect(result.bucket).not.toBe("MATCHED");
    expect(result.bucket).toBe("POSSIBLE_MATCH");
  });

  it("returns MATCHED with a name plus a strong corroborating signal", () => {
    const result = resolveIdentity(target, {
      url: "https://instagram.com/anandvarghese/p/abc",
      title: "Anand Varghese",
      snippet: "official account",
    });
    expect(result.bucket).toBe("MATCHED");
    expect(result.strongSignals.length).toBeGreaterThan(0);
  });

  it("treats organisation association as a strong signal", () => {
    const result = resolveIdentity(target, {
      url: "https://news.example/story",
      title: "Anand Varghese of Greenlight Studios responds",
      snippet: "The Greenlight Studios head issued a statement.",
    });
    expect(result.bucket).toBe("MATCHED");
  });

  it("prefers NEEDS_IDENTITY_REVIEW for ambiguous names with weak corroboration", () => {
    const ambiguous: IdentityTargetProfile = {
      name: "Raj Kumar",
      profession: "actor",
      nameIsAmbiguous: true,
    };
    const result = resolveIdentity(ambiguous, {
      url: "https://news.example/raj",
      title: "Raj Kumar, actor, faces allegation",
      snippet: "The actor Raj Kumar is in the news.",
    });
    expect(result.bucket).toBe("NEEDS_IDENTITY_REVIEW");
    expect(result.ambiguityDetected).toBe(true);
  });

  it("flags ambiguity when multiple distinct entities share the name", () => {
    const result = resolveIdentity(target, {
      url: "https://news.example/other",
      title: "Anand Varghese",
      snippet: "A doctor of the same name.",
      competingEntities: ["Anand Varghese (surgeon)"],
    });
    expect(result.ambiguityDetected).toBe(true);
    expect(result.bucket).not.toBe("MATCHED");
  });

  it("marks retrieved pages without any name signal as UNRELATED", () => {
    const result = resolveIdentity(target, {
      url: "https://news.example/unrelated",
      title: "Market report",
      pageText: "x".repeat(400),
    });
    expect(result.bucket).toBe("UNRELATED");
    expect(result.confidence).toBe(0);
  });

  it("always includes the factors behind the confidence number", () => {
    const result = resolveIdentity(target, {
      url: "https://anandvarghese.example/about",
      title: "Anand Varghese — film producer",
    });
    expect(result.explanation).toMatch(/^Identity confidence: \d+% — .+/);
    expect(result.factors.length).toBeGreaterThan(0);
  });
});

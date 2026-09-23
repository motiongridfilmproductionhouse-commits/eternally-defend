import { describe, expect, it } from "vitest";
import { FORBIDDEN_VERDICT_WORDS, classifyDiscovery, maskSensitive } from "./classify";

const target = { targetName: "Anand Varghese" };

describe("stage classification", () => {
  it("never uses verdict language for media candidates", () => {
    const [media] = classifyDiscovery({
      url: "https://youtube.com/watch?v=abc",
      ...target,
    }).filter((c) => c.stageKey === "ai_manipulation");
    expect(media).toBeDefined();
    expect(media!.category).toBe("Media candidate");
    for (const word of FORBIDDEN_VERDICT_WORDS) {
      expect(word.test(`${media!.category} ${media!.reason}`)).toBe(false);
    }
  });

  it("records an allegation without asserting it is true", () => {
    const harmful = classifyDiscovery({
      url: "https://news.example/story",
      title: "Anand Varghese faces assault allegation",
      ...target,
    }).find((c) => c.stageKey === "harmful_content");
    expect(harmful?.category).toBe("Allegation reported");
    expect(harmful?.reason).toContain("not assessed as true");
    for (const word of FORBIDDEN_VERDICT_WORDS) {
      expect(word.test(harmful!.reason)).toBe(false);
    }
  });

  it("returns no stage classification for ordinary coverage", () => {
    const result = classifyDiscovery({
      url: "https://news.example/interview",
      title: "Anand Varghese on his next film",
      snippet: "An interview about the production schedule.",
      ...target,
    });
    expect(result.filter((c) => c.stageKey === "harmful_content")).toHaveLength(0);
    expect(result.filter((c) => c.stageKey === "impersonation")).toHaveLength(0);
  });

  it("detects solicitation patterns as possible fraudulent endorsement", () => {
    const result = classifyDiscovery({
      url: "https://fake.example/promo",
      title: "Anand Varghese investment plan — guaranteed returns",
      ...target,
    });
    expect(result.some((c) => c.stageKey === "impersonation")).toBe(true);
  });

  it("classifies search results by observed rank only", () => {
    const withRank = classifyDiscovery({ url: "https://a.example", searchRank: 2, ...target });
    const withoutRank = classifyDiscovery({ url: "https://a.example", ...target });
    expect(withRank.some((c) => c.stageKey === "search_reputation")).toBe(true);
    expect(withoutRank.some((c) => c.stageKey === "search_reputation")).toBe(false);
  });
});

describe("maskSensitive", () => {
  it("masks phone numbers and emails", () => {
    const masked = maskSensitive("call +919846120208 or mail someone@example.com");
    expect(masked).not.toContain("9846120208");
    expect(masked).not.toContain("someone@example.com");
    expect(masked).toContain("@example.com");
  });
});

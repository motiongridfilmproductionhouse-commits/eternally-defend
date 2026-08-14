import { describe, expect, it } from "vitest";
import { classifyPlatform, hostMatchesPattern } from "./platform-classifier";

function kindOf(url: string) {
  return classifyPlatform(url)?.kind;
}

describe("hostMatchesPattern", () => {
  it("matches a host and its subdomains exactly", () => {
    expect(hostMatchesPattern("x.com", "x.com")).toBe(true);
    expect(hostMatchesPattern("mobile.x.com", "x.com")).toBe(true);
    expect(hostMatchesPattern("notx.com", "x.com")).toBe(false);
  });

  it("never matches on a substring inside a label", () => {
    expect(hostMatchesPattern("learn.microsoft.com", "t.co")).toBe(false);
    expect(hostMatchesPattern("mytiktokfan.net", "tiktok.com")).toBe(false);
    expect(hostMatchesPattern("youtube-downloader.info", "youtube.com")).toBe(false);
  });

  it("supports domain-prefix patterns", () => {
    expect(hostMatchesPattern("amazon.ae", "amazon.")).toBe(true);
    expect(hostMatchesPattern("www.amazon.co.uk", "amazon.")).toBe(true);
    expect(hostMatchesPattern("shop.amazon.de", "amazon.")).toBe(true);
    expect(hostMatchesPattern("notamazon.com", "amazon.")).toBe(false);
  });
});

describe("classifyPlatform hostname exactness", () => {
  it("does not classify learn.microsoft.com as X (regression: t.co substring)", () => {
    const c = classifyPlatform("https://learn.microsoft.com/en-us/azure/overview");
    expect(c?.kind).toBe("website");
    expect(c?.registrableDomain).toBe("microsoft.com");
  });

  it("still classifies the real platforms", () => {
    expect(kindOf("https://x.com/user/status/1")).toBe("x");
    expect(kindOf("https://t.co/abc123")).toBe("x");
    expect(kindOf("https://www.instagram.com/p/abc/")).toBe("instagram");
    expect(kindOf("https://www.tiktok.com/@a/video/1")).toBe("tiktok");
    expect(kindOf("https://youtu.be/abc")).toBe("youtube");
    expect(kindOf("https://www.reddit.com/r/x/comments/1")).toBe("reddit");
    expect(kindOf("https://amazon.ae/dp/B01")).toBe("marketplace");
  });

  it("does not misclassify lookalike or generic domains", () => {
    expect(kindOf("https://tiktokdownloader.example.com/x")).toBe("website");
    expect(kindOf("https://facebookmarketingtips.net/post")).toBe("website");
    expect(kindOf("https://instagram-tools.io/a")).toBe("website");
    expect(kindOf("https://myredditclone.dev/a")).toBe("website");
  });

  it("keeps search surfaces and CDNs non-removal-capable", () => {
    const search = classifyPlatform("https://www.google.co.uk/search?q=a");
    expect(search?.isSearchSurface).toBe(true);
    expect(search?.removalCapable).toBe(false);
    const cdn = classifyPlatform("https://i0.wp.com/example.com/a.jpg");
    expect(cdn?.kind).toBe("cdn_proxy");
    expect(classifyPlatform("https://lh3.googleusercontent.com/a")?.kind).toBe("cdn_proxy");
  });
});

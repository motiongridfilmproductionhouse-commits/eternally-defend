import { describe, expect, it } from "vitest";
import {
  buildEvidenceExcerpt,
  evaluateDiscoveredContact,
  extractEmails,
  extractLegalLinks,
  isThirdPartyMailHost,
  rankContactCandidates,
} from "./contact-discovery";
import { NON_AUTHORITATIVE_METHODS, evaluateVerification } from "./removal-route-policy";

const PAGE = `
<html><body>
  <h1>DMCA Policy</h1>
  <p>Send copyright complaints to <a href="mailto:copyright@piracy-site.test">copyright@piracy-site.test</a>.</p>
  <p>General help: support@piracy-site.test. Abuse reports: abuse@cloudflare.com.</p>
  <p>Registrar contact: abuse@namecheap.com. Owner: someone@gmail.com</p>
</body></html>`;

describe("email extraction", () => {
  it("finds published addresses and skips placeholders/assets", () => {
    const emails = extractEmails(PAGE + " name@example.com logo@sprite.png");
    expect(emails).toContain("copyright@piracy-site.test");
    expect(emails).toContain("support@piracy-site.test");
    expect(emails).not.toContain("name@example.com");
    expect(emails).not.toContain("logo@sprite.png");
  });
});

describe("third-party mail hosts", () => {
  it("refuses CDN, registrar and consumer mailboxes", () => {
    expect(isThirdPartyMailHost("abuse@cloudflare.com")).toBe(true);
    expect(isThirdPartyMailHost("abuse@namecheap.com")).toBe(true);
    expect(isThirdPartyMailHost("owner@gmail.com")).toBe(true);
    expect(isThirdPartyMailHost("copyright@piracy-site.test")).toBe(false);
  });
});

describe("ranking", () => {
  it("prefers copyright mailboxes and drops off-domain addresses", () => {
    const ranked = rankContactCandidates(
      extractEmails(PAGE),
      "https://piracy-site.test/dmca",
      "piracy-site.test",
    );
    expect(ranked[0]!.email).toBe("copyright@piracy-site.test");
    expect(ranked.map((r) => r.email)).not.toContain("abuse@cloudflare.com");
    expect(ranked.map((r) => r.email)).not.toContain("someone@gmail.com");
  });
});

describe("evaluateDiscoveredContact", () => {
  const base = {
    domain: "piracy-site.test",
    sourceUrl: "https://piracy-site.test/dmca",
    pageContent: PAGE,
  };

  it("accepts an on-domain address literally published on an on-domain page", () => {
    const r = evaluateDiscoveredContact({ ...base, email: "copyright@piracy-site.test" });
    expect(r.eligible).toBe(true);
  });

  it("refuses an address that is not present on the page (guessed)", () => {
    const r = evaluateDiscoveredContact({ ...base, email: "dmca@piracy-site.test" });
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/not found literally published/i);
  });

  it("refuses CDN/registrar recipients even when printed on the page", () => {
    expect(evaluateDiscoveredContact({ ...base, email: "abuse@cloudflare.com" }).eligible).toBe(false);
    expect(evaluateDiscoveredContact({ ...base, email: "abuse@namecheap.com" }).eligible).toBe(false);
  });

  it("refuses evidence taken from an off-domain page", () => {
    const r = evaluateDiscoveredContact({
      ...base,
      sourceUrl: "https://whois-lookup.test/piracy-site.test",
      email: "copyright@piracy-site.test",
    });
    expect(r.eligible).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/not on the infringing host/i);
  });
});

describe("legal link discovery", () => {
  it("keeps only same-host legal/contact links", () => {
    const html = `<a href="/dmca">DMCA</a><a href="https://other.test/legal">Legal</a><a href="/shop">Shop</a>`;
    const links = extractLegalLinks(html, "https://piracy-site.test/");
    expect(links).toEqual(["https://piracy-site.test/dmca"]);
  });
});

describe("evidence excerpt", () => {
  it("captures text around the discovered address", () => {
    const excerpt = buildEvidenceExcerpt(PAGE, "copyright@piracy-site.test");
    expect(excerpt).toContain("copyright@piracy-site.test");
    expect(excerpt).not.toContain("<p>");
  });
});

describe("auto-discovered candidates can never self-verify", () => {
  it("is registered as a non-authoritative method", () => {
    expect(NON_AUTHORITATIVE_METHODS.has("AUTOMATED_ON_DOMAIN_DISCOVERY")).toBe(true);
  });

  it("is refused by the verification gate", () => {
    const decision = evaluateVerification({
      domain: "piracy-site.test",
      recipientEmail: "copyright@piracy-site.test",
      routeType: "EMAIL_DMCA",
      verificationMethod: "AUTOMATED_ON_DOMAIN_DISCOVERY",
      authoritativeSourceUrl: "https://piracy-site.test/dmca",
      evidenceSnapshot: { excerpt: "send copyright complaints to..." },
      actorIsOperator: true,
    });
    expect(decision.canVerify).toBe(false);
    expect(decision.fallbackStatus).toBe("MANUAL_REVIEW");
  });
});

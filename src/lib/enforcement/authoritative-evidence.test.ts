import { describe, expect, it } from "vitest";
import {
  classifyAuthoritativePage,
  evaluateAuthoritativeEvidence,
  extractVisibleText,
  isGenericLocalPart,
} from "./authoritative-evidence";
import { evaluateVerification, NON_AUTHORITATIVE_METHODS } from "./removal-route-policy";

const D = "piracy-site.test";

const dmcaPage = `<html><head><title>DMCA</title></head><body>
  <h1>DMCA Policy</h1>
  <p>Copyright complaints must be sent to <a href="mailto:dmca@piracy-site.test">dmca@piracy-site.test</a>.</p>
</body></html>`;

const copyrightPage = `<html><body><h1>Copyright Policy</h1>
  <p>Notice and takedown requests: copyright@piracy-site.test</p></body></html>`;

const legalPage = `<html><body><h2>Legal Notice</h2>
  <p>Our legal department handles copyright infringement claims at legal@piracy-site.test.</p></body></html>`;

const contactPageSpecific = `<html><body><h1>Contact us</h1>
  <p>Get in touch: takedown@piracy-site.test</p></body></html>`;

const contactPageGeneric = `<html><body><h1>Contact us</h1>
  <p>Get in touch: support@piracy-site.test for anything.</p></body></html>`;

const shopPage = `<html><body><h1>Shop</h1><p>Buy now. mail@piracy-site.test</p></body></html>`;

const scriptOnlyPage = `<html><body><h1>DMCA Policy</h1>
  <script type="application/ld+json">{"email":"dmca@piracy-site.test"}</script></body></html>`;

const multiPage = `<html><body><h1>DMCA Policy</h1>
  <p>General: support@piracy-site.test</p>
  <p>Copyright infringement notices: copyright@piracy-site.test</p></body></html>`;

function ev(html: string, email: string, path = "/dmca") {
  return evaluateAuthoritativeEvidence({
    domain: D,
    email,
    sourceUrl: `https://${D}${path}`,
    html,
  });
}

describe("visible text extraction", () => {
  it("drops scripts, styles and head metadata", () => {
    const text = extractVisibleText(scriptOnlyPage);
    expect(text).toContain("DMCA Policy");
    expect(text).not.toContain("dmca@piracy-site.test");
  });

  it("keeps mailto targets", () => {
    expect(extractVisibleText(dmcaPage)).toContain("dmca@piracy-site.test");
  });
});

describe("authoritative page classification", () => {
  it("classifies /dmca, /copyright, /legal and /contact", () => {
    expect(classifyAuthoritativePage({ sourceUrl: `https://${D}/dmca`, html: dmcaPage }).kind).toBe(
      "DMCA",
    );
    expect(
      classifyAuthoritativePage({ sourceUrl: `https://${D}/copyright`, html: copyrightPage }).kind,
    ).toBe("COPYRIGHT");
    expect(
      classifyAuthoritativePage({ sourceUrl: `https://${D}/legal`, html: legalPage }).kind,
    ).toBe("LEGAL");
    expect(
      classifyAuthoritativePage({ sourceUrl: `https://${D}/contact`, html: contactPageSpecific })
        .kind,
    ).toBe("CONTACT");
  });

  it("refuses a page with no legal/contact signal", () => {
    const c = classifyAuthoritativePage({ sourceUrl: `https://${D}/shop`, html: shopPage });
    expect(c.authoritative).toBe(false);
  });
});

describe("evidence evaluation", () => {
  it("1. /dmca page with published email is supported", () => {
    const r = ev(dmcaPage, "dmca@piracy-site.test");
    expect(r.supported).toBe(true);
    expect(r.methodCandidate).toBe("PUBLISHED_DMCA_PAGE");
    expect(r.pageKind).toBe("DMCA");
    expect(r.confidence).toBeLessThan(1);
  });

  it("2. /copyright page is supported", () => {
    const r = ev(copyrightPage, "copyright@piracy-site.test", "/copyright");
    expect(r.supported).toBe(true);
    expect(r.methodCandidate).toBe("PUBLISHED_DMCA_PAGE");
  });

  it("3. /legal page is supported as a legal contact", () => {
    const r = ev(legalPage, "legal@piracy-site.test", "/legal");
    expect(r.supported).toBe(true);
    expect(r.methodCandidate).toBe("PUBLISHED_LEGAL_CONTACT");
  });

  it("4. /contact page with a specific takedown mailbox is supported", () => {
    const r = ev(contactPageSpecific, "takedown@piracy-site.test", "/contact");
    expect(r.supported).toBe(true);
    expect(r.pageKind).toBe("CONTACT");
  });

  it("5. no authoritative page -> unsupported", () => {
    const r = ev(shopPage, "mail@piracy-site.test", "/shop");
    expect(r.supported).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/not one of the organisation's own authoritative pages/i);
  });

  it("6. generic mailbox without copyright provenance is refused", () => {
    const r = ev(contactPageGeneric, "support@piracy-site.test", "/contact");
    expect(r.supported).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/generic mailbox/i);
    expect(isGenericLocalPart("support@x.test")).toBe(true);
    expect(isGenericLocalPart("dmca@x.test")).toBe(false);
  });

  it("6b. customer-facing variants are treated as generic, not just support@/info@", () => {
    for (const local of ["customersupport", "customerservice", "consumerinfo", "feedback", "hr"]) {
      expect(isGenericLocalPart(`${local}@x.test`)).toBe(true);
    }
    expect(isGenericLocalPart("copyright@x.test")).toBe(false);
  });

  it("6c. customersupport@ on a cookie/legal page is refused (real-data false positive)", () => {
    const cookiePage = `<html><body><h1>Cookie Policy</h1>
      <p>If you have any questions about our use of cookies, please email us at customersupport@piracy-site.test.</p>
      </body></html>`;
    const r = ev(cookiePage, "customersupport@piracy-site.test", "/terms/cookie-policy/");
    expect(r.supported).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/generic mailbox/i);
  });

  it("6d. an explicit copyright publishing statement qualifies the same mailbox", () => {
    const legalPage = `<html><body><h1>Legal Notice</h1>
      <p>For copyright infringement notices, contact customersupport@piracy-site.test.</p>
      </body></html>`;
    const r = ev(legalPage, "customersupport@piracy-site.test", "/legal");
    expect(r.supported).toBe(true);
    expect(r.methodCandidate).toBe("PUBLISHED_LEGAL_CONTACT");
  });

  it("6e. escaped inline-JSON markup cannot glue itself to an address", () => {
    const escaped = `<html><body><h1>DMCA</h1><p>\\u003edmca@piracy-site.test\\u003c copyright notices</p></body></html>`;
    expect(extractVisibleText(escaped)).not.toContain("u003e");
  });

  it("7. malformed/irrelevant page yields nothing", () => {
    const r = ev("<html><body>???</body></html>", "dmca@piracy-site.test", "/dmca");
    expect(r.supported).toBe(false);
  });

  it("7b. address only inside JSON-LD is not organisational publication", () => {
    const r = ev(scriptOnlyPage, "dmca@piracy-site.test");
    expect(r.supported).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/visible content/i);
  });

  it("8. multiple candidates: only the copyright-supported ones pass", () => {
    expect(ev(multiPage, "copyright@piracy-site.test").supported).toBe(true);
    // support@ on a DMCA page IS contextual only if presented as the channel.
    const generic = ev(multiPage, "support@piracy-site.test");
    expect(generic.supported).toBe(false);
  });

  it("10. excerpt is clean visible text around the address", () => {
    const r = ev(dmcaPage, "dmca@piracy-site.test");
    expect(r.excerpt).toContain("dmca@piracy-site.test");
    expect(r.excerpt).not.toContain("<p>");
    expect(r.excerpt).not.toContain("mailto:");
  });

  it("refuses off-domain evidence pages", () => {
    const r = evaluateAuthoritativeEvidence({
      domain: D,
      email: "dmca@piracy-site.test",
      sourceUrl: "https://whois.test/piracy-site.test",
      html: dmcaPage,
    });
    expect(r.supported).toBe(false);
  });
});

describe("11/12. discovery can never self-promote", () => {
  it("keeps AUTOMATED_ON_DOMAIN_DISCOVERY non-authoritative", () => {
    expect(NON_AUTHORITATIVE_METHODS.has("AUTOMATED_ON_DOMAIN_DISCOVERY")).toBe(true);
  });

  it("still requires an operator with an authoritative method", () => {
    const asDiscovery = evaluateVerification({
      domain: D,
      recipientEmail: "dmca@piracy-site.test",
      routeType: "EMAIL_DMCA",
      verificationMethod: "AUTOMATED_ON_DOMAIN_DISCOVERY",
      authoritativeSourceUrl: `https://${D}/dmca`,
      evidenceSnapshot: { excerpt: "send copyright complaints to dmca@piracy-site.test" },
      actorIsOperator: true,
    });
    expect(asDiscovery.canVerify).toBe(false);

    const asOperator = evaluateVerification({
      domain: D,
      recipientEmail: "dmca@piracy-site.test",
      routeType: "EMAIL_DMCA",
      verificationMethod: "PUBLISHED_DMCA_PAGE",
      authoritativeSourceUrl: `https://${D}/dmca`,
      evidenceSnapshot: { excerpt: "send copyright complaints to dmca@piracy-site.test" },
      actorIsOperator: true,
    });
    expect(asOperator.canVerify).toBe(true);

    const nonOperator = evaluateVerification({
      domain: D,
      recipientEmail: "dmca@piracy-site.test",
      routeType: "EMAIL_DMCA",
      verificationMethod: "PUBLISHED_DMCA_PAGE",
      authoritativeSourceUrl: `https://${D}/dmca`,
      evidenceSnapshot: { excerpt: "send copyright complaints to dmca@piracy-site.test" },
      actorIsOperator: false,
    });
    expect(nonOperator.canVerify).toBe(false);
  });
});

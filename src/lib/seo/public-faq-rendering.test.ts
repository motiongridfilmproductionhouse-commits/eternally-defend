import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Public FAQs must remain in the server-rendered document when collapsed.
// The shared AccordionContent keeps closed panels visually hidden.
const faqRoutes = [
  "ai-impersonation",
  "deepfake-protection",
  "eterna-ai",
  "image-immunization",
  "index",
  "online-reputation-protection",
];

describe("public FAQ crawlability", () => {
  for (const route of faqRoutes) {
    it(`${route} retains every answer when collapsed`, () => {
      const source = readFileSync(join(__dirname, "../../routes", `${route}.tsx`), "utf8");
      const panels = source.match(/<AccordionContent\b[^>]*>/g) ?? [];
      expect(panels.length).toBeGreaterThan(0);
      for (const panel of panels) expect(panel).toMatch(/\bforceMount\b/);
    });
  }
  it("keeps mounted closed panels hidden and open panels visible", () => {
    const source = readFileSync(join(__dirname, "../../components/ui/accordion.tsx"), "utf8");
    expect(source).toContain('className="hidden overflow-hidden');
    expect(source).toContain("data-[state=open]:block");
  });
});

import { describe, expect, it } from "vitest";
import { completeShareTags, DEFAULT_OG_IMAGE, NOT_FOUND_TITLE } from "./head-defaults";

const meta = (k: string, content: string, attr = k.startsWith("og:") ? "property" : "name") => ({
  tag: "meta",
  attrs: { [attr]: k, content },
});
const val = (tags: ReturnType<typeof completeShareTags>, k: string) =>
  tags.find((t) => t.attrs?.name === k || t.attrs?.property === k)?.attrs?.content;

describe("completeShareTags", () => {
  it("derives og/twitter title and description from the route's own title/description", () => {
    const out = completeShareTags([{ tag: "title", children: "Partner" }, meta("description", "Join us")]);
    expect(val(out, "og:title")).toBe("Partner");
    expect(val(out, "twitter:title")).toBe("Partner");
    expect(val(out, "twitter:description")).toBe("Join us");
  });
  it("uses the branded 1200x630 default image unless a route overrides it", () => {
    const def = completeShareTags([{ tag: "title", children: "A" }]);
    expect(val(def, "og:image")).toBe("https://protectbyeterna.com/og-default.png");
    expect(val(def, "og:image:width")).toBe("1200");
    expect(val(def, "og:image:height")).toBe("630");
    const custom = completeShareTags([meta("og:image", "https://x.test/a.jpg")]);
    expect(val(custom, "og:image")).toBe("https://x.test/a.jpg");
    expect(val(custom, "twitter:image")).toBe("https://x.test/a.jpg");
    expect(DEFAULT_OG_IMAGE).toMatch(/^https:\/\//);
  });
  it("titles 404 pages 'Page not found | Eterna Sentinel' and noindexes them", () => {
    const out = completeShareTags([{ tag: "title", children: "Eterna Sentinel" }], { notFound: true });
    expect(out.find((t) => t.tag === "title")?.children).toBe(NOT_FOUND_TITLE);
    expect(val(out, "robots")).toBe("noindex, follow");
  });
});

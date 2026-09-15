import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchArtistPortrait } from "./portrait.server";

const searchBody = (titles: string[]) => ({
  query: { search: titles.map((title) => ({ title })) },
});
const ok = (json: unknown) => ({ ok: true, json: async () => json }) as unknown as Response;

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => handler(String(input))));
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchArtistPortrait", () => {
  it("returns a Wikimedia image for a name-matched article", async () => {
    mockFetch((url) =>
      url.includes("/api/rest_v1/")
        ? ok({
            originalimage: { source: "https://upload.wikimedia.org/wikipedia/commons/a/b/x.jpg" },
          })
        : ok(searchBody(["Edavela Babu"])),
    );
    await expect(fetchArtistPortrait("edavela babu")).resolves.toBe(
      "https://upload.wikimedia.org/wikipedia/commons/a/b/x.jpg",
    );
  });

  it("rejects images hosted outside Wikimedia", async () => {
    mockFetch((url) =>
      url.includes("/api/rest_v1/")
        ? ok({ originalimage: { source: "https://evil.example.com/x.jpg" } })
        : ok(searchBody(["Edavela Babu"])),
    );
    await expect(fetchArtistPortrait("edavela babu")).resolves.toBeNull();
  });

  it("rejects non-https images", async () => {
    mockFetch((url) =>
      url.includes("/api/rest_v1/")
        ? ok({ thumbnail: { source: "http://upload.wikimedia.org/x.jpg" } })
        : ok(searchBody(["Edavela Babu"])),
    );
    await expect(fetchArtistPortrait("edavela babu")).resolves.toBeNull();
  });

  it("ignores articles whose title does not contain the name", async () => {
    const fetchSpy = vi.fn(async () => ok(searchBody(["Some Other Person"])));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchArtistPortrait("edavela babu")).resolves.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns null when the lookup fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(fetchArtistPortrait("edavela babu")).resolves.toBeNull();
  });

  it("does not call the network for an unusable name", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchArtistPortrait("a")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

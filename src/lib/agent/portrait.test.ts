import test from "node:test";
import assert from "node:assert/strict";
import { fetchArtistPortrait } from "./portrait.server.ts";

const searchBody = (titles: string[], image?: string) => ({
  query: {
    pages: Object.fromEntries(
      titles.map((title, index) => [
        String(index + 1),
        image ? { title, original: { source: image } } : { title },
      ]),
    ),
  },
});

const ok = (json: unknown) =>
  ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(json),
    json: async () => json,
  }) as unknown as Response;

const original = globalThis.fetch;

function stub(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
  return calls;
}
const restore = () => {
  globalThis.fetch = original;
};

test("returns a Wikimedia image for a name-matched article", async () => {
  stub((url) =>
    url.includes("/api/rest_v1/")
      ? ok({
          originalimage: { source: "https://upload.wikimedia.org/wikipedia/commons/a/b/x.jpg" },
        })
      : ok(searchBody(["Edavela Babu"])),
  );
  try {
    assert.equal(
      await fetchArtistPortrait("edavela babu"),
      "https://upload.wikimedia.org/wikipedia/commons/a/b/x.jpg",
    );
  } finally {
    restore();
  }
});

test("portrait lookup rejects unsafe or off-host images", async () => {
  for (const source of [
    "https://evil.example.com/x.jpg",
    "http://upload.wikimedia.org/x.jpg",
    "https://user:pass@upload.wikimedia.org/x.jpg",
    "not a url",
  ]) {
    stub((url) =>
      url.includes("/api/rest_v1/")
        ? ok({ originalimage: { source } })
        : ok(searchBody(["Edavela Babu"])),
    );
    try {
      assert.equal(await fetchArtistPortrait("edavela babu"), null, source);
    } finally {
      restore();
    }
  }
});

test("portrait lookup ignores articles that do not match the name", async () => {
  const calls = stub(() => ok(searchBody(["Some Other Person"])));
  try {
    assert.equal(await fetchArtistPortrait("edavela babu"), null);
    assert.equal(calls.length, 1);
  } finally {
    restore();
  }
});

test("portrait lookup fails closed on network and unusable input", async () => {
  stub(() => {
    throw new Error("network down");
  });
  try {
    assert.equal(await fetchArtistPortrait("edavela babu"), null);
  } finally {
    restore();
  }
  const calls = stub(() => ok({}));
  try {
    assert.equal(await fetchArtistPortrait("a"), null);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

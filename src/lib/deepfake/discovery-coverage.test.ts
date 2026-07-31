import assert from "node:assert/strict";
import test from "node:test";
import { searchQueriesWithBoundedConcurrency } from "./firecrawl.server";
import { generateDeepfakeQueries } from "./query-generator.server";
import { searchRecentYouTubeMentions } from "./youtube-discovery.server";
import { verifyCandidateUrls } from "./url-verification.server";
import {
  buildExecutedQueryPlan,
  discoveredCandidateKey,
} from "./discovery-plan.server";

type FetchLike = typeof globalThis.fetch;

const originalFetch = globalThis.fetch;
const originalFirecrawlKey = process.env.FIRECRAWL_API_KEY;
const originalYouTubeKey = process.env.YOUTUBE_API_KEY;

function restoreGlobals() {
  globalThis.fetch = originalFetch;
  if (originalFirecrawlKey === undefined) {
    delete process.env.FIRECRAWL_API_KEY;
  } else {
    process.env.FIRECRAWL_API_KEY = originalFirecrawlKey;
  }
  if (originalYouTubeKey === undefined) {
    delete process.env.YOUTUBE_API_KEY;
  } else {
    process.env.YOUTUBE_API_KEY = originalYouTubeKey;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installVerificationFetch(pages: Record<string, {
  title: string;
  body: string;
  links?: string[];
}>): void {
  process.env.FIRECRAWL_API_KEY = "fc-test";

  globalThis.fetch = (async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.includes("/v2/scrape")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { url: string };
      const page = pages[body.url];

      if (!page) {
        return jsonResponse({
          success: true,
          data: {
            metadata: { title: "Missing page" },
            markdown: "Missing page content with no target identity.",
            links: [],
          },
        });
      }

      return jsonResponse({
        success: true,
        data: {
          metadata: {
            title: page.title,
            description: `${page.title} exact content page`,
          },
          markdown: page.body,
          links: page.links ?? [],
        },
      });
    }

    return new Response("", {
      status: pages[url] ? 200 : 404,
    });
  }) as FetchLike;
}

function targetBody(name: string, unique: string): string {
  return `${name} deepfake face swap clip is described on this exact content page. This primary body contains synthetic media evidence, AI nude context, and unique page marker ${unique}.`;
}

test("generated query plan stays in the 40-60 focused query range", () => {
  const queries = generateDeepfakeQueries({
    name: "Maya Kapoor",
    aliases: ["M Kapoor"],
    handles: ["@not-used-as-identity"],
  });

  assert.ok(queries.length >= 40);
  assert.ok(queries.length <= 60);
  assert.ok(queries.every((query) => query.includes('"Maya Kapoor"') || query.includes('"M Kapoor"')));
  assert.ok(!queries.some((query) => query.includes("not-used-as-identity")));
});

test("imported queries preserve priority but cannot exceed max_queries", () => {
  const importedQueries = Array.from(
    { length: 12 },
    (_, index) => `imported ${index}`,
  );
  const generatedQueries = Array.from(
    { length: 60 },
    (_, index) => `generated ${index}`,
  );

  const plan = buildExecutedQueryPlan({
    importedQueries,
    generatedQueries,
    maxQueries: 40,
  });

  assert.equal(plan.length, 40);
  assert.deepEqual(plan.slice(0, 12), importedQueries);
  assert.equal(plan[12], "generated 0");
  assert.equal(plan.at(-1), "generated 27");
});

test("tracking and fragment URL variants deduplicate before crawling", () => {
  const variants = [
    "https://WWW.Abuse.Example/post/maya-kapoor-deepfake/?utm_source=x#comments",
    "https://abuse.example/post/maya-kapoor-deepfake?fbclid=abc",
    "https://abuse.example/post/maya-kapoor-deepfake/",
  ];

  const keys = new Set(
    variants.map((url) =>
      discoveredCandidateKey({
        url,
      }),
    ),
  );

  assert.equal(keys.size, 1);
});

test("meaningful query parameters remain distinct before crawling", () => {
  const first = discoveredCandidateKey({
    url: "https://abuse.example/watch?id=100&utm_campaign=x",
  });
  const second = discoveredCandidateKey({
    url: "https://abuse.example/watch?id=200&utm_campaign=x",
  });
  const reordered = discoveredCandidateKey({
    url: "https://ABUSE.example/watch?utm_campaign=x&id=100#top",
  });

  assert.notEqual(first, second);
  assert.equal(first, reordered);
});

test("verification retains more than three valid URLs across repeated and distinct domains", async () => {
  const urls = [
    "https://abuse.example/post/maya-kapoor-deepfake-1",
    "https://abuse.example/post/maya-kapoor-deepfake-2",
    "https://abuse.example/post/maya-kapoor-deepfake-3",
    "https://mirror.example/watch/maya-kapoor-ai-nude",
    "https://archive.example/item/maya-kapoor-face-swap",
  ];

  installVerificationFetch(Object.fromEntries(
    urls.map((url, index) => [
      url,
      {
        title: `Maya Kapoor deepfake evidence ${index + 1}`,
        body: targetBody("Maya Kapoor", String(index + 1)),
      },
    ]),
  ));

  try {
    const result = await verifyCandidateUrls(
      urls.map((url) => ({
        url,
        title: "Maya Kapoor deepfake",
        description: "Maya Kapoor AI nude face swap",
        query: '"Maya Kapoor" deepfake',
      })),
      { name: "Maya Kapoor" },
      { maxPages: 10 },
    );

    assert.equal(result.verified.length, 5);
    assert.equal(
      result.verified.filter((item) => item.verified_domain === "abuse.example").length,
      3,
    );
    assert.deepEqual(
      new Set(result.verified.map((item) => item.verified_domain)),
      new Set(["abuse.example", "mirror.example", "archive.example"]),
    );
  } finally {
    restoreGlobals();
  }
});

test("one failed provider query does not cancel the batch", async () => {
  const result = await searchQueriesWithBoundedConcurrency(
    ["one", "fail", "two"],
    {
      concurrency: 2,
      provider: "test",
      search: async (query) => {
        if (query === "fail") {
          throw new Error("temporary 500");
        }

        return [{ query }];
      },
    },
  );

  assert.equal(result.queriesExecuted, 3);
  assert.equal(result.failures.length, 1);
  assert.deepEqual(result.hits, [{ query: "one" }, { query: "two" }]);
});

test("YouTube discovery continues through provider pagination", async () => {
  process.env.YOUTUBE_API_KEY = "yt-test";
  const requestedPageTokens: Array<string | null> = [];

  globalThis.fetch = (async (input) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const url = new URL(rawUrl);
    requestedPageTokens.push(url.searchParams.get("pageToken"));

    if (!url.searchParams.get("pageToken")) {
      return jsonResponse({
        nextPageToken: "next-page",
        items: [{
          id: { videoId: "first" },
          snippet: {
            title: "Maya Kapoor deepfake",
            description: "AI face swap",
          },
        }],
      });
    }

    return jsonResponse({
      items: [{
        id: { videoId: "second" },
        snippet: {
          title: "Maya Kapoor AI nude",
          description: "deepfake discussion",
        },
      }],
    });
  }) as FetchLike;

  try {
    const hits = await searchRecentYouTubeMentions({
      name: "Maya Kapoor",
      maxResults: 2,
      pages: 2,
    });

    assert.equal(hits.length, 2);
    assert.deepEqual(requestedPageTokens, [null, "next-page"]);
  } finally {
    restoreGlobals();
  }
});

test("strict URL and identity gates remain enforced", async () => {
  const validUrl = "https://abuse.example/post/maya-kapoor-deepfake-valid";
  const offTargetUrl = "https://abuse.example/post/other-person-deepfake";
  const listingUrl = "https://abuse.example/search?q=maya+kapoor+deepfake";

  installVerificationFetch({
    [validUrl]: {
      title: "Maya Kapoor deepfake evidence",
      body: targetBody("Maya Kapoor", "valid"),
    },
    [offTargetUrl]: {
      title: "Other Person deepfake evidence",
      body: targetBody("Other Person", "off-target"),
    },
  });

  try {
    const result = await verifyCandidateUrls(
      [
        {
          url: validUrl,
          title: "Maya Kapoor deepfake",
          description: "Maya Kapoor face swap",
          query: '"Maya Kapoor" deepfake',
        },
        {
          url: offTargetUrl,
          title: "Maya Kapoor deepfake",
          description: "Search snippet mentions Maya Kapoor",
          query: '"Maya Kapoor" deepfake',
        },
        {
          url: listingUrl,
          title: "Maya Kapoor deepfake search",
          description: "Search listing",
          query: '"Maya Kapoor" deepfake',
        },
      ],
      { name: "Maya Kapoor" },
      { maxPages: 10 },
    );

    assert.equal(result.verified.length, 1);
    assert.equal(result.verified[0]?.final_url, validUrl);
    assert.equal(result.metrics.identity_rejected, 1);
    assert.equal(result.metrics.page_type_rejected, 1);
    assert.ok(result.rejected.every((item) => item.url_verification_status === "URL_REJECTED"));
  } finally {
    restoreGlobals();
  }
});

import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";

import {
  brightDataDiagnostic,
  brightDataHitsFromPayload,
  buildBrightDataQueries,
  classifyBrightDataFailure,
  isBrightDataConfigured,
  runBrightDataDiscovery,
} from "./brightdata-provider.server";
import type { ReferenceAnalysis } from "./discover.server";

const analysis: ReferenceAnalysis = {
  title: "Balan The Boy",
  altTitles: [],
  language: "Malayalam",
  audienceLanguages: [],
  region: "IN",
  actors: [],
  productionCompany: null,
  releaseDate: "2026-07-01",
  descriptors: [],
  ocrText: null,
  watermark: null,
  visualFeatures: [],
  mediaType: "poster",
};

const ORIGINAL_ENV = { ...process.env };

function serpPayload(links: string[]) {
  return {
    organic: links.map((link, i) => ({
      link,
      title: `Watch Balan The Boy full movie HD ${i}`,
      description: "download 720p torrent magnet",
    })),
  };
}

function mockFetch(impl: (body: unknown) => Response | Promise<Response>) {
  const spy = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    return impl(body);
  });
  vi.stubGlobal("fetch", spy as unknown as typeof fetch);
  return spy;
}

beforeEach(() => {
  process.env.BRIGHT_DATA_API_KEY = "test-bright-data-key";
  delete process.env.BRIGHT_DATA_SERP_ZONE;
  delete process.env.BRIGHT_DATA_ZONE;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("bright data configuration + diagnostics", () => {
  it("reports configured when the key is present", () => {
    expect(isBrightDataConfigured()).toBe(true);
  });

  it("exposes only secret presence and length, never the value", () => {
    const diag = brightDataDiagnostic();
    expect(diag.api_key_present).toBe(true);
    expect(diag.api_key_length).toBe("test-bright-data-key".length);
    expect(JSON.stringify(diag)).not.toContain("test-bright-data-key");
  });

  it("falls back to the default SERP zone", () => {
    expect(brightDataDiagnostic().zone).toBe("serp_api1");
    process.env.BRIGHT_DATA_SERP_ZONE = "custom_serp";
    expect(brightDataDiagnostic().zone).toBe("custom_serp");
  });
});

describe("query building", () => {
  it("only builds exact quoted-title distribution queries", () => {
    const queries = buildBrightDataQueries(analysis, "Balan The Boy", 3);
    expect(queries.length).toBe(3);
    for (const q of queries) expect(q).toContain('"');
  });

  it("returns nothing without a title", () => {
    expect(buildBrightDataQueries({ ...analysis, title: null }, "", 3)).toEqual([]);
  });
});

describe("payload normalization", () => {
  it("parses organic results and drops official/excluded hosts", () => {
    const hits = brightDataHitsFromPayload(
      serpPayload(["https://piracy-example.test/movie", "https://www.netflix.com/title/1"]),
      "q",
    );
    expect(hits.map((h) => h.url).some((u) => u.includes("piracy-example.test"))).toBe(true);
    expect(hits.some((h) => h.url.includes("netflix.com"))).toBe(false);
  });

  it("handles a stringified body wrapper", () => {
    const hits = brightDataHitsFromPayload(
      { body: JSON.stringify(serpPayload(["https://piracy-example.test/a"])) },
      "q",
    );
    expect(hits).toHaveLength(1);
  });

  it("returns no hits for malformed payloads", () => {
    expect(brightDataHitsFromPayload("not json", "q")).toEqual([]);
    expect(brightDataHitsFromPayload({ organic: "nope" }, "q")).toEqual([]);
  });
});

describe("failure categorization", () => {
  it("maps credential, credit, rate-limit and timeout failures", () => {
    expect(classifyBrightDataFailure({ configured: false })).toBe("missing_api_key");
    expect(classifyBrightDataFailure({ status: 401 })).toBe("invalid_credentials");
    expect(classifyBrightDataFailure({ status: 402 })).toBe("insufficient_credits");
    expect(
      classifyBrightDataFailure({ status: 400, bodyText: "insufficient balance on zone" }),
    ).toBe("insufficient_credits");
    expect(classifyBrightDataFailure({ status: 429 })).toBe("rate_limited");
    expect(classifyBrightDataFailure({ status: 503 })).toBe("provider_unavailable");
    expect(classifyBrightDataFailure({ error: new Error("request timed out") })).toBe("timeout");
    expect(classifyBrightDataFailure({ error: "invalid response body" })).toBe("invalid_response");
  });
});

describe("runBrightDataDiscovery", () => {
  it("returns missing_api_key without calling the provider", async () => {
    delete process.env.BRIGHT_DATA_API_KEY;
    const spy = mockFetch(() => new Response("{}", { status: 200 }));
    const result = await runBrightDataDiscovery({ analysis, workTitle: "Balan The Boy" });
    expect(spy).not.toHaveBeenCalled();
    expect(result.configured).toBe(false);
    expect(result.failuresByCategory.missing_api_key).toBe(1);
  });

  it("returns deduplicated candidate leads on success", async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify(
            serpPayload([
              "https://piracy-example.test/movie",
              "https://piracy-example.test/movie",
              "https://mirror-example.test/watch",
            ]),
          ),
          { status: 200 },
        ),
    );
    const result = await runBrightDataDiscovery({
      analysis,
      workTitle: "Balan The Boy",
      maxQueries: 1,
    });
    expect(result.successes).toBe(1);
    expect(result.candidates).toBe(2);
    expect(result.duplicatesDropped).toBeGreaterThanOrEqual(1);
    expect(result.pageLeads.every((l) => l.query.startsWith("brightdata:"))).toBe(true);
    expect(result.pageLeads.some((l) => l.strong)).toBe(true);
  });

  it("stops after invalid credentials and records the category", async () => {
    const spy = mockFetch(() => new Response("Unauthorized", { status: 401 }));
    const result = await runBrightDataDiscovery({
      analysis,
      workTitle: "Balan The Boy",
      maxQueries: 4,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.failuresByCategory.invalid_credentials).toBe(1);
    expect(result.candidates).toBe(0);
  });

  it("stops on insufficient credits", async () => {
    const spy = mockFetch(
      () => new Response("insufficient credits for this zone", { status: 402 }),
    );
    const result = await runBrightDataDiscovery({
      analysis,
      workTitle: "Balan The Boy",
      maxQueries: 4,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.failuresByCategory.insufficient_credits).toBe(1);
  });

  it("retries once on rate limits then records rate_limited", async () => {
    const spy = mockFetch(() => new Response("slow down", { status: 429 }));
    const result = await runBrightDataDiscovery({
      analysis,
      workTitle: "Balan The Boy",
      maxQueries: 1,
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.failuresByCategory.rate_limited).toBe(1);
  });

  it("categorizes malformed JSON as invalid_response", async () => {
    mockFetch(() => new Response("<html>not json</html>", { status: 200 }));
    const result = await runBrightDataDiscovery({
      analysis,
      workTitle: "Balan The Boy",
      maxQueries: 1,
    });
    expect(result.failuresByCategory.invalid_response).toBe(1);
    expect(result.candidates).toBe(0);
  });

  it("categorizes network timeouts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("request timed out");
      }) as unknown as typeof fetch,
    );
    const result = await runBrightDataDiscovery({
      analysis,
      workTitle: "Balan The Boy",
      maxQueries: 1,
    });
    expect(result.failuresByCategory.timeout).toBe(1);
  });

  it("flags no_results when the provider succeeds with nothing usable", async () => {
    mockFetch(() => new Response(JSON.stringify({ organic: [] }), { status: 200 }));
    const result = await runBrightDataDiscovery({
      analysis,
      workTitle: "Balan The Boy",
      maxQueries: 1,
    });
    expect(result.successes).toBe(1);
    expect(result.failuresByCategory.no_results).toBe(1);
  });

  it("emits live telemetry callbacks while searching", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify(serpPayload(["https://piracy-example.test/x"])), {
          status: 200,
        }),
    );
    const events: string[] = [];
    await runBrightDataDiscovery({
      analysis,
      workTitle: "Balan The Boy",
      maxQueries: 1,
      onActivity: (e) => {
        events.push(e.status);
      },
    });
    expect(events).toEqual(["searching", "results"]);
  });

  it("never leaks the API key in failure samples", async () => {
    mockFetch(
      () =>
        new Response(`auth failed for Bearer ${process.env.BRIGHT_DATA_API_KEY}`, { status: 401 }),
    );
    const result = await runBrightDataDiscovery({
      analysis,
      workTitle: "Balan The Boy",
      maxQueries: 1,
    });
    expect(JSON.stringify(result)).not.toContain("test-bright-data-key");
  });

  it("sends the zone and bearer auth to the SERP endpoint", async () => {
    const spy = mockFetch((body) => {
      expect((body as { zone: string }).zone).toBe("serp_api1");
      return new Response(JSON.stringify({ organic: [] }), { status: 200 });
    });
    await runBrightDataDiscovery({ analysis, workTitle: "Balan The Boy", maxQueries: 1 });
    expect(spy).toHaveBeenCalled();
  });
});

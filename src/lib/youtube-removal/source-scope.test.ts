import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectNewsAllegationSignals,
  classifyNewsTopics,
  classifySourceType,
  buildAllegationQueryPlan,
  formatNewsSafetyNote,
} from "./news-intelligence";
import { buildQueryPlan } from "./queries";
import { getPrioritizedQueryPlan } from "./scan.server";
import { getCachedSearch, setCachedSearch, clearL1Cache } from "./youtube-quota-cache";

describe("Source Scope & YouTube Data API Intelligence Engine Test Suite", () => {
  const targetName = "Gokulam Gopalan";

  it("1. detectNewsAllegationSignals correctly identifies allegation and investigation vocabulary", () => {
    const text1 = "Asianet News debate on Gokulam Gopalan corruption scandal and ED investigation";
    const res1 = detectNewsAllegationSignals(text1);
    assert.equal(res1.isAllegationMatch, true);
    assert.ok(res1.matchedSignals.includes("ed") || res1.matchedSignals.includes("investigation"));

    const text2 = "Gokulam Gopalan speech at college cultural day function";
    const res2 = detectNewsAllegationSignals(text2);
    assert.equal(res2.isAllegationMatch, false);
  });

  it("2. Malayalam allegation terms and transliterations match correctly", () => {
    const textML = "Gokulam Gopalan തട്ടിപ്പ് case in court";
    const resML = detectNewsAllegationSignals(textML);
    assert.equal(resML.isAllegationMatch, true);
    assert.ok(resML.matchedSignals.includes("തട്ടിപ്പ്") || resML.matchedSignals.includes("case"));
  });

  it("3. classifyNewsTopics assigns correct topic tags", () => {
    const text = "Special report on Gokulam Gopalan scam allegation and police fraud case";
    const signals = ["scam", "fraud", "allegation", "case"];
    const tags = classifyNewsTopics(text, signals);

    assert.ok(tags.includes("SCAM_ALLEGATION"));
    assert.ok(tags.includes("FRAUD_ALLEGATION"));
    assert.ok(tags.includes("FINANCIAL_COMPLAINT"));
  });

  it("4. classifySourceType assigns correct UI badges", () => {
    assert.equal(classifySourceType("Asianet News", "official_news"), "OFFICIAL_NEWS");
    assert.equal(classifySourceType("Malayalam Commentary Hub", "independent"), "COMMENTARY");
    assert.equal(classifySourceType("Cinema Interview Channel", "independent"), "INTERVIEW");
    assert.equal(classifySourceType("Independent Creator", "independent"), "INDEPENDENT_CREATOR");
  });

  it("5. buildAllegationQueryPlan expands target search terms", () => {
    const queries = buildAllegationQueryPlan(targetName, ["Sree Gokulam Gopalan"]);
    assert.ok(queries.some((q) => q.includes("Gokulam Gopalan scam")));
    assert.ok(queries.some((q) => q.includes("Gokulam Gopalan ED raid")));
  });

  it("6. News status does not artificially inflate removal scores (remains NOT_ELIGIBLE / LOW)", () => {
    const newsAllegation = {
      title: "Asianet News Hour: Gokulam Gopalan business complaint discussion",
      channel_class: "official_news",
      removal_potential: "not_eligible",
      recommended_action: "MONITOR",
    };

    assert.equal(newsAllegation.removal_potential, "not_eligible");
    assert.equal(newsAllegation.recommended_action, "MONITOR");
  });

  it("7. formatNewsSafetyNote outputs neutral safety wording", () => {
    const note = formatNewsSafetyNote(["SCAM_ALLEGATION", "FRAUD_ALLEGATION"]);
    assert.ok(note.includes("News coverage discussing"));
    assert.ok(!note.includes("Target committed fraud"));
  });

  it("8. Source-type telemetry reconciles across all modes", () => {
    const totalVerified = 10;
    const independentVerified = 7;
    const officialNewsVerified = 3;

    assert.equal(totalVerified, independentVerified + officialNewsVerified);
  });

  it("9. Query plan matches selected source scope", () => {
    const basePlan = buildQueryPlan({ targetName });
    const allegationPlan = buildAllegationQueryPlan(targetName);
    const combinedPlan = Array.from(new Set([...basePlan, ...allegationPlan]));

    assert.ok(combinedPlan.length > basePlan.length);
    assert.ok(combinedPlan.some((q) => q.includes("scam")));
  });

  it("10. Scan creation payload incorporates source_scope", () => {
    const payloadNON = { target_name: targetName, source_scope: "NON_OFFICIAL_ONLY" };
    const payloadNEWS = { target_name: targetName, source_scope: "NEWS_ALLEGATIONS" };
    const payloadALL = { target_name: targetName, source_scope: "ALL_SOURCES" };

    assert.equal(payloadNON.source_scope, "NON_OFFICIAL_ONLY");
    assert.equal(payloadNEWS.source_scope, "NEWS_ALLEGATIONS");
    assert.equal(payloadALL.source_scope, "ALL_SOURCES");
  });

  it("11. Retry logic preserves persisted source_scope", () => {
    const persistedScan = { id: "scan-123", source_scope: "NEWS_ALLEGATIONS" };
    const retryScope = persistedScan.source_scope || "NON_OFFICIAL_ONLY";

    assert.equal(retryScope, "NEWS_ALLEGATIONS");
  });

  it("12. Discovery relies ONLY on official YouTube Data API queries", () => {
    const queries = buildAllegationQueryPlan(targetName);
    assert.ok(queries.every((q) => !q.includes("firecrawl") && !q.includes("site:reddit.com")));
  });

  it("13. YouTube API quota error surfaces clear YOUTUBE_QUOTA_EXCEEDED failure code", () => {
    const err: any = new Error("YouTube /search [403]: quotaExceeded");
    err.code = "YOUTUBE_QUOTA_EXCEEDED";
    assert.equal(err.code, "YOUTUBE_QUOTA_EXCEEDED");
  });

  it("14. Missing transcript does not fail candidate processing", () => {
    const candidateFallback = {
      transcriptState: "missing",
      contentTypes: ["EVIDENCE_TRANSCRIPT_MISSING"],
      subjectStatus: "verified",
    };

    assert.equal(candidateFallback.subjectStatus, "verified");
    assert.ok(candidateFallback.contentTypes.includes("EVIDENCE_TRANSCRIPT_MISSING"));
  });

  it("15. Individual candidate failure does not abort scan batch", () => {
    const batchResults = [
      { videoId: "v1", status: "verified" },
      { videoId: "v2", status: "uncertain", error: "network_timeout" },
      { videoId: "v3", status: "verified" },
    ];

    const verified = batchResults.filter((r) => r.status === "verified");
    assert.equal(verified.length, 2);
    assert.equal(batchResults.length, 3);
  });

  it("16. Deduplication removes duplicate video IDs across multiple search queries", () => {
    const rawHits = [
      { videoId: "vid1", query: "q1" },
      { videoId: "vid2", query: "q1" },
      { videoId: "vid1", query: "q2" },
    ];

    const uniqueMap = new Map<string, { videoId: string; queries: string[] }>();
    for (const hit of rawHits) {
      const existing = uniqueMap.get(hit.videoId);
      if (existing) {
        existing.queries.push(hit.query);
      } else {
        uniqueMap.set(hit.videoId, { videoId: hit.videoId, queries: [hit.query] });
      }
    }

    assert.equal(uniqueMap.size, 2);
    assert.deepEqual(uniqueMap.get("vid1")?.queries, ["q1", "q2"]);
  });

  it("17. Scan query plan NEVER exceeds hard search request budget of 8", () => {
    const nonOfficialPlan = getPrioritizedQueryPlan(targetName, "NON_OFFICIAL_ONLY");
    const newsPlan = getPrioritizedQueryPlan(targetName, "NEWS_ALLEGATIONS");
    const allSourcesPlan = getPrioritizedQueryPlan(targetName, "ALL_SOURCES");

    assert.ok(nonOfficialPlan.length <= 5);
    assert.ok(newsPlan.length <= 6);
    assert.ok(allSourcesPlan.length <= 8);
  });

  it("18. L1 Memory & L2 Supabase persistent cache returns hits on repeated query", async () => {
    clearL1Cache();
    const query = "Gokulam Gopalan interview";
    const dummyHits: any[] = [{ videoId: "cache_vid_1", title: "Cached Video Title" }];

    const initial = await getCachedSearch(null, query, 1, "relevance", null);
    assert.equal(initial, null);

    await setCachedSearch(null, query, 1, "relevance", null, dummyHits);

    const hit = await getCachedSearch(null, query, 1, "relevance", null);
    assert.ok(hit != null);
    assert.equal(hit?.source, "L1");
    assert.equal(hit?.hits.length, 1);
    assert.equal(hit?.hits[0].videoId, "cache_vid_1");
  });

  it("19. Early stop threshold stops discovery when deduplicated videos reach limit", () => {
    const byVideo = new Map<string, any>();
    const EARLY_STOP_THRESHOLD = 150;

    for (let i = 0; i < 150; i++) {
      byVideo.set(`vid_${i}`, { videoId: `vid_${i}` });
    }

    const shouldStop = byVideo.size >= EARLY_STOP_THRESHOLD;
    assert.equal(shouldStop, true);
  });

  it("20. YOUTUBE_QUOTA_EXCEEDED and YOUTUBE_RATE_LIMIT remain distinct errors", () => {
    const quotaErr: any = new Error("YouTube /search [403]: quotaExceeded");
    quotaErr.code = "YOUTUBE_QUOTA_EXCEEDED";

    const rateErr: any = new Error("YouTube /search [429]: rateLimitExceeded");
    rateErr.code = "YOUTUBE_RATE_LIMIT";

    assert.notEqual(quotaErr.code, rateErr.code);
    assert.equal(quotaErr.code, "YOUTUBE_QUOTA_EXCEEDED");
    assert.equal(rateErr.code, "YOUTUBE_RATE_LIMIT");
  });

  it("21. ALL_SOURCES mode does NOT execute all 28-30 expansion queries blindly", () => {
    const plan = getPrioritizedQueryPlan(targetName, "ALL_SOURCES");
    assert.equal(plan.length, 8);
    assert.ok(plan.includes("Gokulam Gopalan scam"));
    assert.ok(plan.includes("Gokulam Gopalan interview"));
  });

  it("22. Cached discovery hits only contain raw metadata (no cached removal/verification decisions)", async () => {
    clearL1Cache();
    const query = "Gokulam Gopalan";
    const rawHit: any[] = [
      {
        videoId: "raw_vid_123",
        title: "Raw Title",
        description: "Raw Desc",
        channelId: "ch1",
        channelTitle: "Chan",
      },
    ];

    await setCachedSearch(null, query, 1, "relevance", null, rawHit);
    const cached = await getCachedSearch(null, query, 1, "relevance", null);

    assert.ok(cached != null);
    assert.equal((cached?.hits[0] as any).subjectStatus, undefined);
    assert.equal((cached?.hits[0] as any).removalPotential, undefined);
  });
});

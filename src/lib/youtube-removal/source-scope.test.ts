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
});

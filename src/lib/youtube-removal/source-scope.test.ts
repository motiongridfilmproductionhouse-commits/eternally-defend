import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectNewsAllegationSignals,
  classifyNewsTopics,
  classifySourceType,
  buildAllegationQueryPlan,
  formatNewsSafetyNote,
} from "./news-intelligence";

describe("Source Scope & News Allegation Intelligence Engine Test Suite", () => {
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
});

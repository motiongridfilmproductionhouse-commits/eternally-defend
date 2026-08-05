import assert from "node:assert/strict";
import test from "node:test";
import { scoreBusinessRelevance } from "./relevance";
import { classifyBusinessFinding } from "./classification";

const base = {
  businessName: "Acme Coffee",
  aliases: ["Acme Cafe"],
  domain: "acmecoffee.com",
  city: "Austin",
  industry: "coffee",
  executiveNames: ["Jane Doe"],
};

test("relevance thresholds map to the required bands", () => {
  assert.equal(
    scoreBusinessRelevance({ ...base, title: "Acme Coffee acmecoffee.com Austin coffee Jane Doe" })
      .band,
    "verified",
  );
  assert.equal(
    scoreBusinessRelevance({ ...base, title: "Acme Coffee Austin coffee Jane Doe" }).band,
    "high_confidence",
  );
  assert.equal(
    scoreBusinessRelevance({ ...base, title: "Acme Coffee Austin" }).band,
    "review_required",
  );
  assert.equal(
    scoreBusinessRelevance({ ...base, title: "Coffee shop in London" }).band,
    "rejected",
  );
});
test("exact name, alias, domain, product, executive, and branch signals are captured", () => {
  const decision = scoreBusinessRelevance({
    ...base,
    title: "Acme Cafe Austin coffee Jane Doe",
    url: "https://acmecoffee.com/menu",
  });
  assert.ok(decision.score >= 85);
  assert.equal(decision.reasons.length >= 4, true);
});
test("same-name business with unrelated country or industry is rejected", () =>
  assert.equal(
    scoreBusinessRelevance({
      ...base,
      title: "Acme Coffee",
      description: "London metal fabrication",
    }).band,
    "rejected",
  ));
test("negative opinion is not defamation", () =>
  assert.equal(
    classifyBusinessFinding({ title: "Acme Coffee is awful", source: "Web" }).category,
    "negative_opinion",
  ));
test("customer complaint is not automatically defamation", () =>
  assert.equal(
    classifyBusinessFinding({
      title: "My order never arrived",
      description: "Customer complaint about refund",
    }).category,
    "customer_complaint",
  ));
test("serious allegations remain preliminary and require review", () => {
  const x = classifyBusinessFinding({ title: "Acme Coffee accused of stealing funds" });
  assert.equal(x.category, "serious_allegation");
  assert.equal(x.reviewRequired, true);
});
test("impersonation and fraud are separate categories", () => {
  assert.equal(
    classifyBusinessFinding({ title: "Fake customer support account" }).category,
    "impersonation",
  );
  assert.equal(
    classifyBusinessFinding({ title: "Acme Coffee scam payment page" }).category,
    "fraud",
  );
});
test("news and regulatory reports are not removal candidates", () => {
  for (const x of [
    { title: "Regulatory report: Acme Coffee fined", source: "Regulatory" },
    { title: "News report about Acme Coffee", source: "News" },
  ])
    assert.equal(classifyBusinessFinding(x).removalCandidate, false);
});
test("unverified allegations require review", () =>
  assert.equal(
    classifyBusinessFinding({ title: "Rumor and unverified allegation" }).reviewRequired,
    true,
  ));
test("automated classification never grants approval", () => {
  const x = classifyBusinessFinding({ title: "Fake payment page" });
  assert.equal(x.confirmedViolation, false);
  assert.equal(x.approvedForReporting, false);
  assert.equal(x.approvedForLegalEscalation, false);
});

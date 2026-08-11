import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  verifyTargetIdentity,
  decideTargetThreat,
  isClientVisibleDecision,
} from "./target-identity";

const TARGET = "Bhama Kurup";

describe("Deepfake target-identity gate — zero false positive mode", () => {
  it("excludes generic deepfake news (Telegram apologises to South Korea)", () => {
    const identity = verifyTargetIdentity({
      target: TARGET,
      title: "Deepfake porn scandal: Telegram apologises to South Korea",
      url: "https://bbc.com/news/articles/abc123",
      snippet:
        "Telegram has apologised to South Korean authorities for its handling of deepfake pornographic material.",
      pageText:
        "Telegram has apologised to South Korean authorities amid a digital sex crime epidemic in the country.",
    });
    assert.equal(identity.status, "NOT_VERIFIED");
    const decision = decideTargetThreat(identity, {
      explicitConfirmed: true,
      syntheticConfirmed: true,
      syntheticConfidence: 96,
      hostingConfirmed: true,
    });
    assert.equal(decision, "NOT_SUBJECT");
    assert.equal(isClientVisibleDecision(decision), false);
  });

  it("excludes Bombay HC deepfake bots article", () => {
    const identity = verifyTargetIdentity({
      target: TARGET,
      title: "Bombay HC asks govt for details on Telegram deepfake bots that create nude photos of women",
      url: "https://indiatoday.in/technology/news/story/bombay-hc-telegram-deepfake-bots",
      snippet: "Bombay HC asks govt for details on Telegram deepfake bots that create nude photos of women",
    });
    assert.equal(identity.status, "NOT_VERIFIED");
    assert.equal(
      decideTargetThreat(identity, { explicitConfirmed: true, syntheticConfirmed: true }),
      "NOT_SUBJECT",
    );
  });

  it("query provenance alone never establishes identity", () => {
    const identity = verifyTargetIdentity({
      target: TARGET,
      title: "The rise of deepfakes explained",
      url: "https://example.com/blog/deepfake-explainer",
      pageText: "A general explainer about how deepfakes are made and detected.",
    });
    assert.equal(identity.status, "NOT_VERIFIED");
    assert.equal(identity.rejectionReason !== null, true);
  });

  it("allows a target-specific synthetic intimate imagery page", () => {
    const identity = verifyTargetIdentity({
      target: TARGET,
      title: "Bhama Kurup deepfake nude gallery — download",
      url: "https://mrdeepfakes.example/videos/bhama-kurup-fake",
      pageText: "Bhama Kurup face swap fake nude video gallery, AI generated, download links.",
      faceSimilarity: 91,
      targetFaceMatch: true,
    });
    assert.equal(identity.status, "VERIFIED");
    const decision = decideTargetThreat(identity, {
      explicitConfirmed: true,
      syntheticConfirmed: true,
      syntheticConfidence: 92,
      hostingConfirmed: true,
    });
    assert.equal(decision, "VERIFIED_TARGET_THREAT");
  });

  it("target verified but no synthetic evidence is excluded", () => {
    const identity = verifyTargetIdentity({
      target: TARGET,
      title: "Bhama Kurup interview about her new film",
      url: "https://example.com/bhama-kurup-interview",
      pageText: "Bhama Kurup spoke about her new film in an interview.",
    });
    assert.notEqual(identity.status, "NOT_VERIFIED");
    assert.equal(decideTargetThreat(identity, {}), "NOT_DEEPFAKE_THREAT");
  });

  it("works for any target, not a hardcoded name", () => {
    const identity = verifyTargetIdentity({
      target: "Saniya Iyappan",
      title: "Saniya Iyappan AI generated fake nude photos leaked",
      url: "https://t.me/s/channel/123",
      pageText: "Saniya Iyappan deepfake nude photos shared in this channel.",
    });
    assert.equal(identity.status === "NOT_VERIFIED", false);
  });
});

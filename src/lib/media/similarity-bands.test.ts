import { describe, expect, it } from "vitest";
import {
  SIMILARITY_BAND_MIN,
  classifySimilarityBand,
  detectionTypeForBand,
  normalizeBandName,
  similarityBandLabel,
  similarityBandRange,
} from "./similarity-bands";

describe("similarity bands", () => {
  it("keeps the validated thresholds unchanged", () => {
    expect(SIMILARITY_BAND_MIN).toEqual({ exact: 92, probable: 84, possible: 75 });
  });

  it("classifies at the exact boundaries", () => {
    expect(classifySimilarityBand(100)).toBe("exact");
    expect(classifySimilarityBand(92)).toBe("exact");
    expect(classifySimilarityBand(91.9)).toBe("probable");
    expect(classifySimilarityBand(84)).toBe("probable");
    expect(classifySimilarityBand(83)).toBe("possible");
    expect(classifySimilarityBand(75)).toBe("possible");
    expect(classifySimilarityBand(74)).toBe("unrelated");
  });

  it("derives label ranges from the thresholds (no drift)", () => {
    expect(similarityBandRange("exact")).toBe("92-100%");
    expect(similarityBandRange("probable")).toBe("84-91%");
    expect(similarityBandRange("possible")).toBe("75-83%");
    expect(similarityBandLabel("probable")).toBe("Probable match (84-91%)");
  });

  it("names detection types with the same terminology as the band", () => {
    expect(detectionTypeForBand("exact")).toBe("verified_reupload");
    expect(detectionTypeForBand("probable")).toBe("probable_reupload");
    expect(detectionTypeForBand("possible")).toBe("possible_match");
    expect(detectionTypeForBand("unrelated")).toBe("unverified_candidate");
  });

  it("normalises every band vocabulary in the product", () => {
    expect(normalizeBandName("confirmed")).toBe("exact");
    expect(normalizeBandName("exact")).toBe("exact");
    expect(normalizeBandName("Probable")).toBe("probable");
    expect(normalizeBandName("review")).toBe("possible");
    expect(normalizeBandName("possible")).toBe("possible");
    expect(normalizeBandName(null)).toBe("unrelated");
  });
});

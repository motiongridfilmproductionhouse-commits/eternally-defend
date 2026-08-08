import { describe, it } from "node:test";
import assert from "node:assert";
import { verifyMoviePrintCandidate } from "./strict-movie-verification";

describe("Strict Movie Identity & Evidence Verification", () => {
  it("rejects landmarktheatres.com generic/movie-booking page", () => {
    const res = verifyMoviePrintCandidate({
      url: "https://www.landmarktheatres.com/film/thudakkam",
      pageTitle: "Thudakkam - Landmark Theatres - Showtimes and Tickets",
      workTitle: "Thudakkam",
      confidence: 35,
    });
    assert.strictEqual(res.clientVisible, false);
    assert.strictEqual(res.status, "OFFICIAL_SOURCE");
  });

  it("rejects district.in cinema booking page", () => {
    const res = verifyMoviePrintCandidate({
      url: "https://district.in/movies/thudakkam",
      pageTitle: "Book Thudakkam Movie Tickets Online on District",
      workTitle: "Thudakkam",
      confidence: 40,
    });
    assert.strictEqual(res.clientVisible, false);
    assert.strictEqual(res.status, "OFFICIAL_SOURCE");
  });

  it("rejects fridaytheatres.com unrelated/legitimate page", () => {
    const res = verifyMoviePrintCandidate({
      url: "https://fridaytheatres.com/showtimes/thudakkam",
      pageTitle: "Friday Theatres - Thudakkam Movie Times",
      workTitle: "Thudakkam",
      confidence: 35,
    });
    assert.strictEqual(res.clientVisible, false);
    assert.strictEqual(res.status, "OFFICIAL_SOURCE");
  });

  it("rejects deviantart artwork page", () => {
    const res = verifyMoviePrintCandidate({
      url: "https://www.deviantart.com/artist/art/Thudakkam-Fanart-123456",
      pageTitle: "Thudakkam Poster Fan Art by Artist on DeviantArt",
      workTitle: "Thudakkam",
      confidence: 40,
    });
    assert.strictEqual(res.clientVisible, false);
    assert.strictEqual(res.status, "OFFICIAL_SOURCE");
  });

  it("rejects DIFFERENT_WORK (e.g. Odyssey Full Movie returned for Thudakkam query)", () => {
    const res = verifyMoviePrintCandidate({
      url: "https://movierulz.example/odyssey-full-movie-watch-online",
      pageTitle: "Odyssey Full Movie Watch Online Free 1080p",
      workTitle: "Thudakkam",
      confidence: 85,
    });
    assert.strictEqual(res.clientVisible, false);
    assert.strictEqual(res.status, "DIFFERENT_WORK");
  });

  it("rejects REJECTED_PROMOTIONAL (e.g. Thudakkam Official Trailer)", () => {
    const res = verifyMoviePrintCandidate({
      url: "https://youtube.com/watch?v=12345",
      pageTitle: "Thudakkam Official Trailer 4K | Malayalam Movie",
      workTitle: "Thudakkam",
      confidence: 90,
    });
    assert.strictEqual(res.clientVisible, false);
    assert.strictEqual(res.status, "REJECTED_PROMOTIONAL");
  });

  it("rejects DIFFERENT_WORK (e.g. Oru Anveshanathinte Thudakkam)", () => {
    const res = verifyMoviePrintCandidate({
      url: "https://movies.example/oru-anveshanathinte-thudakkam-full-movie",
      pageTitle: "Oru Anveshanathinte Thudakkam Full Movie Watch Online",
      workTitle: "Thudakkam",
      confidence: 85,
    });
    assert.strictEqual(res.clientVisible, false);
    assert.strictEqual(res.status, "DIFFERENT_WORK");
  });

  it("accepts VERIFIED_MOVIE_COPY for confirmed matching full movie distribution page", () => {
    const res = verifyMoviePrintCandidate({
      url: "https://movierulz.example/thudakkam-2026-full-movie-watch-online",
      finalUrl: "https://movierulz.example/thudakkam-2026-full-movie-watch-online",
      pageTitle: "Thudakkam (2026) Malayalam Full Movie Watch Online 1080p WEB-DL",
      workTitle: "Thudakkam",
      altTitles: ["Thudakkam 2026"],
      releaseYear: "2026",
      confidence: 94,
      markdown: "Watch Thudakkam 2026 full movie online free 1080p torrent magnet download link embedded player",
      hasPlayerOrDownload: true,
    });
    assert.strictEqual(res.clientVisible, true);
    assert.strictEqual(res.status, "VERIFIED_MOVIE_COPY");
    assert.strictEqual(res.score, 94);
  });
});

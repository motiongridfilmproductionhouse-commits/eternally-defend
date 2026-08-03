import assert from "node:assert/strict";
import test from "node:test";
import { buildGoogleImagesInvestigationQueries } from "./google-images-queries.server";
import {
  emptyGoogleImagesDiagnostics,
  formatGoogleImagesDiagnosticLines,
  parseGoogleImagesDiagnostics,
} from "./google-images-diagnostics";

test("buildGoogleImagesInvestigationQueries generates deepfake keyword variations", () => {
  const queries = buildGoogleImagesInvestigationQueries({
    name: "Dulquer Salmaan",
    aliases: ["DQ"],
  });
  const joined = queries.join("\n").toLowerCase();
  assert.match(joined, /dulquer salmaan/);
  assert.match(joined, /deepfake/);
  assert.match(joined, /face swap/);
  assert.match(joined, /fake nude/);
  assert.match(joined, /fake intimate/);
  assert.ok(queries.some((q) => /\bdq\b/i.test(q) && /ai/i.test(q)));
  assert.ok(queries.length >= 12);
});

test("buildGoogleImagesInvestigationQueries includes native script aliases", () => {
  const queries = buildGoogleImagesInvestigationQueries({ name: "Dulquer Salmaan" });
  assert.ok(queries.some((q) => /[\u0D00-\u0D7F]/.test(q)));
});

test("google images diagnostics parse and format", () => {
  const empty = emptyGoogleImagesDiagnostics();
  assert.equal(empty.provider_status, "not_started");

  const parsed = parseGoogleImagesDiagnostics({
    google_images_diagnostic: {
      queries_executed: 58,
      pages_loaded: 12,
      images_discovered: 742,
      images_downloaded: 615,
      duplicate_images: 83,
      valid_faces: 491,
      high_confidence_matches: 12,
      candidate_pages_crawled: 12,
      evidence_packages_created: 12,
      failed_downloads: 7,
      provider_status: "success",
    },
  });
  assert.equal(parsed.queries_executed, 58);
  assert.equal(parsed.images_discovered, 742);
  const lines = formatGoogleImagesDiagnosticLines(parsed);
  assert.ok(lines.some((line) => /Queries Executed: 58/.test(line)));
  assert.ok(lines.some((line) => /Provider Status: success/.test(line)));
});

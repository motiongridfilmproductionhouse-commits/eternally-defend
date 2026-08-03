import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateGoogleImagesDiagnostics,
} from "./google-images-jobs.server";
import { resolveGoogleImagesWorkerUrl } from "./google-images-worker-dispatch.server";
import {
  googleImagesBackgroundProgress,
  googleImagesBackgroundStatus,
} from "./google-images-diagnostics";

test("aggregateGoogleImagesDiagnostics sums per-query metrics", () => {
  const diagnostics = aggregateGoogleImagesDiagnostics(
    [
      {
        status: "completed",
        metrics: {
          images_discovered: 40,
          face_comparisons: 12,
          evidence_packages_created: 2,
        },
      },
      {
        status: "completed",
        metrics: {
          images_discovered: 35,
          face_comparisons: 8,
          evidence_packages_created: 1,
        },
      },
      { status: "queued", metrics: {} },
    ],
    3,
  );
  assert.equal(diagnostics.images_discovered, 75);
  assert.equal(diagnostics.face_comparisons, 20);
  assert.equal(diagnostics.evidence_packages_created, 3);
  assert.equal(diagnostics.queries_executed, 2);
  assert.equal(diagnostics.queries_planned, 3);
});

test("google images background progress helpers", () => {
  const metrics = {
    google_images_background_status: "running",
    google_images_jobs_total: 58,
    google_images_jobs_completed: 15,
    google_images_progress_percent: 26,
    google_images_diagnostic: {
      images_discovered: 142,
      face_comparisons: 96,
      evidence_packages_created: 3,
    },
  };
  assert.equal(googleImagesBackgroundStatus(metrics), "running");
  const progress = googleImagesBackgroundProgress(metrics);
  assert.equal(progress.completed, 15);
  assert.equal(progress.total, 58);
  assert.equal(progress.running, true);
});

test("resolveGoogleImagesWorkerUrl derives hook from site url", () => {
  const url = resolveGoogleImagesWorkerUrl({
    SITE_URL: "https://eternally-defend.vercel.app",
  } as NodeJS.ProcessEnv);
  assert.equal(
    url,
    "https://eternally-defend.vercel.app/api/public/hooks/deepfake-google-images-worker",
  );
});

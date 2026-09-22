import { chromium, type BrowserContext } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { config, TIMEOUTS } from "./config.js";
import { eterna, type FetchedJob } from "./eterna.js";
import { adaptersById } from "./adapters/youtube.js";
import type { AdapterContext, PlatformAdapter } from "./adapters/types.js";
import {
  assertJobNotCancelled,
  JobCancelledError,
  type CancellationChecker,
} from "./cancellation.js";

function nowMs(): number {
  return Date.now();
}

async function fetchArtifact(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch artifact ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

type AuditFn = (
  event: string,
  payload?: Record<string, unknown>,
  extra?: Partial<Parameters<typeof eterna.event>[0]>,
) => Promise<unknown>;

/**
 * Runs one job's adapter flow (authenticate → navigateToForm → populate →
 * uploadEvidence → validate → generateReviewSummary), checking for
 * cancellation before and after every major Playwright step so a job
 * cancelled mid-run stops safely and never reports `review_ready`.
 *
 * Split out from `runJob` (which owns the actual browser/context lifecycle)
 * so the cancellation-race behavior can be tested directly against a fake
 * adapter and fake `isCancelled` checker, without launching a real browser.
 */
export async function runAdapterSteps(input: {
  adapter: PlatformAdapter;
  ctx: AdapterContext;
  job: FetchedJob;
  audit: AuditFn;
  isCancelled: CancellationChecker;
  fetchArtifact: (url: string) => Promise<Buffer>;
  startedAt: number;
}): Promise<void> {
  const {
    adapter,
    ctx,
    job,
    audit,
    isCancelled,
    fetchArtifact: fetchArtifactFn,
    startedAt,
  } = input;
  const checkpoint = () => assertJobNotCancelled(job.job_id, isCancelled);

  try {
    await checkpoint();
    const authState = await adapter.authenticate(ctx);
    if (authState === "login_required") {
      await audit(
        "auth_required",
        { credential_status: job.credential?.status ?? null },
        {
          status: "failed",
          result: "error",
          error: { code: "login_required", message: "Platform session missing or expired" },
        },
      );
      return;
    }
    await audit("auth_restored", {}, { result: "ok" });
    await checkpoint();

    await adapter.navigateToForm(ctx);
    await checkpoint();

    await adapter.populate(ctx, job.input);
    await checkpoint();

    // Fetch and upload evidence files if the adapter uses them.
    const files: Array<{ name: string; buffer: Buffer }> = [];
    for (const [filePath, url] of Object.entries(job.signed_urls)) {
      const name = filePath.split("/").pop() ?? "artifact.pdf";
      files.push({ name, buffer: await fetchArtifactFn(url) });
    }
    await adapter.uploadEvidence(ctx, files);
    await checkpoint();

    const validation = await adapter.validate(ctx);
    await audit("validation_completed", { ok: validation.ok, issues: validation.issues });
    await checkpoint();

    const summary = await adapter.generateReviewSummary(ctx);
    // Final gate: never report review_ready once cancellation is detected,
    // even if every prior step already completed.
    await checkpoint();

    await audit(
      "review_generated",
      {},
      {
        status: "review_ready",
        result: "ok",
        review_summary: summary as unknown as Record<string, unknown>,
        duration_ms: nowMs() - startedAt,
      },
    );
  } catch (e) {
    if (e instanceof JobCancelledError) {
      await audit("job_cancelled_detected", {}, { status: "cancelled", result: "ok" });
      return;
    }
    await audit(
      "error",
      { message: e instanceof Error ? e.message : String(e) },
      {
        status: "failed",
        result: "error",
        error: { message: e instanceof Error ? e.message : String(e) },
      },
    );
  }
}

export async function runJob(jobId: string): Promise<void> {
  const job: FetchedJob = await eterna.fetchJob(jobId);
  const adapter = adaptersById[job.adapter];
  if (!adapter) throw new Error(`Unknown adapter: ${job.adapter}`);

  const startedAt = nowMs();
  const audit: AuditFn = (event, payload, extra = {}) =>
    eterna.event({ job_id: job.job_id, event, payload, ...extra });
  const isCancelled: CancellationChecker = async (id) => {
    const res = await eterna.checkStatus(id);
    return res.status === "cancelled";
  };

  // Check before doing any work at all — a job can be cancelled between
  // being fetched and the worker actually starting on it.
  try {
    await assertJobNotCancelled(job.job_id, isCancelled);
  } catch (e) {
    if (e instanceof JobCancelledError) {
      await audit("job_cancelled_detected", {}, { status: "cancelled", result: "ok" });
      return;
    }
    throw e;
  }

  await audit("browser_started", { adapter: job.adapter }, { status: "running", result: "ok" });

  const profileDir = path.join(config.PROFILE_DIR, job.user_id, job.platform);
  await mkdir(profileDir, { recursive: true });

  const storageState = job.credential?.storage_state_json
    ? JSON.parse(job.credential.storage_state_json)
    : undefined;

  let context: BrowserContext | null = null;
  try {
    const browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      storageState,
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUTS.navigationMs);

    const ctx: AdapterContext = {
      page,
      browserContext: context,
      job,
      audit: (event, payload) => audit(event, payload).then(() => undefined),
      screenshot: async (_label) => null, // Batch 3: uploads to enforcement-screenshots bucket
      fetchArtifact,
    };

    await runAdapterSteps({ adapter, ctx, job, audit, isCancelled, fetchArtifact, startedAt });
  } catch (e) {
    // Only reachable for failures outside runAdapterSteps' own try/catch,
    // e.g. the browser itself failing to launch.
    await audit(
      "error",
      { message: e instanceof Error ? e.message : String(e) },
      {
        status: "failed",
        result: "error",
        error: { message: e instanceof Error ? e.message : String(e) },
      },
    );
  } finally {
    if (context) await context.close();
  }
}

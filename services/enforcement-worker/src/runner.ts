import { chromium, type BrowserContext } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { config, TIMEOUTS } from "./config.js";
import { eterna, type FetchedJob } from "./eterna.js";
import { adaptersById } from "./adapters/youtube.js";
import type { AdapterContext } from "./adapters/types.js";

function nowMs(): number {
  return Date.now();
}

async function fetchArtifact(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch artifact ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

export async function runJob(jobId: string): Promise<void> {
  const job: FetchedJob = await eterna.fetchJob(jobId);
  const adapter = adaptersById[job.adapter];
  if (!adapter) throw new Error(`Unknown adapter: ${job.adapter}`);

  const startedAt = nowMs();
  const audit = (event: string, payload?: Record<string, unknown>, extra: Partial<Parameters<typeof eterna.event>[0]> = {}) =>
    eterna.event({ job_id: job.job_id, event, payload, ...extra });

  await audit("browser_started", { adapter: job.adapter }, { status: "running", result: "ok" });

  const profileDir = path.join(config.PROFILE_DIR, job.user_id, job.platform);
  await mkdir(profileDir, { recursive: true });

  const storageState = job.credential?.storage_state_json ? JSON.parse(job.credential.storage_state_json) : undefined;

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

    const authState = await adapter.authenticate(ctx);
    if (authState === "login_required") {
      await audit("auth_required", { credential_status: job.credential?.status ?? null }, {
        status: "failed",
        result: "error",
        error: { code: "login_required", message: "Platform session missing or expired" },
      });
      return;
    }
    await audit("auth_restored", {}, { result: "ok" });

    await adapter.navigateToForm(ctx);
    await adapter.populate(ctx, job.input);

    // Fetch and upload evidence files if the adapter uses them.
    const files: Array<{ name: string; buffer: Buffer }> = [];
    for (const [path, url] of Object.entries(job.signed_urls)) {
      const name = path.split("/").pop() ?? "artifact.pdf";
      files.push({ name, buffer: await fetchArtifact(url) });
    }
    await adapter.uploadEvidence(ctx, files);

    const validation = await adapter.validate(ctx);
    await audit("validation_completed", { ok: validation.ok, issues: validation.issues });

    const summary = await adapter.generateReviewSummary(ctx);
    await audit("review_generated", {}, {
      status: "review_ready",
      result: "ok",
      review_summary: summary as unknown as Record<string, unknown>,
      duration_ms: nowMs() - startedAt,
    });
  } catch (e) {
    await audit(
      "error",
      { message: e instanceof Error ? e.message : String(e) },
      { status: "failed", result: "error", error: { message: e instanceof Error ? e.message : String(e) } },
    );
  } finally {
    if (context) await context.close();
  }
}

/**
 * Cancellation-race coverage for runAdapterSteps (services/enforcement-worker
 * defect #2): a job cancelled mid-run must stop before its next Playwright
 * step and must never report `review_ready` after cancellation is detected.
 *
 * Exercises the real production control flow (runAdapterSteps) against a
 * fake adapter and a fake cancellation checker — no real browser/Playwright
 * or network call involved.
 */
import { describe, it, expect, vi } from "vitest";
import { runAdapterSteps } from "./runner.js";
import type { AdapterContext, PlatformAdapter, ValidationReport } from "./adapters/types.js";
import type { FetchedJob } from "./eterna.js";

function fakeJob(overrides: Partial<FetchedJob> = {}): FetchedJob {
  return {
    job_id: "job-1",
    adapter: "youtube_copyright",
    platform: "youtube",
    user_id: "user-1",
    input: {
      enforcement_request_id: "req-1",
      target_url: "https://youtube.com/watch?v=abc",
      evidence_pdf_path: "evidence.pdf",
      authorization_pdf_path: "auth.pdf",
      platform_complaint_pdf_path: null,
      method: "form",
    },
    signed_urls: {},
    credential: {
      id: "cred-1",
      label: "primary",
      storage_state_json: "{}",
      login_email: "user@example.com",
      status: "active",
    },
    ...overrides,
  };
}

function fakeAdapter(order: string[]): PlatformAdapter {
  const validation: ValidationReport = { ok: true, issues: [] };
  return {
    id: "youtube_copyright",
    authenticate: vi.fn(async () => {
      order.push("authenticate");
      return "logged_in" as const;
    }),
    navigateToForm: vi.fn(async () => {
      order.push("navigateToForm");
    }),
    populate: vi.fn(async () => {
      order.push("populate");
    }),
    uploadEvidence: vi.fn(async () => {
      order.push("uploadEvidence");
    }),
    validate: vi.fn(async () => {
      order.push("validate");
      return validation;
    }),
    generateReviewSummary: vi.fn(async () => {
      order.push("generateReviewSummary");
      return {
        client: "user-1",
        original: "orig",
        match: "match",
        evidence: [],
        validation,
        timestamp: new Date().toISOString(),
      };
    }),
  };
}

function fakeCtx(job: FetchedJob): AdapterContext {
  return {
    // Steps under test never touch page/browserContext directly.
    page: {} as AdapterContext["page"],
    browserContext: {} as AdapterContext["browserContext"],
    job,
    audit: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => null),
    fetchArtifact: vi.fn(async () => Buffer.from("")),
  };
}

describe("runAdapterSteps cancellation handling", () => {
  it("runs every step and reports review_ready when never cancelled", async () => {
    const order: string[] = [];
    const job = fakeJob();
    const adapter = fakeAdapter(order);
    const ctx = fakeCtx(job);
    const audit = vi.fn(
      async (
        _event: string,
        _payload?: Record<string, unknown>,
        _extra?: Record<string, unknown>,
      ) => undefined,
    );
    const isCancelled = vi.fn(async () => false);

    await runAdapterSteps({
      adapter,
      ctx,
      job,
      audit,
      isCancelled,
      fetchArtifact: async () => Buffer.from(""),
      startedAt: Date.now(),
    });

    expect(order).toEqual([
      "authenticate",
      "navigateToForm",
      "populate",
      "uploadEvidence",
      "validate",
      "generateReviewSummary",
    ]);
    const statuses = audit.mock.calls.map((c) => (c[2] as { status?: string } | undefined)?.status);
    expect(statuses).toContain("review_ready");
    expect(statuses).not.toContain("cancelled");
  });

  it("stops before navigateToForm when cancelled right after authenticate, and never reports review_ready", async () => {
    const order: string[] = [];
    const job = fakeJob();
    const adapter = fakeAdapter(order);
    const ctx = fakeCtx(job);
    const audit = vi.fn(
      async (
        _event: string,
        _payload?: Record<string, unknown>,
        _extra?: Record<string, unknown>,
      ) => undefined,
    );

    // isCancelled is polled once per checkpoint; the first checkpoint (before
    // authenticate) must pass, the one right after must detect cancellation.
    let calls = 0;
    const isCancelled = vi.fn(async () => {
      calls += 1;
      return calls >= 2;
    });

    await runAdapterSteps({
      adapter,
      ctx,
      job,
      audit,
      isCancelled,
      fetchArtifact: async () => Buffer.from(""),
      startedAt: Date.now(),
    });

    expect(order).toEqual(["authenticate"]);
    expect(adapter.navigateToForm).not.toHaveBeenCalled();
    expect(adapter.uploadEvidence).not.toHaveBeenCalled();
    expect(adapter.generateReviewSummary).not.toHaveBeenCalled();

    const statuses = audit.mock.calls.map((c) => (c[2] as { status?: string } | undefined)?.status);
    expect(statuses).not.toContain("review_ready");
    expect(statuses).toContain("cancelled");
  });

  it("never reports review_ready even when cancellation is only detected at the final checkpoint", async () => {
    const order: string[] = [];
    const job = fakeJob();
    const adapter = fakeAdapter(order);
    const ctx = fakeCtx(job);
    const audit = vi.fn(
      async (
        _event: string,
        _payload?: Record<string, unknown>,
        _extra?: Record<string, unknown>,
      ) => undefined,
    );

    // Every step completes (including generateReviewSummary) before the
    // final pre-report checkpoint (the 7th and last checkpoint call) detects
    // cancellation.
    let calls = 0;
    const isCancelled = vi.fn(async () => {
      calls += 1;
      return calls === 7;
    });

    await runAdapterSteps({
      adapter,
      ctx,
      job,
      audit,
      isCancelled,
      fetchArtifact: async () => Buffer.from(""),
      startedAt: Date.now(),
    });

    expect(order).toEqual([
      "authenticate",
      "navigateToForm",
      "populate",
      "uploadEvidence",
      "validate",
      "generateReviewSummary",
    ]);

    const statuses = audit.mock.calls.map((c) => (c[2] as { status?: string } | undefined)?.status);
    expect(statuses).not.toContain("review_ready");
    expect(statuses).toContain("cancelled");
  });

  it("fails open (keeps running) when the cancellation check itself errors", async () => {
    const order: string[] = [];
    const job = fakeJob();
    const adapter = fakeAdapter(order);
    const ctx = fakeCtx(job);
    const audit = vi.fn(
      async (
        _event: string,
        _payload?: Record<string, unknown>,
        _extra?: Record<string, unknown>,
      ) => undefined,
    );
    const isCancelled = vi.fn(async () => {
      throw new Error("network blip");
    });

    await runAdapterSteps({
      adapter,
      ctx,
      job,
      audit,
      isCancelled,
      fetchArtifact: async () => Buffer.from(""),
      startedAt: Date.now(),
    });

    expect(order).toEqual([
      "authenticate",
      "navigateToForm",
      "populate",
      "uploadEvidence",
      "validate",
      "generateReviewSummary",
    ]);
    const statuses = audit.mock.calls.map((c) => (c[2] as { status?: string } | undefined)?.status);
    expect(statuses).toContain("review_ready");
  });
});

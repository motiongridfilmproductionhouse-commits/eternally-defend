/**
 * YouTube enforcement adapters — Batch 1 scaffold.
 *
 * Selectors and copy will be filled in Batch 2. This file establishes the
 * field-mapping contract so Eterna's side can be reviewed independently.
 *
 * Batch 2 will:
 *  - Wire the real `youtube.com/copyright_complaint_form` selectors from
 *    `selectors/youtube.json` (config-driven so ToS-safe UI updates don't
 *    need code changes).
 *  - Implement the in-player Report menu flow for community guideline reports.
 *  - Never call submit(): the adapters stop at the Review screen and post the
 *    ReviewSummary back to Eterna for a human operator to click Submit.
 */
import type { AdapterContext, PlatformAdapter, ReviewSummary, ValidationReport } from "./types.js";
import type { FetchedJob } from "../eterna.js";

function reviewFromContext(job: FetchedJob, validation: ValidationReport): ReviewSummary {
  const evidence = Object.keys(job.signed_urls).map((p) => p.split("/").pop() ?? p);
  return {
    client: job.user_id,
    original: job.input.target_url ?? "(no target)",
    match: job.input.target_url ?? "(no target)",
    evidence,
    validation,
    timestamp: new Date().toISOString(),
  };
}

export const YouTubeCopyrightAdapter: PlatformAdapter = {
  id: "youtube_copyright",
  async authenticate(ctx) {
    await ctx.page.goto("https://www.youtube.com", { waitUntil: "domcontentloaded" });
    // Placeholder: real login detection lands in Batch 2.
    return ctx.job.credential?.storage_state_json ? "logged_in" : "login_required";
  },
  async navigateToForm(ctx) {
    await ctx.page.goto("https://www.youtube.com/copyright_complaint_form", { waitUntil: "domcontentloaded" });
    await ctx.audit("form_opened", { url: ctx.page.url() });
  },
  async populate(ctx, _caseData) {
    await ctx.audit("client_data_loaded", { adapter: "youtube_copyright" });
    // Field mapping — implemented in Batch 2.
  },
  async uploadEvidence(ctx, files) {
    await ctx.audit("evidence_uploaded", { count: files.length });
  },
  async validate(_ctx): Promise<ValidationReport> {
    // Batch 2: verify required fields on the rendered form.
    return { ok: false, issues: ["Batch 2 will populate this adapter"] };
  },
  async generateReviewSummary(ctx) {
    const validation = await this.validate(ctx);
    return reviewFromContext(ctx.job, validation);
  },
  // No submit(): official YouTube copyright submission requires human review.
};

export const YouTubeCommunityAdapter: PlatformAdapter = {
  id: "youtube_community",
  async authenticate(ctx) {
    await ctx.page.goto("https://www.youtube.com", { waitUntil: "domcontentloaded" });
    return ctx.job.credential?.storage_state_json ? "logged_in" : "login_required";
  },
  async navigateToForm(ctx) {
    const url = ctx.job.input.target_url;
    if (!url) throw new Error("Community report requires a target_url");
    await ctx.page.goto(url, { waitUntil: "domcontentloaded" });
    await ctx.audit("form_opened", { url });
  },
  async populate(ctx, _caseData) {
    await ctx.audit("client_data_loaded", { adapter: "youtube_community" });
  },
  async uploadEvidence(_ctx, _files) {
    // Community reports don't accept file attachments — no-op by design.
  },
  async validate(_ctx): Promise<ValidationReport> {
    return { ok: false, issues: ["Batch 2 will populate this adapter"] };
  },
  async generateReviewSummary(ctx) {
    const validation = await this.validate(ctx);
    return reviewFromContext(ctx.job, validation);
  },
};

export const adaptersById = {
  youtube_copyright: YouTubeCopyrightAdapter,
  youtube_community: YouTubeCommunityAdapter,
} as const;

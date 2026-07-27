import type { BrowserContext, Page } from "playwright";
import type { FetchedJob } from "../eterna.js";

export interface AdapterContext {
  page: Page;
  browserContext: BrowserContext;
  job: FetchedJob;
  audit: (event: string, payload?: Record<string, unknown>) => Promise<void>;
  screenshot: (label: string) => Promise<string | null>;
  fetchArtifact: (signedUrl: string) => Promise<Buffer>;
}

export interface ValidationReport {
  ok: boolean;
  issues: string[];
}

export interface ReviewSummary {
  client: string;
  original: string;
  match: string;
  evidence: string[];
  validation: ValidationReport;
  timestamp: string;
}

export interface PlatformAdapter {
  readonly id: "youtube_copyright" | "youtube_community";
  authenticate(ctx: AdapterContext): Promise<"logged_in" | "login_required">;
  navigateToForm(ctx: AdapterContext): Promise<void>;
  populate(ctx: AdapterContext, caseData: FetchedJob["input"]): Promise<void>;
  uploadEvidence(ctx: AdapterContext, files: Array<{ name: string; buffer: Buffer }>): Promise<void>;
  validate(ctx: AdapterContext): Promise<ValidationReport>;
  generateReviewSummary(ctx: AdapterContext): Promise<ReviewSummary>;
  /** Only implemented for API-backed flows. Web forms return `unsupported`. */
  submit?(ctx: AdapterContext): Promise<"submitted" | "unsupported">;
}

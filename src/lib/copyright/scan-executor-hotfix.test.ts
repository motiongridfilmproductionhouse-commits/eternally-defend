/**
 * Regression tests for Copyright Intelligence scan executor lifecycle.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  decideCopyrightTerminalStatus,
  isExecutorWatchdogExpired,
  isImmediateStartResponse,
  markStage,
  EXECUTOR_START_WATCHDOG_MS,
} from "./scan-lifecycle";
import { summarizeProviderFailures } from "./scan-diagnostics";
import {
  classifyProviderFailure,
  emptyProviderFailureCounts,
  sanitizeProviderFailureDetail,
} from "./provider-failures";
import {
  scopedScanMatches,
  PREVIOUSLY_MONITORED_SOURCES_LABEL,
} from "./scan-scope";
import { isStaleOfficialMonitoredSource } from "./stale-official.server";
import { classifyCopyrightPage } from "./page-classify.server";
import { evaluateTelegramPublicEvidence } from "./telegram-evidence";

const FUNCTIONS_PATH = resolve(process.cwd(), "src/lib/copyright.functions.ts");
const UI_PATH = resolve(process.cwd(), "src/routes/_app.copyright-intel.tsx");
const WORKER_AUTH_PATH = resolve(process.cwd(), "src/lib/copyright/worker-auth.server.ts");
const DISPATCH_PATH = resolve(process.cwd(), "src/lib/copyright/scan-worker-dispatch.server.ts");
const MONITOR_PATH = resolve(
  process.cwd(),
  "src/components/copyright/DistributionMonitorPanel.tsx",
);

function functionsSource(): string {
  return readFileSync(FUNCTIONS_PATH, "utf8");
}
function uiSource(): string {
  return readFileSync(UI_PATH, "utf8");
}

test("backend dispatches executor after scan row creation", () => {
  const src = functionsSource();
  const ui = uiSource();
  assert.match(src, /export const runCopyrightScan/);
  assert.match(src, /export const executeCopyrightScan/);
  assert.match(src, /dispatchCopyrightScanExecution\(scan\.id as string\)/);
  assert.match(src, /resolveCopyrightScanWorkerUrl/);
  assert.match(readFileSync(DISPATCH_PATH, "utf8"), /COPYRIGHT_SCAN_WORKER_URL/);
  assert.match(readFileSync(WORKER_AUTH_PATH, "utf8"), /COPYRIGHT_SCAN_WORKER_SECRET/);
  assert.doesNotMatch(ui, /executeCopyrightScan/);
  assert.doesNotMatch(ui, /executeScan\.mutate\(res\.scanId\)/);
  assert.match(ui, /runFn\(/);

  const runStart = src.indexOf("export const runCopyrightScan");
  const executeStart = src.indexOf("export const executeCopyrightScan");
  assert.ok(executeStart > runStart);
  const runBlock = src.slice(runStart, executeStart);
  assert.match(runBlock, /started: true/);
  assert.match(runBlock, /status: "queued"/);
  assert.doesNotMatch(runBlock, /firecrawlDiscover/);
  assert.doesNotMatch(runBlock, /status: "completed"/);
});

test("immediate scan ID does not mean immediate completion", () => {
  assert.equal(
    isImmediateStartResponse({
      scanId: "scan-1",
      started: true,
      status: "queued",
      stats: null,
    }),
    true,
  );
  assert.equal(
    isImmediateStartResponse({
      scanId: "scan-1",
      started: true,
      status: "completed",
      stats: { matches: 0, candidates: 0 },
    }),
    false,
  );
  const ui = uiSource();
  assert.match(ui, /does NOT mean discovery completed|Immediate scan ID/i);
  assert.match(ui, /setSummary\(null\)/);
});

test("executor failure cannot become completed", () => {
  const failed = decideCopyrightTerminalStatus({
    executorStarted: true,
    queriesGenerated: 0,
    queriesExecuted: 0,
    providerSuccesses: 0,
    providerFailures: 1,
    providerCandidates: 0,
    pagesCrawled: 0,
    clientVisibleFindings: 0,
    fatalReason: "Firecrawl missing",
  });
  assert.equal(failed.status, "failed");
  assert.notEqual(failed.status, "completed");

  const neverStarted = decideCopyrightTerminalStatus({
    executorStarted: false,
    queriesGenerated: 0,
    queriesExecuted: 0,
    providerSuccesses: 0,
    providerFailures: 0,
    providerCandidates: 0,
    pagesCrawled: 0,
    clientVisibleFindings: 0,
  });
  assert.equal(neverStarted.status, "failed");
  assert.match(neverStarted.reason ?? "", /executor never started/i);

  const src = functionsSource();
  assert.match(src, /decideCopyrightTerminalStatus/);
  assert.match(src, /status: "failed"/);
  // Catch path must return failed, not completed.
  assert.match(src, /Persist real failure/);
});

test("zero providers executed becomes failed", () => {
  const out = decideCopyrightTerminalStatus({
    executorStarted: true,
    queriesGenerated: 12,
    queriesExecuted: 12,
    providerSuccesses: 0,
    providerFailures: 12,
    providerCandidates: 0,
    knownUrlsAttempted: 0,
    pagesCrawled: 0,
    clientVisibleFindings: 0,
  });
  assert.equal(out.status, "failed");
  assert.match(out.reason ?? "", /provider/i);
});

test("successful search with genuinely zero candidates may complete", () => {
  const out = decideCopyrightTerminalStatus({
    executorStarted: true,
    queriesGenerated: 20,
    queriesExecuted: 20,
    providerSuccesses: 8,
    providerFailures: 0,
    providerCandidates: 0,
    pagesCrawled: 0,
    clientVisibleFindings: 0,
  });
  assert.equal(out.status, "completed");
  assert.equal(out.reason, null);
});

test("provider error isolation categories", () => {
  assert.equal(classifyProviderFailure({ configured: false }), "missing_api_key");
  assert.equal(classifyProviderFailure({ status: 401 }), "authentication_failed");
  assert.equal(classifyProviderFailure({ status: 429 }), "rate_limited");
  assert.equal(classifyProviderFailure({ status: 504 }), "timeout");
  assert.equal(classifyProviderFailure({ status: 503 }), "provider_unavailable");
  assert.equal(
    classifyProviderFailure({ error: new Error("Unexpected token < in JSON") }),
    "malformed_response",
  );
  const counts = emptyProviderFailureCounts();
  assert.equal(counts.executor_not_started, 0);
  assert.equal(
    sanitizeProviderFailureDetail("Bearer fc-SECRET123 and lovc_ABC"),
    "Bearer [redacted] and [redacted-key]",
  );
});

test("summarizeProviderFailures formats category breakdown", () => {
  assert.equal(
    summarizeProviderFailures({
      provider_failures_by_category: { rate_limited: 30, authentication_failed: 5 },
    }),
    "rate_limited: 30, authentication_failed: 5",
  );
  assert.equal(summarizeProviderFailures({}), null);
});

test("copyright discovery batches Firecrawl searches", () => {
  const src = readFileSync(
    resolve(process.cwd(), "src/lib/copyright/discover.server.ts"),
    "utf8",
  );
  assert.match(src, /runBatchedDiscovery/);
  assert.match(src, /FIRECRAWL_MAX_RETRIES/);
  assert.doesNotMatch(src, /DISCOVERY_SEARCH_MAX_ATTEMPTS/);
});

test("selected scan never shows another movie’s findings", () => {
  const spider = [{ id: "1", page_title: "Spider-Man" }];
  assert.deepEqual(
    scopedScanMatches("pluto-scan", { scan: { id: "spider-scan" }, matches: spider }),
    [],
  );
  assert.deepEqual(
    scopedScanMatches("pluto-scan", {
      scan: { id: "pluto-scan" },
      matches: [{ id: "2", page_title: "Pluto" }],
    }),
    [{ id: "2", page_title: "Pluto" }],
  );
});

test("deactivated YouTube/Plex absent from active monitor", () => {
  assert.equal(
    isStaleOfficialMonitoredSource({
      url: "https://www.youtube.com/watch?v=x",
      domain: "youtube.com",
    }),
    true,
  );
  assert.equal(
    isStaleOfficialMonitoredSource({
      url: "https://watch.plex.tv/movie/x",
      domain: "watch.plex.tv",
    }),
    true,
  );
  const monitor = readFileSync(MONITOR_PATH, "utf8");
  assert.match(monitor, /PREVIOUSLY_MONITORED_SOURCES_LABEL/);
  assert.match(monitor, /status !== "deactivated"/);
  assert.doesNotMatch(monitor, /showDeactivated/);
  assert.equal(PREVIOUSLY_MONITORED_SOURCES_LABEL, "Previously monitored sources");
});

test("public Telegram failure isolation", () => {
  const privateFail = evaluateTelegramPublicEvidence({
    url: "https://t.me/joinchat/SECRET",
    pageTitle: "Pluto full movie",
    markdown: "download",
    titles: ["Pluto"],
  });
  assert.equal(privateFail.eligible, false);

  const src = readFileSync(
    resolve(process.cwd(), "src/lib/copyright/discover.server.ts"),
    "utf8",
  );
  assert.match(src, /telegramFailures/);
  assert.match(src, /telegramPlans/);
  // Telegram failures must not throw / abort web discovery path.
  assert.match(src, /if \(isTelegramQuery\) telegramFailures \+= 1/);
});

test("exact-title and exact-page evidence gates remain unchanged", () => {
  const long = (s: string) =>
    `${s} ${"Additional page body confirming this is a full crawled article page with enough text for exact-page evidence. ".repeat(3)}`;
  const ok = classifyCopyrightPage({
    url: "https://streamexample.test/watch/pluto",
    pageTitle: "Pluto Malayalam Full Movie",
    markdown: long("Watch full movie Pluto malayalam online free. Streaming server 1."),
    html: '<iframe src="https://doodstream.com/e/abc"></iframe>',
    links: ["https://doodstream.com/e/abc"],
    titles: ["pluto malayalam movie", "Pluto"],
    pageInspected: true,
  });
  assert.equal(ok.clientVisible, true);

  const posterOnly = classifyCopyrightPage({
    url: "https://fanblog.example/pluto-poster",
    pageTitle: "Pluto poster",
    markdown: long("Pluto malayalam movie poster gallery wallpaper."),
    html: "<img src='/p.jpg'/>",
    links: [],
    titles: ["pluto malayalam movie"],
    pageInspected: true,
  });
  assert.equal(posterOnly.clientVisible, false);
});

test("executor watchdog fails scans stuck without executor_started_at", () => {
  const created = new Date(Date.now() - EXECUTOR_START_WATCHDOG_MS - 1000).toISOString();
  assert.equal(
    isExecutorWatchdogExpired({
      status: "queued",
      createdAt: created,
      executorStartedAt: null,
    }),
    true,
  );
  assert.equal(
    isExecutorWatchdogExpired({
      status: "running",
      createdAt: created,
      executorStartedAt: null,
    }),
    true,
  );
  assert.equal(
    isExecutorWatchdogExpired({
      status: "running",
      createdAt: created,
      executorStartedAt: new Date().toISOString(),
    }),
    false,
  );
  const stages = markStage({}, "scan_created");
  assert.ok(stages.scan_created);
  assert.ok(stages.last_progress_at);
});

test("executor claims queued scans atomically and duplicate invocation does not rerun", () => {
  const src = functionsSource();
  const claimStart = src.indexOf("export async function executeCopyrightScanById");
  assert.ok(claimStart >= 0);
  const claimBlock = src.slice(claimStart, src.indexOf("const priorStats", claimStart));
  assert.match(claimBlock, /\.update\(\{ status: "running" \}\)/);
  assert.match(claimBlock, /\.eq\("status", "queued"\)/);
  assert.match(claimBlock, /\.select\("\*"\)/);
  assert.match(claimBlock, /if \(!claimedScan\)/);
  assert.match(claimBlock, /return \{\s*scanId: existing\.id as string,\s*status: existing\.status,/s);
});

test("terminal updates require exactly one active row or idempotent same terminal state", () => {
  const src = functionsSource();
  const terminalStart = src.indexOf("async function updateTerminalScanRow");
  assert.ok(terminalStart >= 0);
  const terminalBlock = src.slice(
    terminalStart,
    src.indexOf("export async function writeCopyrightTerminalStatus", terminalStart),
  );
  assert.match(terminalBlock, /\.in\("status", \[\.\.\.ACTIVE_COPYRIGHT_SCAN_STATUSES\]\)/);
  assert.match(terminalBlock, /\.select\("id,status"\)/);
  assert.match(terminalBlock, /\.maybeSingle\(\)/);
  assert.match(terminalBlock, /if \(data\?\.id === scanId\) return/);
  assert.match(terminalBlock, /inspectCopyrightScanTerminalState\(supabase, scanId, update\.status\)/);

  const inspectBlock = src.slice(
    src.indexOf("async function inspectCopyrightScanTerminalState"),
    terminalStart,
  );
  assert.match(inspectBlock, /if \(!data\)/);
  assert.match(inspectBlock, /data\.status === intendedStatus/);
  assert.match(inspectBlock, /terminal_state_conflict/);
});

test("terminal status transient failures retry and permanent failures surface", () => {
  const src = functionsSource();
  const writerStart = src.indexOf("export async function writeCopyrightTerminalStatus");
  const writerBlock = src.slice(writerStart, src.indexOf("async function dispatchCopyrightScanExecution", writerStart));
  assert.match(writerBlock, /TERMINAL_STATUS_RETRY_DELAYS_MS/);
  assert.match(writerBlock, /console\.error\("copyright_scan_terminal_update_failed"/);
  assert.match(writerBlock, /copyright_scan_terminal_fallback_failed/);
  assert.match(writerBlock, /throw lastError instanceof Error/);
});

test("stale recovery uses guarded terminal transition", () => {
  const src = functionsSource();
  const watchdogStart = src.indexOf("async function applyExecutorWatchdog");
  const watchdogBlock = src.slice(watchdogStart, src.indexOf("export const listCopyrightScans", watchdogStart));
  assert.match(watchdogBlock, /isExecutorWatchdogExpired/);
  assert.match(watchdogBlock, /writeCopyrightTerminalStatus\(supabase, row\.id as string/);
  assert.doesNotMatch(watchdogBlock, /\.update\(\{\s*status: "failed"/);
});

test("partial status when deadline cuts after crawl progress", () => {
  const out = decideCopyrightTerminalStatus({
    executorStarted: true,
    queriesGenerated: 10,
    queriesExecuted: 10,
    providerSuccesses: 4,
    providerFailures: 0,
    providerCandidates: 8,
    pagesCrawled: 3,
    clientVisibleFindings: 1,
    abortedByDeadline: true,
  });
  assert.equal(out.status, "partial");
});

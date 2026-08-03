import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterScanHistory,
  isScanStalled,
  isTerminalScanStatus,
  isVisibleScanHistoryStatus,
  pickLiveScanId,
  scanPollInterval,
  scanProgressSignature,
  shouldShowResultsLoader,
} from "./scan-ui-state";

test("results render while status is running (no loader gate)", () => {
  assert.equal(shouldShowResultsLoader({ isLoading: true, hasScan: true }), false);
  assert.equal(shouldShowResultsLoader({ isLoading: true, hasScan: false }), true);
  assert.equal(shouldShowResultsLoader({ isLoading: false, hasScan: true }), false);
});

test("polling keeps refreshing while running and while a request is in flight", () => {
  assert.equal(scanPollInterval({ status: "running", requestPending: false }), 3_000);
  assert.equal(scanPollInterval({ status: null, requestPending: true }), 3_000);
  assert.equal(scanPollInterval({ status: "completed", requestPending: true }), false);
  assert.equal(
    scanPollInterval({
      status: "completed",
      requestPending: false,
      googleImagesBackgroundRunning: true,
    }),
    3_000,
  );
});

test("partial results stay visible and polling stops on terminal status", () => {
  assert.equal(isTerminalScanStatus("partial"), true);
  assert.equal(isTerminalScanStatus("failed"), true);
  assert.equal(isTerminalScanStatus("completed"), true);
  assert.equal(isTerminalScanStatus("running"), false);
  assert.equal(scanPollInterval({ status: "partial", requestPending: false }), false);
});

test("in-flight scan auto-selects its own running row, never an older scan", () => {
  const scans = [
    { id: "new", status: "running", target_name: "Ada Lovelace" },
    { id: "old", status: "completed", target_name: "Ada Lovelace" },
    { id: "other", status: "running", target_name: "Someone Else" },
  ];
  assert.equal(
    pickLiveScanId({ scans, targetName: " ada lovelace ", selectedScanId: null, requestPending: true }),
    "new",
  );
  assert.equal(
    pickLiveScanId({ scans, targetName: "Ada Lovelace", selectedScanId: "old", requestPending: true }),
    null,
  );
  assert.equal(
    pickLiveScanId({ scans, targetName: "Ada Lovelace", selectedScanId: null, requestPending: false }),
    null,
  );
});

test("continue resumes the same scan id", () => {
  const scans = [{ id: "scan-1", status: "running", target_name: "Ada" }];
  assert.equal(
    pickLiveScanId({ scans, targetName: "Ada", selectedScanId: null, requestPending: true }),
    "scan-1",
  );
});

test("stall warning fires only after 15s without progress while running", () => {
  const base = 1_000_000;
  assert.equal(isScanStalled({ status: "running", lastChangeAt: base, now: base + 14_000 }), false);
  assert.equal(isScanStalled({ status: "running", lastChangeAt: base, now: base + 15_000 }), true);
  assert.equal(isScanStalled({ status: "partial", lastChangeAt: base, now: base + 60_000 }), false);
});

test("progress signature changes when metrics or findings change", () => {
  const a = scanProgressSignature({ status: "running", metrics: { verified: 1 }, findingCount: 0, discoveryCount: 3 });
  const b = scanProgressSignature({ status: "running", metrics: { verified: 2 }, findingCount: 0, discoveryCount: 3 });
  const c = scanProgressSignature({ status: "running", metrics: { verified: 2 }, findingCount: 1, discoveryCount: 3 });
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.equal(a, scanProgressSignature({ status: "running", metrics: { verified: 1 }, findingCount: 0, discoveryCount: 3 }));
});

test("scan history hides failed scans and keeps partial/completed/running", () => {
  assert.equal(isVisibleScanHistoryStatus("failed"), false);
  assert.equal(isVisibleScanHistoryStatus("partial"), true);
  assert.equal(isVisibleScanHistoryStatus("completed"), true);
  assert.equal(isVisibleScanHistoryStatus("running"), true);

  const visible = filterScanHistory([
    { id: "1", status: "partial" },
    { id: "2", status: "failed" },
    { id: "3", status: "failed" },
    { id: "4", status: "completed" },
    { id: "5", status: "running" },
  ]);

  assert.deepEqual(
    visible.map((scan) => scan.id),
    ["1", "4", "5"],
  );
});

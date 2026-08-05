import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUSINESS_SCAN_PUBLIC_COLUMNS } from "../business-reputation.functions";

const functionsSource = readFileSync(
  resolve(process.cwd(), "src/lib/business-reputation.functions.ts"),
  "utf8",
);
const hookSource = readFileSync(
  resolve(process.cwd(), "src/routes/api/public/hooks/business-reputation-scan-execute.ts"),
  "utf8",
);

test("polling response omits scan run tokens and worker secrets", () => {
  assert.equal(BUSINESS_SCAN_PUBLIC_COLUMNS.includes("scan_run_token"), false);
  assert.equal(BUSINESS_SCAN_PUBLIC_COLUMNS.includes("worker_secret"), false);
  assert.match(functionsSource, /eq\("user_id", context\.userId\)/);
  assert.match(functionsSource, /eq\("scan_type", "business_reputation"\)/);
});
test("polling reads findings scoped to the owner and scan", () => {
  assert.match(functionsSource, /\.from\("scan_hits"\)/);
  assert.match(functionsSource, /\.eq\("scan_id", data\.scanId\)/);
  assert.match(functionsSource, /\.eq\("user_id", context\.userId\)/);
});
test("worker execution failures use customer-safe error text", () => {
  assert.match(hookSource, /Business Reputation worker failed\. Please try again/);
  assert.doesNotMatch(hookSource, /error\.message\.slice\(0, 500\)/);
});
test("hook payload requires scan identity and run token", () => {
  assert.match(hookSource, /scan_id: z\.string\(\)\.uuid\(\)/);
  assert.match(hookSource, /scan_run_token: z\.string\(\)\.uuid\(\)/);
});

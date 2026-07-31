import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildVerifiedEvidenceLink,
  isAllowedHttpUrl,
  projectClientEvidenceUrls,
  resolveVerifiedEvidenceHref,
  sanitizeEvidenceUrl,
} from "./evidence-url";

test("verified URL is clickable and opens the final URL", () => {
  const link = buildVerifiedEvidenceLink({
    final_url: "https://abuse.example/watch/honey-rose-deepfake",
    canonical_url: "https://abuse.example/watch/honey-rose-deepfake?utm=1",
    url_verification_status: "URL_VERIFIED",
    verified_domain: "abuse.example",
  });

  assert.equal(link.kind, "link");
  assert.equal(link.clickable, true);
  if (link.kind !== "link") return;

  assert.equal(link.href, "https://abuse.example/watch/honey-rose-deepfake");
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
  assert.equal(link.label, "Open verified evidence page");
  assert.equal(link.domain, "abuse.example");
});

test("falls back to canonical_url when final_url is missing", () => {
  const href = resolveVerifiedEvidenceHref({
    final_url: null,
    canonical_url: "https://cdn.example/page/verified-evidence",
    url_verification_status: "URL_VERIFIED",
  });

  assert.equal(href, "https://cdn.example/page/verified-evidence");

  const link = buildVerifiedEvidenceLink({
    final_url: "   ",
    canonical_url: "https://cdn.example/page/verified-evidence",
    url_verification_status: "URL_VERIFIED",
  });
  assert.equal(link.kind, "link");
  if (link.kind === "link") {
    assert.equal(link.href, "https://cdn.example/page/verified-evidence");
    assert.equal(link.domain, "cdn.example");
  }
});

test("rejected or missing URL is not clickable", () => {
  const rejected = buildVerifiedEvidenceLink({
    final_url: "https://abuse.example/x",
    canonical_url: "https://abuse.example/x",
    url_verification_status: "URL_REJECTED",
  });
  assert.equal(rejected.kind, "unavailable");
  assert.equal(rejected.clickable, false);
  assert.equal(rejected.href, null);
  assert.equal(rejected.message, "Evidence URL unavailable.");

  const missing = buildVerifiedEvidenceLink({
    final_url: null,
    canonical_url: undefined,
    url_verification_status: "URL_VERIFIED",
  });
  assert.equal(missing.kind, "unavailable");
  assert.equal(missing.clickable, false);
  assert.equal(missing.href, null);

  const empty = buildVerifiedEvidenceLink({
    final_url: "",
    canonical_url: "  ",
    url_verification_status: "URL_VERIFIED",
  });
  assert.equal(empty.kind, "unavailable");
  assert.equal(empty.clickable, false);
});

test("javascript and data URLs are blocked", () => {
  assert.equal(isAllowedHttpUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedHttpUrl("data:text/html,<h1>x</h1>"), false);
  assert.equal(sanitizeEvidenceUrl("javascript:void(0)"), null);
  assert.equal(sanitizeEvidenceUrl("data:image/png;base64,abc"), null);

  assert.equal(
    resolveVerifiedEvidenceHref({
      final_url: "javascript:alert(1)",
      canonical_url: "https://safe.example/page",
      url_verification_status: "URL_VERIFIED",
    }),
    "https://safe.example/page",
  );

  assert.equal(
    resolveVerifiedEvidenceHref({
      final_url: "javascript:alert(1)",
      canonical_url: "data:text/html,hi",
      url_verification_status: "URL_VERIFIED",
    }),
    null,
  );

  const blocked = buildVerifiedEvidenceLink({
    final_url: "javascript:alert(1)",
    canonical_url: "data:text/html,hi",
    url_verification_status: "URL_VERIFIED",
  });
  assert.equal(blocked.kind, "unavailable");
  assert.equal(blocked.clickable, false);
});

test("projectClientEvidenceUrls returns sanitized final_url and canonical_url", () => {
  const projected = projectClientEvidenceUrls({
    scan_id: "s1",
    url: "https://discovered.example/old",
    final_url: "https://abuse.example/final",
    canonical_url: "https://abuse.example/final",
    url_verification_status: "URL_VERIFIED",
  });

  assert.equal(projected.final_url, "https://abuse.example/final");
  assert.equal(projected.canonical_url, "https://abuse.example/final");
  assert.equal(projected.url, "https://abuse.example/final");

  const unsafe = projectClientEvidenceUrls({
    scan_id: "s1",
    url: "https://discovered.example/old",
    final_url: "javascript:alert(1)",
    canonical_url: "https://abuse.example/canonical",
    url_verification_status: "URL_VERIFIED",
  });
  assert.equal(unsafe.final_url, null);
  assert.equal(unsafe.canonical_url, "https://abuse.example/canonical");
  assert.equal(unsafe.url, "https://abuse.example/canonical");
});

test("never uses plain url field when final and canonical are invalid", () => {
  const href = resolveVerifiedEvidenceHref({
    final_url: null,
    canonical_url: null,
    url: "https://should-not-be-used.example/page",
    url_verification_status: "URL_VERIFIED",
  });
  assert.equal(href, null);
});

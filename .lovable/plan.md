# Apify Instagram Intelligence Integration

## Goal
Add Apify’s official Instagram Scraper to Eterna Web Scan so authenticated scans can discover public Instagram posts and reels safely. The pasted `npx mcp-remote` desktop configuration will not be stored or executed by the published app; the already-linked Apify connection will be called securely from Eterna’s server.

## Implementation
1. **Server-only Apify adapter**
   - Add a focused Instagram discovery module using the linked Apify connection through Lovable’s secure connector gateway.
   - Read credentials only at request time on the server.
   - Start the official `apify/instagram-scraper` Actor asynchronously, poll at a slow bounded interval, stop at terminal status, and read only that run’s dataset.
   - Enforce a strict timeout, result cap, recent-content window, and no automatic retries for permanent 4xx failures.

2. **Target-safe Instagram discovery**
   - Prefer verified Instagram handles already saved in protected assets or the protection profile.
   - Scrape a bounded set of public posts/reels from those profile URLs.
   - If no verified handle exists, perform one bounded profile search using the protected name, but treat returned accounts and media as identity leads rather than confirmed matches.
   - Never convert a name-only or profession-plus-generic-context result into `MATCHED`; ambiguous items remain `NEEDS_IDENTITY_REVIEW` and are excluded from risk/removal totals.

3. **Normalize into the existing scan pipeline**
   - Convert Actor records into the existing raw discovery format with canonical Instagram URLs, captions, author/handle, timestamps, thumbnails, media type, and immutable provider provenance.
   - Merge and deduplicate Apify results alongside existing Instagram discovery before extraction and persistence.
   - Keep discovery, identity verification, risk analysis, evidence, and enforcement boundaries unchanged. Apify results never trigger takedowns automatically.

4. **Coverage and failure reporting**
   - Mark Instagram as queried only when an actual Apify or existing direct Instagram request was made.
   - Report unavailable, timed-out, failed, zero-result, and successful coverage truthfully.
   - Do not show provider internals or connector names in client-facing scan text.
   - Preserve zero results as a valid outcome and keep stored counts equal to persisted records.

5. **Tests and safeguards**
   - Unit-test input construction, gateway errors, timeout/terminal polling, normalization, canonical URL deduplication, and media metadata.
   - Add identity regressions for common names and unrelated posts so they remain pending identity review.
   - Test that Apify failures degrade only Instagram coverage and do not fail the full Web Scan.
   - Verify that connector credentials never reach browser bundles or logs.

6. **Validation**
   - Run the focused scan and identity test suites.
   - Confirm the preview build is clean.
   - Run an authenticated Instagram scan with a known protected handle and verify findings, zero-result behavior, coverage labels, and persisted counts through the results screen.

## Technical notes
- Actor: `apify/instagram-scraper`.
- Transport: linked gateway-backed Apify connection, not a hardcoded API token and not a desktop MCP child process.
- Existing Instagram discovery can remain as a secondary bounded source; deduplication prevents duplicate findings.
- No scheduled scans will be enabled. The integration runs only when an existing manual or explicitly invoked scan requests Instagram.

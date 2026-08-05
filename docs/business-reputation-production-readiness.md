# Business Reputation Production Readiness

## Required environment variables

- `BUSINESS_REPUTATION_SCAN_WORKER_URL`: signed Business worker execution endpoint.
- `BUSINESS_REPUTATION_SCAN_WORKER_BASE_URL` or `SITE_URL`: fallback application base URL.
- `COPYRIGHT_SCAN_WORKER_SECRET`: existing shared HMAC secret used by the isolated Business hooks and dispatch path.
- `BUSINESS_REPUTATION_STALE_RECOVERY_GRACE_MS`: optional grace period, minimum `5000`, default `30000`.
- `YOUTUBE_API_KEY` or `GOOGLE_API_KEY`: YouTube discovery.
- Firecrawl credentials required by `firecrawl-client.server`.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: service-role worker persistence.
- WHOIS is resolved through the existing `whoiser` provider; RDAP, DNS, HTTP/CDN, contact, and public IP intelligence are best-effort lookups.
- Optional evidence storage configuration used by the existing evidence vault for screenshots and transcripts.

## Scheduler deployment

Deploy the Business-only recovery worker with:

```sh
wrangler deploy --config wrangler.business-reputation-recovery.toml
wrangler secret put COPYRIGHT_SCAN_WORKER_SECRET --config wrangler.business-reputation-recovery.toml
```

The scheduler runs every five minutes. It signs `{ "sweep": true }` and calls `/api/public/hooks/business-reputation-scan-recover`. Recovery is idempotent because lease reclamation uses the current token and running status in a compare-and-set update. Set `BUSINESS_REPUTATION_STALE_RECOVERY_GRACE_MS` on the application deployment to tune the grace period.

## Release checklist

- [ ] Supabase migration `20260805150000_business_reputation_dedicated_storage.sql` applied.
- [ ] Recovery scheduler deployed and enabled.
- [ ] Business worker URL configured.
- [ ] HMAC worker secret configured in the application and scheduler.
- [ ] Google Places connected and selected profiles confirmed.
- [ ] Firecrawl connected.
- [ ] YouTube API configured.
- [ ] Public RDAP/DNS/IP intelligence reachable, plus optional WHOIS provider configured.
- [ ] Evidence storage bucket configured for screenshots and evidence references.
- [ ] RLS verified with two real test users.
- [ ] Long-running continuation tested in the deployed runtime.
- [ ] Stale lease recovery tested with an expired lease and stopped heartbeat.
- [ ] Partial provider failure tested.
- [ ] Duplicate prevention tested across rescans and provider URL variants.

## Operational guarantees

Business findings are persisted in dedicated owner-scoped tables. `scan_hits` is retained as a compatibility mirror for existing shared screens. Draft reporting routes are never submitted automatically. Infrastructure fields remain null with an unavailable status when public lookup does not provide a value.

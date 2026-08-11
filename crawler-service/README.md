# Eterna Crawler Service (Crawl4AI)

The Web Scan / Copyright Intelligence extraction layer calls this service through
`CRAWLER_SERVICE_URL`. Without it, `isCrawl4AiConfigured()` is `false` and the
pipeline silently falls back to plain HTTP fetch (reported separately as
`FETCH_FALLBACK_USED`, never counted as a Crawl4AI success).

## Contract Eterna expects

| Item | Value |
| --- | --- |
| `CRAWLER_SERVICE_URL` | Origin only, no path, no trailing slash — e.g. `https://crawler.eterna.example` |
| Extraction endpoint | `GET {base}/crawl?url=<absolute-url>` |
| Request body | none (URL is a query parameter); header `accept: application/json` |
| Response body | `{ success, url, title, description, markdown, links, media }` |
| Health endpoint | `GET {base}/health` → `{"status":"ok"}` |
| Timeout | 15 s per page (client-side abort), 6 concurrent pages |
| Auth | none today — the client sends no credentials. Protect it with network rules (private network / IP allowlist / Cloudflare Access) |
| Browser deps | required — Crawl4AI drives Playwright Chromium |

Response requirements: `success` must be `true` and `markdown` must contain
≥200 characters of text, otherwise Eterna records a Crawl4AI failure and falls
back to plain fetch.

## Deployment (any container host)

```bash
cd crawler-service
docker build -t eterna-crawler .
docker run -d --name eterna-crawler -p 8080:8080 --shm-size=1g eterna-crawler
curl -s localhost:8080/health
curl -s "localhost:8080/crawl?url=https://example.com" | head -c 400
```

### Fly.io

```bash
fly launch --no-deploy --name eterna-crawler
fly scale vm shared-cpu-2x --memory 2048
fly secrets set BRAVE_API_KEY=...   # only if the service's own search routes are used
fly deploy
```

`fly.toml` essentials:

```toml
[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false   # keep Chromium warm
  min_machines_running = 1

[[http_service.checks]]
  path = "/health"
  interval = "30s"
  timeout = "5s"
```

### Minimum production sizing

- 2 vCPU / 2 GB RAM (Chromium needs ~500 MB per tab; 1 GB is not enough at 6 concurrency)
- `--shm-size=1g` (or Fly's default 1 GB `/dev/shm`) or Chromium crashes on heavy pages
- 1 always-on instance (cold starts blow the 15 s client timeout)
- request timeout ≥ 60 s at the proxy/load balancer

### Wiring it into Eterna

Add project secret `CRAWLER_SERVICE_URL` = the deployed origin (no path).
Then a scan reports `CRAWL4AI_CONFIGURED: true` plus `CRAWL4AI_ATTEMPTED`,
`CRAWL4AI_SUCCESS`, `CRAWL4AI_FAILED`, and `FETCH_FALLBACK_USED` separately.

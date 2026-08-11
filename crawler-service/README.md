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


## Warm-browser performance (Crawl4AI)

The service keeps **one Chromium instance warm for the process lifetime** and
reuses it for every `/crawl` request. Launching Chromium per request was the
cause of the earlier 204/210 navigation timeouts.

Key behaviours:

- Chromium is launched once during FastAPI startup (`lifespan`), so the first
  real request is already warm.
- Requests are admitted through a semaphore (`CRAWL_MAX_CONCURRENCY`, default 6,
  matching the scan pipeline's extraction pool). Saturation never trips the
  circuit breaker.
- Images, fonts and heavy tags are not loaded; navigation waits for
  `domcontentloaded` plus a short settle delay instead of `networkidle`.
  JavaScript stays enabled.
- Every response carries `timings_ms` with `browser_ms`, `queue_ms`,
  `render_ms`, `extract_ms`, `total_ms`, plus `warm: true|false`.
- A circuit breaker opens after `CRAWL_BREAKER_THRESHOLD` consecutive hard
  failures and replies `503 {"failure_category":"circuit_open"}` for
  `CRAWL_BREAKER_OPEN_SECONDS`, so Eterna falls back to plain fetch instantly
  instead of burning its 15s per-URL budget.
- `GET /crawl/diagnostics` returns browser warmth, launch count/latency,
  concurrency, timeouts, breaker state and per-counter totals.
- Browser-level faults (target closed) recycle the browser automatically; the
  page pool recycles every `CRAWL_MAX_PAGES_BEFORE_RECYCLE` pages.

### Tunables

| Env var | Default | Purpose |
| --- | --- | --- |
| `CRAWL_MAX_CONCURRENCY` | 6 | Simultaneous renders on the warm browser |
| `CRAWL_PAGE_TIMEOUT_MS` | 10000 | Playwright navigation timeout |
| `CRAWL_HARD_TIMEOUT_S` | 13 | Hard cap per request, kept under the client's 15s abort |
| `CRAWL_QUEUE_WAIT_TIMEOUT_S` | 20 | Max admission wait before returning 503 |
| `CRAWL_BREAKER_THRESHOLD` | 8 | Consecutive failures before the breaker opens |
| `CRAWL_BREAKER_OPEN_SECONDS` | 60 | Breaker cool-down |
| `CRAWL_MAX_PAGES_BEFORE_RECYCLE` | 200 | Page-pool recycle interval |

### Deployment notes

- Run **one uvicorn worker per container** — the warm browser is per-process.
  Scale horizontally with more containers, not `--workers`.
- Give the container at least **1 vCPU / 2 GB RAM** and `--shm-size=1g`
  (`docker run --shm-size=1g ...`; on Fly.io set `memory = "2gb"`).
- Do not put the service behind a proxy with a timeout below ~20s.

### Measured benchmark (25 mixed news/media URLs, client concurrency 6)

```
cold browser launch      : 0.9 s (once, at startup)
warm renders             : 21/25 succeeded
p50 total                : 3.4 s
mean total               : 3.1 s
max answer latency       : 13.6 s (hard cap)
browser launches         : 1  (warm reuses: 26)
queue rejections         : 0
breaker trips            : 0
```

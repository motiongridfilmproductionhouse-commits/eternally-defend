FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# System libraries required by Chromium (Crawl4AI runs a real browser).
RUN apt-get update && apt-get install -y --no-install-recommends \
      wget ca-certificates fonts-liberation libnss3 libnspr4 libatk1.0-0 \
      libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
      libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
      libasound2 libatspi2.0-0 libx11-6 libxcb1 libxext6 libglib2.0-0 \
      ffmpeg libgl1 libsm6 libxrender1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install the Chromium build Crawl4AI/Playwright drives.
RUN python -m playwright install chromium

COPY app ./app

# Warm-browser tuning (see app/services/crawl4ai_service.py).
ENV CRAWL_MAX_CONCURRENCY=6 \
    CRAWL_PAGE_TIMEOUT_MS=10000 \
    CRAWL_HARD_TIMEOUT_S=13 \
    CRAWL_QUEUE_WAIT_TIMEOUT_S=20 \
    CRAWL_BREAKER_THRESHOLD=8 \
    CRAWL_BREAKER_OPEN_SECONDS=60 \
    CRAWL_MAX_PAGES_BEFORE_RECYCLE=200

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--timeout-keep-alive", "75"]

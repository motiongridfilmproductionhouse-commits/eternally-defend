/**
 * Serialized scan stats persistence — never drop incremental telemetry.
 */

export class ScanTelemetryWriter {
  private chain = Promise.resolve();
  private trailingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly persist: (stats: Record<string, unknown>) => Promise<void>,
  ) {}

  /** Build final payload with website_activity mirror for the live investigation UI. */
  static withWebsiteActivity(stats: Record<string, unknown>): Record<string, unknown> {
    const recent = stats.recent_activity;
    return {
      ...stats,
      website_activity: Array.isArray(recent) ? recent : [],
      last_progress_at: new Date().toISOString(),
    };
  }

  /**
   * Queue a DB write. Forced writes are serialized so none are dropped while
   * a prior flush is in flight. Non-forced writes debounce to one trailing flush.
   */
  flush(buildStats: () => Record<string, unknown>, force = false): Promise<void> {
    if (force) {
      if (this.trailingTimer) {
        clearTimeout(this.trailingTimer);
        this.trailingTimer = null;
      }
      this.chain = this.chain
        .then(async () => {
          await this.persist(ScanTelemetryWriter.withWebsiteActivity(buildStats()));
        })
        .catch(() => {});
      return this.chain;
    }

    if (this.trailingTimer) return Promise.resolve();
    this.trailingTimer = setTimeout(() => {
      this.trailingTimer = null;
      void this.flush(buildStats, true);
    }, 400);
    return Promise.resolve();
  }
}

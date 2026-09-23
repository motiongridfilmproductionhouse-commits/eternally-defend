import { describe, expect, it } from "vitest";
import {
  runProspectScan,
  runProspectScanStep,
  type ProspectStore,
  type ProviderExecutor,
  type NormalizedHit,
  type ManipulationDetector,
} from "./runner";
import {
  analyseScan,
  type DiscoveryRow,
  type FindingRow,
  type ObservationRow,
  type CapabilityRow,
} from "./analysis";
import type { ScanEventInput } from "./events";
import type { SourceState } from "./coverage";
import type { RiskScoreResult } from "./risk-model";

/* In-memory store: a test double for the persistence port, holding exactly
 * what the runner writes so assertions compare against "stored rows". */
function memoryStore() {
  let seq = 0;
  const id = () => `id-${++seq}`;
  const state = {
    scan: {} as Record<string, unknown>,
    sources: new Map<
      string,
      {
        family_key: string;
        state: SourceState;
        weight_class: string;
        direct_access: boolean;
        providers?: string[];
        failure_reason?: string | null;
        raw_results?: number;
      }
    >(),
    events: [] as ScanEventInput[],
    discoveries: [] as Array<DiscoveryRow & Record<string, unknown>>,
    observations: [] as ObservationRow[],
    findings: [] as Array<FindingRow & Record<string, unknown>>,
    evidence: [] as Array<Record<string, unknown>>,
    capabilities: new Map<string, CapabilityRow>(),
    clusters: [] as Array<Record<string, unknown>>,
    scores: [] as RiskScoreResult[],
  };
  const store: ProspectStore = {
    async getScanStatus() {
      return String(state.scan.status ?? "queued");
    },
    async listUnitRecords() {
      return state.events
        .filter((e) => typeof e.detail?.unit === "string")
        .map((e) => ({
          unit: String(e.detail!.unit),
          detail: { type: e.type, ...(e.detail ?? {}) },
        }));
    },
    async updateScan(patch) {
      Object.assign(state.scan, patch);
    },
    async initSources(rows) {
      for (const r of rows) state.sources.set(r.family_key, { ...r });
    },
    async updateSource(key, patch) {
      Object.assign(state.sources.get(key)!, patch);
    },
    async appendEvent(e) {
      state.events.push(e);
    },
    async insertDiscovery(row) {
      if (state.discoveries.some((d) => d.canonical_url === row.canonical_url)) return null;
      const d = { ...row, id: id() } as unknown as DiscoveryRow & Record<string, unknown>;
      state.discoveries.push(d);
      return d.id;
    },
    async findDiscoveryId(url) {
      return state.discoveries.find((d) => d.canonical_url === url)?.id ?? null;
    },
    async insertObservation(row) {
      state.observations.push(row);
    },
    async insertFinding(row) {
      if (
        state.findings.some(
          (f) =>
            f.discovery_id === row.discovery_id &&
            f.stage_key === row.stage_key &&
            f.category === row.category,
        )
      )
        return null;
      const f = { ...row, id: id() } as unknown as FindingRow & Record<string, unknown>;
      state.findings.push(f);
      return f.id;
    },
    async insertEvidence(row) {
      state.evidence.push(row as unknown as Record<string, unknown>);
    },
    async upsertCapability(row) {
      state.capabilities.set(row.analysis_key, row);
    },
    async insertCluster(row) {
      state.clusters.push(row as unknown as Record<string, unknown>);
    },
    async insertRiskScore(r) {
      state.scores.push(r);
    },
    async listSources() {
      return Array.from(state.sources.values());
    },
    async listDiscoveries() {
      return state.discoveries;
    },
    async listFindings() {
      return state.findings;
    },
    async listObservations() {
      return state.observations;
    },
    async listCapabilities() {
      return Array.from(state.capabilities.values());
    },
  };
  return { store, state };
}

function executor(
  id: string,
  familyKey: ProviderExecutor["familyKey"],
  results: (q: string) => NormalizedHit[] | Error,
  method: ProviderExecutor["method"] = "WEB_SEARCH",
): ProviderExecutor {
  return {
    id,
    label: id,
    familyKey,
    method,
    isConfigured: () => true,
    async search(q) {
      const r = results(q.query);
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

const target = {
  name: "Anand Varghese",
  profession: "film producer",
  knownWorks: ["Monsoon Harbour"],
  knownHandles: ["anandvarghese"],
};

const creditError = Object.assign(new Error("402 out of credits"), { kind: "credits_exhausted" });

async function pageFor(url: string) {
  if (url.includes("news.example/allegation")) {
    return {
      text: "Anand Varghese, producer of Monsoon Harbour, faced an allegation reported by local media. ".repeat(
        4,
      ),
      title: "Producer faces allegation",
    };
  }
  if (url.includes("mirror.example")) {
    return {
      text: "Anand Varghese, producer of Monsoon Harbour, faced an allegation reported by local media. ".repeat(
        4,
      ),
      title: "Producer faces allegation",
    };
  }
  if (url.includes("other.example")) {
    return {
      text: "Anand Varghese is a common name; this page is about a cricketer from another city with the same name. ".repeat(
        3,
      ),
      title: "Local cricket",
    };
  }
  return null;
}

describe("runProspectScan", () => {
  it("starts from zero and every count equals stored rows; one page from three providers is one item", async () => {
    const { store, state } = memoryStore();
    const sameUrl = (q: string): NormalizedHit[] =>
      q === '"Anand Varghese"'
        ? [{ url: "https://news.example/allegation?utm_source=x", title: "t" }]
        : [];
    const result = await runProspectScan(
      {
        store,
        executors: [
          executor("brave", "web_general", sameUrl),
          executor("gemini_grounding", "web_general", (q) =>
            q === '"Anand Varghese"'
              ? [{ url: "http://www.news.example/allegation/", title: "Different title" }]
              : [],
          ),
          executor("google", "google_search", sameUrl),
        ],
        fetchPage: pageFor,
        detector: null,
      },
      { target },
    );
    expect(state.discoveries).toHaveLength(1);
    expect(state.observations).toHaveLength(3);
    expect(result.done).toBe(true);
    const analysis = analyseScan({
      sources: Array.from(state.sources.values()),
      discoveries: state.discoveries,
      findings: state.findings,
      capabilities: Array.from(state.capabilities.values()),
    });
    expect(analysis.counts.sourcesDiscovered).toBe(state.discoveries.length);
    expect(analysis.stages.harmful_content.relevant).toBe(1);
    expect(
      state.findings.every(
        (f) => f.state !== "VERIFIED" && f.state !== "REJECTED" && f.state !== "ESCALATED",
      ),
    ).toBe(true);
  });

  it("keeps Instagram unavailable when an Instagram URL arrives through web search", async () => {
    const { store, state } = memoryStore();
    const fetched: string[] = [];
    await runProspectScan(
      {
        store,
        executors: [
          executor("brave", "web_general", (q) =>
            q === '"Anand Varghese"'
              ? [
                  {
                    url: "https://www.instagram.com/anand.varghese.official2",
                    title: "Anand Varghese (@anand.varghese.official2)",
                  },
                ]
              : [],
          ),
        ],
        fetchPage: async (u) => {
          fetched.push(u);
          return null;
        },
        detector: null,
      },
      { target },
    );
    const d = state.discoveries[0]!;
    expect(d.platform).toBe("Instagram");
    expect(d.discovery_method).toBe("WEB_SEARCH");
    expect(state.sources.get("instagram")!.state).toBe("unavailable");
    expect(fetched).toHaveLength(0);
    expect(state.findings.some((f) => f.stage_key === "impersonation")).toBe(true);
  });

  it("keeps Reddit policy-disabled and never raises impersonation from Reddit URLs", async () => {
    const { store, state } = memoryStore();
    await runProspectScan(
      {
        store,
        executors: [
          executor("brave", "web_general", (q) =>
            q === '"Anand Varghese"'
              ? [
                  {
                    url: "https://www.reddit.com/user/anandvarghese_fake",
                    title: "Anand Varghese fake account impersonation",
                    snippet: "fake account of film producer Anand Varghese, Monsoon Harbour",
                  },
                ]
              : [],
          ),
        ],
        fetchPage: async () => null,
        detector: null,
      },
      { target },
    );
    expect(state.sources.get("reddit")!.state).toBe("policy_disabled");
    expect(state.findings.some((f) => f.stage_key === "impersonation")).toBe(false);
  });

  it("persists and surfaces provider failures while other providers continue", async () => {
    const { store, state } = memoryStore();
    await runProspectScan(
      {
        store,
        executors: [
          executor("firecrawl", "web_general", () => creditError),
          executor("brave", "web_general", (q) =>
            q === '"Anand Varghese"' ? [{ url: "https://news.example/allegation" }] : [],
          ),
        ],
        fetchPage: pageFor,
        detector: null,
      },
      { target },
    );
    const web = state.sources.get("web_general")!;
    expect(web.state).toBe("results_found");
    expect(web.providers).toContain("firecrawl:CREDIT_EXHAUSTED");
    expect(web.providers).toContain("brave:COMPLETE");
    expect(state.events.some((e) => e.type === "PROVIDER_FAILED" && /credit/.test(e.message))).toBe(
      true,
    );
  });

  it("marks a family provider_error when every provider fails, and coverage reflects it", async () => {
    const { store, state } = memoryStore();
    await runProspectScan(
      {
        store,
        executors: [executor("brave", "web_general", () => creditError)],
        fetchPage: pageFor,
        detector: null,
      },
      { target },
    );
    expect(state.sources.get("web_general")!.state).toBe("provider_error");
    expect(state.scan.coverage_state).toBe("INSUFFICIENT");
    expect(state.scan.status).toBe("partial");
  });

  it("records media as candidates only and reports manipulation analysis unavailable without a detector", async () => {
    const { store, state } = memoryStore();
    await runProspectScan(
      {
        store,
        executors: [
          executor(
            "youtube_data_api",
            "youtube",
            () => [
              {
                url: "https://www.youtube.com/watch?v=abc123XYZ",
                title: "Anand Varghese Monsoon Harbour interview",
                mediaKind: "video",
                thumbnailUrl: "https://i.ytimg.com/vi/abc/hq.jpg",
              },
            ],
            "PLATFORM_API",
          ),
        ],
        fetchPage: async () => null,
        detector: null,
      },
      { target },
    );
    expect(state.findings.some((f) => f.stage_key === "ai_manipulation")).toBe(false);
    expect(state.capabilities.get("ai_manipulation")!.status).toBe("unavailable");
    expect(
      state.events.some(
        (e) => e.type === "ANALYSIS_UNAVAILABLE" && /media candidate/.test(e.message),
      ),
    ).toBe(true);
  });

  it("only stores a manipulation finding when a real detector returns a signal, worded as potential", async () => {
    const { store, state } = memoryStore();
    const detector: ManipulationDetector = {
      name: "Test detector",
      isConfigured: () => true,
      analyse: async (item) => ({
        status: "completed",
        score: item.url.includes("abc") ? 91 : 10,
        detail: "stub",
      }),
    };
    await runProspectScan(
      {
        store,
        executors: [
          executor(
            "youtube_data_api",
            "youtube",
            () => [
              {
                url: "https://www.youtube.com/watch?v=abc123XYZ",
                title: "Anand Varghese Monsoon Harbour clip",
                mediaKind: "video",
                thumbnailUrl: "https://i.ytimg.com/vi/abc/hq.jpg",
              },
              {
                url: "https://www.youtube.com/watch?v=def456UVW",
                title: "Anand Varghese Monsoon Harbour trailer",
                mediaKind: "video",
                thumbnailUrl: "https://i.ytimg.com/vi/def/hq.jpg",
              },
            ],
            "PLATFORM_API",
          ),
        ],
        fetchPage: async () => null,
        detector,
      },
      { target },
    );
    const mf = state.findings.filter((f) => f.stage_key === "ai_manipulation");
    expect(mf).toHaveLength(1);
    expect(mf[0]!.category).toBe("Potential manipulation signal");
    expect(mf[0]!.detection_reason).toMatch(/requires verification/);
    expect(mf[0]!.detection_reason).not.toMatch(/\bdeepfake\b(?! score)/i);
    expect(state.capabilities.get("ai_manipulation")!.status).toBe("ran");
  });

  it("keeps a same-name stranger out of the matched totals", async () => {
    const { store, state } = memoryStore();
    await runProspectScan(
      {
        store,
        executors: [
          executor("brave", "web_general", (q) =>
            q === '"Anand Varghese"'
              ? [{ url: "https://other.example/cricket", title: "Anand Varghese hits a century" }]
              : [],
          ),
        ],
        fetchPage: pageFor,
        detector: null,
      },
      { target },
    );
    expect(state.discoveries[0]!.identity_bucket).not.toBe("MATCHED");
    const a = analyseScan({
      sources: Array.from(state.sources.values()),
      discoveries: state.discoveries,
      findings: state.findings,
      capabilities: [],
    });
    expect(a.counts.relevantItems).toBe(0);
  });

  it("returns honest zero states: no fabricated findings, preliminary insufficient, verified pending", async () => {
    const { store, state } = memoryStore();
    const result = await runProspectScan(
      {
        store,
        executors: [executor("brave", "web_general", () => [])],
        fetchPage: pageFor,
        detector: null,
      },
      { target },
    );
    expect(state.discoveries).toHaveLength(0);
    expect(state.findings).toHaveLength(0);
    expect(result.preliminary).toBe("INSUFFICIENT_DATA");
    expect(result.verified).toBe("PENDING_VERIFICATION");
    expect(state.sources.get("web_general")!.state).toBe("no_results");
  });

  it("clusters identical content as propagation and labels the earliest as earliest discovered, never original", async () => {
    const { store, state } = memoryStore();
    await runProspectScan(
      {
        store,
        executors: [
          executor("brave", "web_general", (q) =>
            q === '"Anand Varghese"'
              ? [{ url: "https://news.example/allegation" }, { url: "https://mirror.example/copy" }]
              : [],
          ),
        ],
        fetchPage: pageFor,
        detector: null,
      },
      { target },
    );
    expect(state.clusters).toHaveLength(1);
    const copies = state.findings.filter((f) => f.stage_key === "propagation");
    expect(copies).toHaveLength(1);
    expect(copies[0]!.detection_reason).toMatch(/earliest discovered source/);
    expect(JSON.stringify(state.findings)).not.toMatch(/original source/i);
  });

  it("is resumable: tiny steps with fresh runtime state produce the same stored result as one run", async () => {
    const hitsFor = (q: string): NormalizedHit[] =>
      q === '"Anand Varghese"'
        ? [
            { url: "https://news.example/allegation" },
            { url: "https://mirror.example/copy" },
            { url: "https://other.example/cricket" },
          ]
        : [];
    const single = memoryStore();
    await runProspectScan(
      {
        store: single.store,
        executors: [
          executor("brave", "web_general", hitsFor),
          executor("google", "google_search", hitsFor),
        ],
        fetchPage: pageFor,
        detector: null,
      },
      { target },
    );

    const stepped = memoryStore();
    let steps = 0;
    for (let guard = 0; guard < 200; guard++) {
      // New executors/ports every step: nothing survives in process memory.
      const r = await runProspectScanStep(
        {
          store: stepped.store,
          executors: [
            executor("brave", "web_general", hitsFor),
            executor("google", "google_search", hitsFor),
          ],
          fetchPage: pageFor,
          detector: null,
        },
        { target },
        { budgetMs: 0 },
      );
      steps++;
      expect(r.unitsRun).toBeGreaterThan(0);
      if (r.done) break;
    }
    expect(steps).toBeGreaterThan(5);
    expect(stepped.state.discoveries.map((d) => d.canonical_url).sort()).toEqual(
      single.state.discoveries.map((d) => d.canonical_url).sort(),
    );
    expect(stepped.state.observations).toHaveLength(single.state.observations.length);
    expect(stepped.state.findings.map((f) => `${f.stage_key}:${f.category}`).sort()).toEqual(
      single.state.findings.map((f) => `${f.stage_key}:${f.category}`).sort(),
    );
    expect(stepped.state.scan.status).toBe(single.state.scan.status);
    expect(stepped.state.scores).toHaveLength(2);
  });
});

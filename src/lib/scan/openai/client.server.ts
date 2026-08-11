/**
 * Lovable AI Gateway — OpenAI Responses API client for the Web Scan AI layer.
 *
 * Streaming only (reasoning runs are long), strict json_schema output, no
 * timers/aborts. Never throws into the scan pipeline: callers get null on any
 * failure and mark the layer UNAVAILABLE.
 */

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/responses";

export function getScanAiModel(): string {
  return process.env["OPENAI_SCAN_MODEL"]?.trim() || "openai/gpt-5.5";
}

export function isResearchEnabled(): boolean {
  return process.env["SCAN_AI_RESEARCH_ENABLED"]?.trim() !== "false";
}

export function isReasoningEnabled(): boolean {
  return process.env["SCAN_AI_REASONING_ENABLED"]?.trim() !== "false";
}

/** Soft per-scan call budget so the AI layer can never run away. */
export class AiCallBudget {
  private used = 0;
  constructor(private readonly max: number) {}
  get remaining(): number {
    return Math.max(0, this.max - this.used);
  }
  take(): boolean {
    if (this.used >= this.max) return false;
    this.used++;
    return true;
  }
}

interface JsonCallInput {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
}

/**
 * One streamed /v1/responses call returning parsed strict-schema JSON.
 * Returns { ok: false, error } instead of throwing.
 */
export async function callScanAiJson<T>(
  args: JsonCallInput,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return { ok: false, error: "LOVABLE_API_KEY missing" };

  const body = {
    model: getScanAiModel(),
    instructions: args.instructions,
    input: args.input,
    stream: true,
    store: false,
    reasoning: { effort: args.effort ?? "low", summary: "auto" },
    text: {
      format: {
        type: "json_schema",
        name: args.schemaName,
        strict: true,
        schema: args.schema,
      },
    },
  };

  const attempt = async (): Promise<
    { ok: true; text: string } | { ok: false; error: string; retryable: boolean }
  > => {
    let res: Response;
    try {
      res = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": apiKey,
          "X-Lovable-AIG-SDK": "fetch",
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message.slice(0, 200) : "network error",
        retryable: true,
      };
    }

    if (!res.ok || !res.body) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      return {
        ok: false,
        error: `gateway ${res.status}: ${detail}`,
        retryable: res.status === 429 || res.status >= 500,
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let out = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload) as {
            type?: string;
            delta?: string;
            response?: { output_text?: string };
          };
          if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
            out += evt.delta;
          } else if (evt.type === "response.completed" && !out) {
            out = evt.response?.output_text ?? "";
          }
        } catch {
          /* ignore malformed SSE frame */
        }
      }
    }

    if (!out.trim()) return { ok: false, error: "empty model output", retryable: false };
    return { ok: true, text: out };
  };

  let result = await attempt();
  if (!result.ok && result.retryable) {
    await new Promise((r) => setTimeout(r, 1500));
    result = await attempt();
  }
  if (!result.ok) return { ok: false, error: result.error };

  try {
    return { ok: true, data: JSON.parse(result.text) as T };
  } catch {
    return { ok: false, error: "malformed JSON output" };
  }
}

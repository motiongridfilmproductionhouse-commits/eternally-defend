/**
 * Extract concise, searchable claims from text using Lovable AI Gateway (Gemini).
 * Never labels a claim as true or false — that's the Fact Check API's job.
 */
import { ok, failed, type ProviderResult } from "./providers.server";

export interface ExtractedClaim {
  claim: string;
  claimant?: string;
  original_snippet: string;
}

export async function extractSearchableClaims(
  text: string,
  targetName?: string,
): Promise<ProviderResult<ExtractedClaim[]>> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return failed("LOVABLE_API_KEY not configured");
  if (!text.trim()) return ok([]);

  const prompt = `Extract 0-8 concise, searchable factual claims from the following text.
Only extract claims that could be fact-checked (specific assertions about events, people, actions, statistics).
Do NOT extract opinions, questions, or vague statements.
${targetName ? `Prioritize claims about "${targetName}".` : ""}
Return JSON array of {claim, claimant, original_snippet}. claim is <= 140 chars, phrased as a search query.

Text:
"""${text.slice(0, 8000)}"""`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return failed(`Gemini [${res.status}]: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = j.choices?.[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch { return ok([]); }
    const arr = Array.isArray(parsed) ? parsed : ((parsed as { claims?: unknown }).claims ?? []);
    if (!Array.isArray(arr)) return ok([]);
    const claims: ExtractedClaim[] = [];
    for (const c of arr) {
      if (typeof c !== "object" || !c) continue;
      const rec = c as Record<string, unknown>;
      const claim = String(rec.claim ?? "").trim();
      if (!claim) continue;
      claims.push({
        claim: claim.slice(0, 240),
        claimant: rec.claimant ? String(rec.claimant).slice(0, 120) : undefined,
        original_snippet: String(rec.original_snippet ?? claim).slice(0, 500),
      });
    }
    return ok(claims);
  } catch (e) {
    return failed(`Gemini network: ${e instanceof Error ? e.message : String(e)}`);
  }
}

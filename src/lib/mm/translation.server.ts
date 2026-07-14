/**
 * Google Cloud Translation v2 via API key.
 * v2 supports API-key auth; v3 requires OAuth service account.
 * Docs: https://cloud.google.com/translate/docs/reference/rest/v2/translate
 */
import { getProviderConfig, ok, unavailable, failed, type ProviderResult } from "./providers.server";

export interface TranslationResult {
  detectedLanguage: string | null;
  translatedText: string;
  confidence: number | null;
  provider: string;
}

export async function detectLanguage(text: string): Promise<ProviderResult<{ language: string; confidence: number }>> {
  const cfg = getProviderConfig();
  if (cfg.translation === "stub" || !cfg.googleApiKey) {
    return unavailable("Translation API key not configured");
  }
  const url = new URL("https://translation.googleapis.com/language/translate/v2/detect");
  url.searchParams.set("key", cfg.googleApiKey);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ q: text.slice(0, 5000) }).toString(),
    });
    if (!res.ok) return failed(`Detect [${res.status}]: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { data?: { detections?: Array<Array<{ language: string; confidence: number }>> } };
    const d = j.data?.detections?.[0]?.[0];
    if (!d) return failed("no detection");
    return ok({ language: d.language, confidence: d.confidence ?? 0 });
  } catch (e) {
    return failed(`Detect network: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function translateText(
  text: string,
  targetLang = "en",
  sourceLang?: string,
): Promise<ProviderResult<TranslationResult>> {
  const cfg = getProviderConfig();
  if (cfg.translation === "stub" || !cfg.googleApiKey) {
    return unavailable("Translation API key not configured");
  }
  if (!text.trim()) return ok({ detectedLanguage: sourceLang ?? null, translatedText: text, confidence: 1, provider: "google_translate_v2" });

  const url = new URL("https://translation.googleapis.com/language/translate/v2");
  url.searchParams.set("key", cfg.googleApiKey);
  const params = new URLSearchParams({ q: text.slice(0, 5000), target: targetLang, format: "text" });
  if (sourceLang) params.set("source", sourceLang);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (!res.ok) return failed(`Translate [${res.status}]: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as {
      data?: { translations?: Array<{ translatedText: string; detectedSourceLanguage?: string }> };
    };
    const t = j.data?.translations?.[0];
    if (!t) return failed("no translation");
    return ok({
      detectedLanguage: t.detectedSourceLanguage ?? sourceLang ?? null,
      translatedText: t.translatedText,
      confidence: null,
      provider: "google_translate_v2",
    });
  } catch (e) {
    return failed(`Translate network: ${e instanceof Error ? e.message : String(e)}`);
  }
}

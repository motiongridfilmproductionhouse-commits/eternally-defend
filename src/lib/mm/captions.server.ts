/**
 * Caption / transcript parsing. Supports SRT, WebVTT, and plain text.
 * Only timestamped formats produce exact-time findings. Plain text becomes
 * a single untimestamped "passage" segment, and callers must NOT synthesize
 * timestamps from it.
 */
export type CaptionFormat = "srt" | "vtt" | "txt" | "manual";

export interface CaptionSegment {
  index: number;
  start: number | null; // seconds, null for plain text
  end: number | null;
  text: string;
  speaker?: string;
}

export function detectCaptionFormat(raw: string, filename?: string): CaptionFormat {
  const name = (filename ?? "").toLowerCase();
  if (name.endsWith(".srt")) return "srt";
  if (name.endsWith(".vtt")) return "vtt";
  const head = raw.slice(0, 200).trim();
  if (head.startsWith("WEBVTT")) return "vtt";
  if (/^\d+\s*\r?\n\d\d:\d\d:\d\d[,.]\d{3}\s+-->/.test(head)) return "srt";
  return "txt";
}

function tsToSeconds(ts: string): number | null {
  const m = ts.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/);
  if (!m) return null;
  const [, h, mm, ss, ms] = m;
  return (h ? +h * 3600 : 0) + +mm * 60 + +ss + +ms / 1000;
}

export function parseCaptions(raw: string, format: CaptionFormat): CaptionSegment[] {
  if (format === "txt" || format === "manual") {
    return [{ index: 0, start: null, end: null, text: raw.trim() }];
  }
  const text = raw.replace(/\r/g, "");
  // strip WEBVTT header
  const body = format === "vtt" ? text.replace(/^WEBVTT.*?\n\n/s, "") : text;
  const blocks = body.split(/\n\n+/);
  const out: CaptionSegment[] = [];
  let idx = 0;
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    // Find the timestamp line
    const tsLine = lines.find((l) => l.includes("-->"));
    if (!tsLine) continue;
    const [a, b] = tsLine.split("-->").map((s) => s.trim().split(" ")[0]);
    const start = tsToSeconds(a);
    const end = tsToSeconds(b);
    if (start === null) continue;
    const textLines = lines.filter((l) => l !== tsLine && !/^\d+$/.test(l));
    let speaker: string | undefined;
    const speakerMatch = textLines[0]?.match(/^<v\s+([^>]+)>/);
    if (speakerMatch) speaker = speakerMatch[1];
    const cleaned = textLines
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\{[^}]+\}/g, "")
      .trim();
    if (cleaned) out.push({ index: idx++, start, end, text: cleaned, speaker });
  }
  return out;
}

const KEYWORDS = {
  scam: /\b(scam|scammer|scamming|fraud|fraudulent|ponzi|swindle)\b/i,
  fake: /\b(fake|hoax|deepfake|impersonat)\b/i,
  harassment: /\b(harass|threat|dox|stalk|abuse)\b/i,
  endorsement: /\b(endorse|sponsored by|partner(?:ed)? with|ambassador)\b/i,
  copyright: /\b(copyright|trademark|infring|unauthorized|stolen)\b/i,
  denial: /\b(denies|denied|refute|refuted|debunk|debunked)\b/i,
  correction: /\b(correction|clarif|retract|apolog)\b/i,
  allegation: /\b(alleged|accus|claim(?:s|ed) that|accord(?:ing)? to)\b/i,
};

export interface CaptionFinding {
  start_seconds: number;
  end_seconds: number | null;
  text: string;
  speaker?: string;
  finding_type: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  matched: string[];
  timestamp_source: "captions";
}

export function findingsFromCaptions(
  segments: CaptionSegment[],
  nameTerms: string[],
): CaptionFinding[] {
  const findings: CaptionFinding[] = [];
  const nameRe = nameTerms.length
    ? new RegExp(
        nameTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
        "i",
      )
    : null;
  for (const seg of segments) {
    if (seg.start === null) continue; // never synthesize timestamps
    const text = seg.text;
    const matched: string[] = [];
    let type = "name_mention";
    let severity: CaptionFinding["severity"] = "low";
    const isName = nameRe?.test(text);
    for (const [k, re] of Object.entries(KEYWORDS)) {
      if (re.test(text)) matched.push(k);
    }
    if (!isName && !matched.length) continue;
    if (isName) matched.unshift("name");
    if (matched.some((m) => ["scam", "fake", "harassment"].includes(m))) {
      severity = "high"; type = "allegation";
    } else if (matched.includes("endorsement") || matched.includes("copyright")) {
      severity = "medium"; type = matched.includes("copyright") ? "copyright" : "endorsement";
    } else if (matched.includes("denial") || matched.includes("correction")) {
      severity = "medium"; type = "correction";
    } else if (matched.includes("allegation")) {
      severity = "medium"; type = "allegation";
    }
    findings.push({
      start_seconds: seg.start,
      end_seconds: seg.end,
      text: text.slice(0, 500),
      speaker: seg.speaker,
      finding_type: type,
      severity,
      matched,
      timestamp_source: "captions",
    });
  }
  return findings;
}

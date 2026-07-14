/**
 * Per-platform complaint templates. Maps a finding's source/platform to a
 * structured complaint payload (form fields + narrative body) that can be
 * pasted into the platform's official complaint form or forwarded to a legal
 * partner. No fabricated facts — every field is derived from the finding
 * itself and the caller's authorization record.
 */

export type ComplaintKind =
  | "youtube_defamation"
  | "youtube_copyright"
  | "youtube_harassment"
  | "x_impersonation"
  | "x_abuse"
  | "reddit_content_policy"
  | "meta_ip_report"
  | "tiktok_ip"
  | "generic_dmca";

export interface ComplaintPayload {
  kind: ComplaintKind;
  platform: string;
  submissionUrl: string;
  fields: Record<string, string>;
  narrative: string;
  evidenceStrength: "strong" | "moderate" | "weak";
}

export interface TemplateInput {
  method: "DMCA" | "Platform Report" | "Legal Notice";
  source: string;
  platform: string;
  title: string;
  targetUrl: string;
  publishedAt?: string | null;
  author?: string | null;
  claimSummary?: string | null;
  timestampsCount: number;
  factCheckMatches: number;
  hasEvidenceFrames: boolean;
  complainant: {
    legalName: string;
    email?: string;
    country?: string;
    authorizationLevel?: string;
    signedAt?: string;
  };
}

export function buildComplaint(input: TemplateInput): ComplaintPayload {
  const src = (input.source || "").toLowerCase();
  const evidenceStrength: "strong" | "moderate" | "weak" =
    input.timestampsCount + input.factCheckMatches >= 3
      ? "strong"
      : input.timestampsCount + input.factCheckMatches > 0 || input.hasEvidenceFrames
        ? "moderate"
        : "weak";

  const base = {
    "Complainant legal name": input.complainant.legalName,
    "Complainant email": input.complainant.email ?? "",
    "Complainant country": input.complainant.country ?? "",
    "Authorization level": input.complainant.authorizationLevel ?? "self",
    "Authorization signed at": input.complainant.signedAt ?? "",
    "Reported URL": input.targetUrl,
    "Reported content title": input.title,
    "Author / channel": input.author ?? "",
    "Published at": input.publishedAt ?? "",
    "Timestamped evidence segments": String(input.timestampsCount),
    "Independent fact-check matches": String(input.factCheckMatches),
    "Evidence strength": evidenceStrength,
  };

  if (src === "youtube") {
    const kind: ComplaintKind =
      input.method === "DMCA"
        ? "youtube_copyright"
        : /harass|threat|dox/i.test(input.claimSummary ?? "")
          ? "youtube_harassment"
          : "youtube_defamation";
    return {
      kind,
      platform: "YouTube",
      submissionUrl:
        kind === "youtube_copyright"
          ? "https://www.youtube.com/copyright_complaint_form"
          : kind === "youtube_harassment"
            ? "https://support.google.com/youtube/answer/2802027"
            : "https://support.google.com/youtube/answer/2801981",
      fields: base,
      narrative: buildNarrative(input, kind, evidenceStrength),
      evidenceStrength,
    };
  }
  if (src === "x" || src === "twitter") {
    return {
      kind: /impersonat/i.test(input.claimSummary ?? input.title) ? "x_impersonation" : "x_abuse",
      platform: "X",
      submissionUrl: "https://help.x.com/en/forms",
      fields: base,
      narrative: buildNarrative(input, "x_abuse", evidenceStrength),
      evidenceStrength,
    };
  }
  if (src === "reddit") {
    return {
      kind: "reddit_content_policy",
      platform: "Reddit",
      submissionUrl: "https://www.reddit.com/report",
      fields: base,
      narrative: buildNarrative(input, "reddit_content_policy", evidenceStrength),
      evidenceStrength,
    };
  }
  if (src === "instagram" || src === "facebook") {
    return {
      kind: "meta_ip_report",
      platform: src === "instagram" ? "Instagram" : "Facebook",
      submissionUrl: "https://www.facebook.com/help/contact/1758255661104383",
      fields: base,
      narrative: buildNarrative(input, "meta_ip_report", evidenceStrength),
      evidenceStrength,
    };
  }
  if (src === "tiktok") {
    return {
      kind: "tiktok_ip",
      platform: "TikTok",
      submissionUrl: "https://www.tiktok.com/legal/report/Copyright",
      fields: base,
      narrative: buildNarrative(input, "tiktok_ip", evidenceStrength),
      evidenceStrength,
    };
  }
  return {
    kind: "generic_dmca",
    platform: input.platform || "Web",
    submissionUrl: "",
    fields: base,
    narrative: buildNarrative(input, "generic_dmca", evidenceStrength),
    evidenceStrength,
  };
}

function buildNarrative(input: TemplateInput, kind: ComplaintKind, strength: string): string {
  const who = input.complainant.legalName;
  return [
    `To whom it may concern,`,
    ``,
    `I, ${who}, am submitting this ${labelFor(kind)} complaint regarding the following publicly accessible content:`,
    ``,
    `  Title: ${input.title}`,
    `  URL: ${input.targetUrl}`,
    input.publishedAt ? `  Published: ${input.publishedAt}` : ``,
    input.author ? `  Author / channel: ${input.author}` : ``,
    ``,
    `Basis for this report:`,
    input.claimSummary ? `  ${input.claimSummary}` : `  The content contains material that violates ${input.platform} policy and/or applicable law.`,
    ``,
    `Evidence attached to this submission (evidence strength: ${strength}):`,
    `  - ${input.timestampsCount} timestamped evidence segment(s) captured by Eterna AI.`,
    `  - ${input.factCheckMatches} independent fact-check reference(s).`,
    input.hasEvidenceFrames ? `  - Frame-level visual evidence attached.` : ``,
    ``,
    `I have a good-faith belief that the use of the material identified above is not authorized by me, my agent, or the law. I declare, under penalty of perjury, that the information in this notice is accurate and that I am the person authorized to act on behalf of the rights holder.`,
    ``,
    `Signed electronically: ${who}`,
    input.complainant.signedAt ? `Authorization on file signed: ${input.complainant.signedAt}` : ``,
  ]
    .filter(Boolean)
    .join("\n");
}

function labelFor(kind: ComplaintKind): string {
  switch (kind) {
    case "youtube_copyright": return "YouTube copyright";
    case "youtube_harassment": return "YouTube harassment";
    case "youtube_defamation": return "YouTube defamation / privacy";
    case "x_impersonation": return "X impersonation";
    case "x_abuse": return "X abuse";
    case "reddit_content_policy": return "Reddit content policy";
    case "meta_ip_report": return "Meta rights infringement";
    case "tiktok_ip": return "TikTok rights infringement";
    default: return "DMCA takedown";
  }
}

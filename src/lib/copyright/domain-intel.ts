/**
 * Domain intelligence + removal intelligence model for the Copyright
 * Investigation Center. Pure, client-safe helpers only.
 */

import type { WebsiteInvestigationResult } from "@/lib/investigation/website-investigation";

export interface RemovalIntelligence {
  domain: string;
  hostingCompany: string | null;
  hostingAbuseEmail: string | null;
  hostingAbuseForm: string | null;
  registrar: string | null;
  registrarAbuseEmail: string | null;
  registrarComplaintUrl: string | null;
  dmcaPageUrl: string | null;
  copyrightComplaintUrl: string | null;
  legalContact: string | null;
  whoisContact: string | null;
  whoisPrivacy: boolean;
  country: string | null;
  jurisdiction: string;
  regime: string;
  takedownPath: string[];
  note: string;
}

export interface DomainIntel {
  url: string;
  domain: string;
  investigation: WebsiteInvestigationResult;
  removal: RemovalIntelligence;
  trustScore: number;
  threatCategory: string;
  confidence: number;
  mirrorDomains: string[];
  historicalDomains: string[];
  reverseIpHost: string | null;
  cachedAt: string;
}

export const PRIVACY_PLACEHOLDER = "Protected — not publicly disclosed";
export const UNAVAILABLE_PLACEHOLDER = "Not available";

/** Render a field value, never leaving an intelligence row visually blank. */
export function intelValue(
  value: string | number | null | undefined,
  opts?: { privacy?: boolean },
): string {
  if (value === null || value === undefined || value === "") {
    return opts?.privacy ? PRIVACY_PLACEHOLDER : UNAVAILABLE_PLACEHOLDER;
  }
  return String(value);
}

const EU_COUNTRIES = new Set([
  "DE",
  "FR",
  "NL",
  "IE",
  "SE",
  "FI",
  "DK",
  "ES",
  "IT",
  "PL",
  "PT",
  "BE",
  "AT",
  "CZ",
  "RO",
  "BG",
  "GR",
  "HU",
  "SK",
  "SI",
  "HR",
  "LT",
  "LV",
  "EE",
  "LU",
  "MT",
  "CY",
]);

/** Applicable copyright regime for a two-letter country code or name. */
export function copyrightRegime(country: string | null | undefined): string {
  const c = (country ?? "").trim().toUpperCase();
  if (!c) return "Unknown jurisdiction — verify before serving notice";
  if (c === "US" || c === "USA" || c === "UNITED STATES") return "DMCA (17 U.S.C. §512)";
  if (EU_COUNTRIES.has(c)) return "EU Copyright Directive + DSA notice-and-action";
  if (c === "GB" || c === "UK") return "UK CDPA 1988 + eCommerce Regulations";
  if (c === "IN" || c === "INDIA") return "Indian Copyright Act §52A + IT Rules 2021";
  if (c === "CA") return "Canada Copyright Act (notice-and-notice)";
  if (c === "AU") return "Australia Copyright Act §115A";
  if (c === "RU") return "Russian Federal Law 187-FZ";
  if (c === "SG") return "Singapore Copyright Act 2021";
  if (c === "AE") return "UAE Federal Law No. 38/2021";
  return `Local copyright regime (${c}) — DMCA-style notice usually accepted by host`;
}

/** Ordered, human-readable takedown escalation path. */
export function buildTakedownPath(input: {
  hostingCompany: string | null;
  hostingAbuseEmail: string | null;
  registrar: string | null;
  registrarAbuseEmail: string | null;
  cdn: string | null;
  dmcaPageUrl: string | null;
}): string[] {
  const path: string[] = [];
  if (input.dmcaPageUrl) path.push("1. Site-level copyright/DMCA form");
  path.push(
    `${path.length + 1}. Hosting provider abuse desk${input.hostingCompany ? ` — ${input.hostingCompany}` : ""}`,
  );
  if (input.cdn && input.cdn.toLowerCase() !== "none") {
    path.push(`${path.length + 1}. CDN abuse report — ${input.cdn} (origin disclosure)`);
  }
  path.push(
    `${path.length + 1}. Domain registrar complaint${input.registrar ? ` — ${input.registrar}` : ""}`,
  );
  path.push(`${path.length + 1}. Search de-indexing request`);
  path.push(`${path.length + 1}. Escalate to legal counsel / local enforcement`);
  return path;
}

/** Trust score is the inverse of the threat score, floored for unreachable hosts. */
export function trustScoreFromThreat(threatScore: number, reachable: boolean): number {
  const base = Math.max(0, Math.min(100, 100 - threatScore));
  return reachable ? base : Math.min(base, 35);
}

/** Coarse threat category from investigation evidence. */
export function threatCategory(result: {
  downloadLinks: string[];
  fileHostLinks: string[];
  embeddedPlayers: string[];
  torrentIndicators: string[];
  classification: string | null;
}): string {
  if (result.torrentIndicators.length) return "Torrent / P2P distribution";
  if (result.downloadLinks.length || result.fileHostLinks.length) return "Unauthorized download";
  if (result.embeddedPlayers.length) return "Embedded unauthorized player";
  if (result.classification) return result.classification.replace(/_/g, " ").toLowerCase();
  return "Suspected unauthorized distribution";
}

export type SourceRole = "Origin" | "Mirror" | "Re-upload" | "Embedded Player";

/** Classify a detected source's role in the distribution network. */
export function sourceRole(input: {
  domain: string;
  embeddedPlayers?: string[];
  downloadLinks?: string[];
  isMirrorDomain?: boolean;
}): SourceRole {
  if (input.isMirrorDomain || /\d(?:\.|-)?(?:[a-z]{2,3})?$|mirror|proxy/i.test(input.domain)) {
    return "Mirror";
  }
  if ((input.embeddedPlayers ?? []).length) return "Embedded Player";
  if ((input.downloadLinks ?? []).length) return "Re-upload";
  return "Origin";
}

/** Threat gauge tone: green → yellow → orange → red. */
export function threatTone(score: number): {
  label: string;
  color: string;
  ring: string;
} {
  if (score >= 85) return { label: "Critical", color: "#ef4444", ring: "rgba(239,68,68,0.45)" };
  if (score >= 65) return { label: "High", color: "#f97316", ring: "rgba(249,115,22,0.4)" };
  if (score >= 40) return { label: "Elevated", color: "#eab308", ring: "rgba(234,179,8,0.35)" };
  return { label: "Low", color: "#22c55e", ring: "rgba(34,197,94,0.3)" };
}

/** Copy-ready enforcement contact block. */
export function enforcementContactBlock(intel: DomainIntel): string {
  const r = intel.removal;
  const lines = [
    `Target domain: ${r.domain}`,
    `URL: ${intel.url}`,
    `Threat score: ${intel.investigation.threatScore} (${intel.investigation.riskLevel})`,
    `Threat category: ${intel.threatCategory}`,
    "",
    `Hosting company: ${intelValue(r.hostingCompany)}`,
    `Hosting abuse email: ${intelValue(r.hostingAbuseEmail)}`,
    `Hosting abuse form: ${intelValue(r.hostingAbuseForm)}`,
    `Registrar: ${intelValue(r.registrar)}`,
    `Registrar abuse email: ${intelValue(r.registrarAbuseEmail)}`,
    `Registrar complaint URL: ${intelValue(r.registrarComplaintUrl)}`,
    `DMCA page: ${intelValue(r.dmcaPageUrl)}`,
    `Copyright complaint URL: ${intelValue(r.copyrightComplaintUrl)}`,
    `Legal contact: ${intelValue(r.legalContact)}`,
    `WHOIS contact: ${intelValue(r.whoisContact, { privacy: r.whoisPrivacy })}`,
    `Country jurisdiction: ${intelValue(r.country)}`,
    `Applicable regime: ${r.regime}`,
    "",
    "Estimated takedown path:",
    ...r.takedownPath.map((step) => `  ${step}`),
  ];
  return lines.join("\n");
}

/** Draft notice text — evidence preparation only, never auto-sent. */
export function draftLegalNotice(intel: DomainIntel, workTitle: string): string {
  const inv = intel.investigation;
  return [
    "NOTICE OF CLAIMED COPYRIGHT INFRINGEMENT (DRAFT — FOR REVIEW)",
    "",
    `Date prepared: ${new Date().toISOString()}`,
    `Protected work: ${workTitle}`,
    `Infringing URL: ${intel.url}`,
    `Host domain: ${intel.domain}`,
    `Hosting provider: ${intelValue(intel.removal.hostingCompany)}`,
    `Registrar: ${intelValue(intel.removal.registrar)}`,
    `Applicable regime: ${intel.removal.regime}`,
    "",
    "Evidence collected:",
    ...(inv.evidenceFindings.length
      ? inv.evidenceFindings.map((f) => `  • ${f}`)
      : ["  • Page reachable and matched to the protected work"]),
    inv.downloadLinks.length ? `  • Download endpoints observed: ${inv.downloadLinks.length}` : "",
    inv.embeddedPlayers.length
      ? `  • Embedded players observed: ${inv.embeddedPlayers.length}`
      : "",
    "",
    "The rights holder has a good-faith belief that the identified material is",
    "not authorized by the copyright owner, its agent, or the law.",
    "",
    "This draft must be reviewed and signed by authorized counsel before sending.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Rough centroids for map plotting (equirectangular, lon/lat degrees). */
const COUNTRY_COORDS: Record<string, [number, number]> = {
  US: [-98, 39],
  CA: [-106, 56],
  MX: [-102, 23],
  BR: [-51, -14],
  AR: [-64, -34],
  GB: [-2, 54],
  IE: [-8, 53],
  FR: [2, 46],
  DE: [10, 51],
  NL: [5, 52],
  BE: [4, 50],
  ES: [-4, 40],
  PT: [-8, 39],
  IT: [12, 42],
  CH: [8, 47],
  SE: [15, 62],
  NO: [8, 61],
  FI: [26, 64],
  DK: [10, 56],
  PL: [19, 52],
  CZ: [15, 50],
  RO: [25, 46],
  BG: [25, 43],
  GR: [22, 39],
  UA: [32, 49],
  RU: [90, 61],
  TR: [35, 39],
  IL: [35, 31],
  AE: [54, 24],
  SA: [45, 24],
  IN: [79, 22],
  PK: [69, 30],
  BD: [90, 24],
  LK: [81, 7],
  CN: [104, 35],
  HK: [114, 22],
  TW: [121, 24],
  JP: [138, 36],
  KR: [128, 36],
  SG: [104, 1],
  MY: [102, 4],
  ID: [113, -1],
  TH: [101, 15],
  VN: [106, 16],
  PH: [122, 12],
  AU: [134, -25],
  NZ: [174, -41],
  ZA: [24, -29],
  NG: [8, 9],
  EG: [30, 26],
  KE: [38, 0],
  MA: [-6, 32],
  SC: [55, -4],
  PA: [-80, 9],
  BZ: [-88, 17],
  VG: [-64, 18],
  KY: [-81, 19],
  CY: [33, 35],
  MD: [28, 47],
  KZ: [67, 48],
};

/** Map a country code to normalized [x, y] percentages for the threat map. */
export function countryToMapPoint(
  country: string | null | undefined,
): { x: number; y: number } | null {
  const code = (country ?? "").trim().toUpperCase().slice(0, 2);
  const coords = COUNTRY_COORDS[code];
  if (!coords) return null;
  const [lon, lat] = coords;
  return { x: ((lon + 180) / 360) * 100, y: ((90 - lat) / 180) * 100 };
}

/** Regional-indicator flag emoji from an ISO-3166 alpha-2 code. */
export function countryFlag(country: string | null | undefined): string {
  const code = (country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "🌐";
  return String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + (ch.charCodeAt(0) - 65)));
}

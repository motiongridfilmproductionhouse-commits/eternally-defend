/**
 * Module-specific query policies for Identity-Aware Search Expansion.
 * Risk/piracy terms are only injected into the relevant modules.
 */

import type { SearchModulePolicy } from "./identity-types";

export const REPUTATION_RISK_TERMS = [
  "fake",
  "impersonation",
  "edited photo",
  "deepfake",
  "scam",
  "controversy",
  "defamation",
] as const;

export const DEEPFAKE_RISK_TERMS = [
  "deepfake",
  "face swap",
  "fake nude",
  "AI nude",
  "morphed",
  "synthetic media",
  "impersonation",
] as const;

export const COPYRIGHT_FILM_TERMS = [
  "full movie",
  "watch online",
  "download",
  "CAM",
  "HDTS",
  "theatre print",
  "torrent",
  "Telegram",
] as const;

export function riskTermsForModule(module: SearchModulePolicy): readonly string[] {
  switch (module) {
    case "reputation":
    case "impersonation":
    case "monitoring":
      return REPUTATION_RISK_TERMS;
    case "deepfake":
      return DEEPFAKE_RISK_TERMS;
    default:
      return [];
  }
}

export function copyrightTermsForModule(module: SearchModulePolicy): readonly string[] {
  return module === "copyright" ? COPYRIGHT_FILM_TERMS : [];
}

export function allowsPlatformQueries(module: SearchModulePolicy): boolean {
  return module !== "copyright";
}

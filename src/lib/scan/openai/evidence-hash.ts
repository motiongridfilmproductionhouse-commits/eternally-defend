/**
 * Deterministic evidence hashing for AI analysis caching.
 * Identical evidence is never re-analyzed.
 */

import type { EvidencePacket } from "./types";

function stableString(packet: EvidencePacket): string {
  return [
    packet.canonical_url,
    packet.title,
    packet.platform,
    packet.published_date ?? "",
    packet.author ?? "",
    packet.entity_confidence,
    packet.identity_tier,
    packet.classifier_output,
    packet.passages,
  ].join("\u0001");
}

/** SHA-256 of the compact evidence packet (Web Crypto — Worker safe). */
export async function evidenceHash(packet: EvidencePacket): Promise<string> {
  const bytes = new TextEncoder().encode(stableString(packet));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

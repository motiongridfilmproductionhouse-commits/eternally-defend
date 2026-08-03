/**
 * Server-only domain enrichment for the Copyright Investigation Center.
 * Results are cached per domain so repeated lookups are not re-run.
 */

import { lookupInfrastructure } from "@/services/infrastructure";
import { resolveAbuseContact } from "@/lib/copyright/contacts.server";
import { normalizeInvestigationRecord } from "@/lib/investigation/website-investigation";
import {
  buildTakedownPath,
  copyrightRegime,
  threatCategory,
  trustScoreFromThreat,
  type DomainIntel,
  type RemovalIntelligence,
} from "@/lib/copyright/domain-intel";

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { intel: DomainIntel; at: number }>();

function cacheKey(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function pickContact(
  contacts: Array<{ email: string; category: string; confidence: number }>,
  categories: string[],
): string | null {
  const matches = contacts
    .filter((c) => categories.includes(c.category))
    .sort((a, b) => b.confidence - a.confidence);
  return matches[0]?.email ?? null;
}

function isPrivacyProtected(registrantOrEmail: string | null): boolean {
  if (!registrantOrEmail) return true;
  return /privacy|redact|withheld|protect|proxy|whoisguard|anonym/i.test(registrantOrEmail);
}

export async function enrichDomainIntel(
  url: string,
  opts?: { classification?: string | null; force?: boolean },
): Promise<DomainIntel> {
  const key = cacheKey(url);
  const hit = cache.get(key);
  if (hit && !opts?.force && Date.now() - hit.at < CACHE_TTL_MS) return hit.intel;

  const report = (await lookupInfrastructure(url)) as Record<string, unknown>;
  const investigation = normalizeInvestigationRecord(report, {
    classification: opts?.classification ?? null,
    fallbackUrl: url,
  });
  if (!investigation) throw new Error("Could not build domain intelligence for this source.");

  const abuse = resolveAbuseContact(url);
  const contactsResult = (report.contacts ?? {}) as {
    contacts?: Array<{ email: string; category: string; confidence: number }>;
    registrar?: string;
  };
  const contacts = Array.isArray(contactsResult.contacts) ? contactsResult.contacts : [];
  const providerRecord = (report.provider ?? {}) as Record<string, unknown>;
  const whoisRecord = (report.whois ?? {}) as Record<string, unknown>;
  const dnsRecord = (report.dns ?? {}) as Record<string, unknown>;

  const registrantCountry =
    typeof whoisRecord.registrantCountry === "string" ? whoisRecord.registrantCountry : null;
  const country = investigation.country ?? registrantCountry ?? null;

  const hostingAbuseEmail =
    (typeof providerRecord.abuseEmail === "string" ? providerRecord.abuseEmail : null) ??
    pickContact(contacts, ["abuse", "security"]);

  const registrarAbuseEmail =
    investigation.whoisAbuseEmail ?? pickContact(contacts, ["admin", "technical"]);

  const whoisContact = investigation.whoisAbuseEmail ?? registrantCountry;
  const whoisPrivacy = isPrivacyProtected(whoisContact);

  const removal: RemovalIntelligence = {
    domain: investigation.domain,
    hostingCompany: investigation.hostingProvider,
    hostingAbuseEmail,
    hostingAbuseForm:
      typeof providerRecord.copyrightForm === "string" ? providerRecord.copyrightForm : null,
    registrar: investigation.whoisRegistrar ?? contactsResult.registrar ?? null,
    registrarAbuseEmail,
    registrarComplaintUrl: investigation.whoisRegistrar
      ? `https://www.icann.org/wicf/?domain=${encodeURIComponent(investigation.domain)}`
      : null,
    dmcaPageUrl: abuse.reportUrl,
    copyrightComplaintUrl: abuse.reportUrl,
    legalContact: pickContact(contacts, ["legal", "copyright", "dmca"]) ?? abuse.abuseEmail,
    whoisContact,
    whoisPrivacy,
    country,
    jurisdiction: country ? `Hosted / registered in ${country}` : "Jurisdiction undetermined",
    regime: copyrightRegime(country),
    takedownPath: buildTakedownPath({
      hostingCompany: investigation.hostingProvider,
      hostingAbuseEmail,
      registrar: investigation.whoisRegistrar,
      registrarAbuseEmail,
      cdn: investigation.cdn,
      dmcaPageUrl: abuse.reportUrl,
    }),
    note: abuse.note,
  };

  const cnames = Array.isArray(dnsRecord.cname)
    ? (dnsRecord.cname as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  const intel: DomainIntel = {
    url,
    domain: investigation.domain,
    investigation,
    removal,
    trustScore: trustScoreFromThreat(investigation.threatScore, investigation.reachable),
    threatCategory: threatCategory(investigation),
    confidence:
      typeof report.confidence === "number" && Number.isFinite(report.confidence)
        ? Math.round(report.confidence)
        : investigation.reachable
          ? 85
          : 45,
    mirrorDomains: cnames,
    historicalDomains: [],
    reverseIpHost: typeof dnsRecord.cname === "string" ? (dnsRecord.cname as string) : null,
    cachedAt: new Date().toISOString(),
  };

  cache.set(key, { intel, at: Date.now() });
  return intel;
}

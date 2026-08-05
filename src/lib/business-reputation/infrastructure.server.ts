import dns from "node:dns/promises";

export type InfrastructureIntelligence = {
  domain: string;
  country: string | null;
  registrar: string | null;
  hosting_provider: string | null;
  asn: string | null;
  ip_addresses: string[];
  dns_provider: string | null;
  registrar_abuse_email: string | null;
  hosting_abuse_email: string | null;
  whois_data: Record<string, unknown> | null;
  unavailable_fields: Record<string, string>;
  dns: { addresses: string[]; nameservers: string[] };
  cdn: string | null;
  abuse_email: string | null;
  rdap_url: string | null;
  contact_page: string | null;
  resolved_at: string;
};

function hostFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function extractEmail(value: unknown): string | null {
  const text = JSON.stringify(value ?? "");
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function available(value: unknown): string | null {
  return typeof value === "string" &&
    value.trim() &&
    !/^(unknown|unavailable|n\/a)$/i.test(value.trim())
    ? value.trim()
    : null;
}

function vcardValue(entity: unknown, name: string): unknown {
  const rows = record(entity).vcardArray;
  if (!Array.isArray(rows) || !Array.isArray(rows[1])) return null;
  const row = rows[1].find((item) => Array.isArray(item) && item[0] === name);
  return Array.isArray(row) ? row[3] : null;
}

export async function resolveBusinessInfrastructure(
  url: string,
  options?: { fetch?: typeof fetch; lookup?: typeof dns.lookup; resolveNs?: typeof dns.resolveNs },
): Promise<InfrastructureIntelligence | null> {
  const domain = hostFromUrl(url);
  if (!domain) return null;
  if (!options?.fetch && !options?.lookup && !options?.resolveNs) {
    try {
      const { lookupInfrastructure } = await import("@/lib/investigation/lookup.server");
      const report = await lookupInfrastructure(url);
      const whois = record(report.whois);
      const provider = record(report.provider);
      const dns = record(report.dns);
      const contacts = record(report.contacts);
      const contactPages = Array.isArray(contacts.pagesScanned) ? contacts.pagesScanned : [];
      const nameservers = Array.isArray(dns.ns)
        ? dns.ns.filter((value): value is string => typeof value === "string")
        : [];
      const addresses = [dns.ipv4, dns.ipv6].filter(
        (value): value is string => typeof value === "string",
      );
      const unavailable_fields: Record<string, string> = {};
      const values = {
        registrar: available(whois.registrar),
        hosting_provider: available(provider.name),
        asn: available(provider.asn),
        country: available(provider.country),
        contact_page: available(
          contactPages.find(
            (page) => typeof page === "string" && /contact|support|help/i.test(page),
          ),
        ),
      };
      const cdnReport = record(report.cdn);
      for (const [key, value] of Object.entries(values))
        if (!value) unavailable_fields[key] = "Not publicly available or provider lookup failed";
      return {
        domain,
        country: values.country,
        registrar: values.registrar,
        hosting_provider: values.hosting_provider,
        asn: values.asn,
        ip_addresses: addresses,
        dns_provider: nameservers[0]?.split(".").slice(-2).join(".") || null,
        registrar_abuse_email: available(whois.abuseEmail),
        hosting_abuse_email: available(provider.abuseEmail),
        whois_data: Object.keys(whois).length ? whois : null,
        unavailable_fields,
        dns: { addresses, nameservers },
        cdn:
          typeof cdnReport.provider === "string" && cdnReport.provider !== "None"
            ? cdnReport.provider
            : null,
        abuse_email: available(whois.abuseEmail) || available(provider.abuseEmail),
        rdap_url: `https://rdap.org/domain/${domain}`,
        contact_page: values.contact_page,
        resolved_at: new Date().toISOString(),
      };
    } catch {
      /* Fall through to the bounded direct lookup path. */
    }
  }
  const fetcher = options?.fetch || fetch;
  const lookup = options?.lookup || dns.lookup;
  const resolveNs = options?.resolveNs || dns.resolveNs;
  let addresses: string[] = [];
  let nameservers: string[] = [];
  try {
    addresses = (await lookup(domain, { all: true })).map((x) => x.address);
  } catch {
    /* best effort */
  }
  try {
    nameservers = await resolveNs(domain);
  } catch {
    /* best effort */
  }
  let registrar: string | null = null;
  let country: string | null = null;
  let abuse_email: string | null = null;
  let registrar_abuse_email: string | null = null;
  let hosting_provider: string | null = null;
  let asn: string | null = null;
  let whois_data: Record<string, unknown> | null = null;
  let rdap_url: string | null = null;
  try {
    rdap_url = `https://rdap.org/domain/${domain}`;
    const response = await fetcher(rdap_url, { signal: AbortSignal.timeout(5_000) });
    if (response.ok) {
      const body = record(await response.json());
      whois_data = body;
      const entities = Array.isArray(body.entities) ? body.entities : [];
      const withRole = (role: string) =>
        entities.find((entity) => (record(entity).roles as unknown[] | undefined)?.includes(role));
      registrar = available(vcardValue(withRole("registrar"), "fn") || body.port43);
      const address = vcardValue(withRole("registrant"), "adr");
      country = Array.isArray(address) ? String(address[6] || "") || null : null;
      abuse_email = extractEmail(withRole("abuse") || entities);
      registrar_abuse_email = abuse_email;
    }
  } catch {
    /* best effort */
  }
  const ip_addresses = addresses;
  const dns_provider =
    nameservers[0]
      ?.replace(/^ns\d*\./i, "")
      .split(".")
      .slice(-2)
      .join(".") || null;
  if (ip_addresses[0]) {
    try {
      const response = await fetcher(`https://api.bgpview.io/ip/${ip_addresses[0]}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        const body = record(await response.json());
        const data = record(body.data);
        const prefixes = Array.isArray(data.prefixes) ? data.prefixes : [];
        const first = record(prefixes[0]);
        const asnValue = record(first.asn);
        asn = asnValue.asn != null ? `AS${String(asnValue.asn)}` : null;
        hosting_provider = typeof asnValue.name === "string" ? asnValue.name : null;
      }
    } catch {
      /* public IP intelligence is best effort */
    }
  }
  const contact_page = await findContactPage(url, fetcher);
  const unavailable_fields: Record<string, string> = {};
  for (const [key, value] of Object.entries({
    registrar,
    rdap_url,
    hosting_provider,
    asn,
    registrar_abuse_email,
    hosting_abuse_email: null,
    country,
    contact_page,
  })) {
    if (!value) unavailable_fields[key] = "Not publicly available or provider lookup failed";
  }
  let cdn: string | null = null;
  try {
    const response = await fetcher(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(5_000),
    });
    const headers = [...response.headers.entries()]
      .map(([key, value]) => `${key}:${value}`)
      .join(" ")
      .toLowerCase();
    if (/cloudflare|cf-ray/.test(headers)) cdn = "Cloudflare";
    else if (/fastly/.test(headers)) cdn = "Fastly";
    else if (/akamai/.test(headers)) cdn = "Akamai";
  } catch {
    /* best effort */
  }
  return {
    domain,
    country,
    registrar,
    hosting_provider,
    asn,
    ip_addresses,
    dns_provider,
    registrar_abuse_email,
    hosting_abuse_email: null,
    whois_data,
    unavailable_fields,
    dns: { addresses, nameservers },
    cdn,
    abuse_email,
    rdap_url,
    contact_page,
    resolved_at: new Date().toISOString(),
  };
}

async function findContactPage(url: string, fetcher: typeof fetch): Promise<string | null> {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const html = (await response.text()).slice(0, 500_000);
    const match = html.match(/href=["']([^"']*(?:contact|support|help)[^"']*)["']/i);
    if (!match?.[1]) return null;
    return new URL(match[1], url).toString();
  } catch {
    return null;
  }
}

import { lookupDNS } from "./dns";
import { lookupRDAP } from "./rdap";
import { lookupWhois } from "./whois";
import { lookupHTTP } from "./http";
import { detectCDN } from "./cdn";
import { detectProvider } from "./provider";
import { calculateRisk } from "./risk";
import { analyzePage } from "../investigation/page";
import { discoverContacts } from "./contacts";

export async function lookupInfrastructure(url: string) {
  const hostname = new URL(url).hostname;

  const [dns, rdap, whois, http, page, contacts] = await Promise.all([
    lookupDNS(hostname),
    lookupRDAP(hostname),
    lookupWhois(hostname),
    lookupHTTP(url),
    analyzePage(url),
    discoverContacts(url),
  ]);

  const cdn = detectCDN(new Headers(http.headers), dns.ns ?? []);
  const provider = detectProvider(dns.ipv4, cdn, http.headers);
  const risk = calculateRisk({
    cdn,
    provider,
    http,
  });

  return {
    url,
    hostname,
    dns,
    rdap,
    whois,
    http,
    cdn,
    provider,
    risk,
    page,
    contacts,
  };
}

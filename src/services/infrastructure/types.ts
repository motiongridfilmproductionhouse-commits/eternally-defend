/**
 * Infrastructure Intelligence Types
 * Eterna AI
 */

export interface DnsResult {
  hostname: string;
  ipv4?: string;
  ipv6?: string;
  cname?: string[];
  ns?: string[];
  mx?: string[];
}

export interface IpResult {
  ip: string;
  country?: string;
  city?: string;
  region?: string;

  org?: string;
  isp?: string;
  asn?: string;

  hostname?: string;
}

export interface WhoisResult {
  registrar?: string;

  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;

  abuseEmail?: string;

  nameservers?: string[];

  registrantCountry?: string;
}

export type CdnProvider =
  | "Cloudflare"
  | "Fastly"
  | "CloudFront"
  | "Akamai"
  | "BunnyCDN"
  | "Azure Front Door"
  | "Sucuri"
  | "None";

export interface CdnResult {
  provider: CdnProvider;
  detected: boolean;
  source: "header" | "dns" | "ip" | "unknown";
}

export interface ProviderResult {
  name: string;

  organization?: string;

  country?: string;

  asn?: string;

  abuseEmail?: string;

  copyrightForm?: string;
}

export interface RiskScore {
  score: number;

  level: "Low" | "Medium" | "High" | "Critical";

  reasons: string[];
}

export interface InfrastructureReport {
  url: string;

  domain: string;

  dns?: DnsResult;

  ip?: IpResult;

  whois?: WhoisResult;

  cdn?: CdnResult;

  provider?: ProviderResult;

  risk?: RiskScore;

  confidence: number;

  scannedAt: string;
}

export interface LookupOptions {
  timeout?: number;

  retries?: number;

  userAgent?: string;
}

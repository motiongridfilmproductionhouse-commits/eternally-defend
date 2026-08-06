import { whoisDomain } from "whoiser";
import { WhoisResult } from "./types";

export async function lookupWhois(domain: string): Promise<WhoisResult> {
  try {
    const result = await whoisDomain(domain);

    const record = Object.values(result)[0] as any;

    return {
      registrar: record?.registrar || record?.Registrar || "Unknown",

      createdAt: record?.creationDate || record?.CreationDate,

      updatedAt: record?.updatedDate || record?.UpdatedDate,

      expiresAt: record?.registryExpiryDate || record?.RegistryExpiryDate,

      abuseEmail: record?.abuseContactEmail || record?.RegistrarAbuseContactEmail,

      nameservers: Array.isArray(record?.nameServer)
        ? record.nameServer
        : Array.isArray(record?.NameServer)
          ? record.NameServer
          : [],
    };
  } catch (error) {
    console.warn("WHOIS lookup failed:", error);

    return {
      registrar: "Unknown",
      createdAt: undefined,
      updatedAt: undefined,
      expiresAt: undefined,
      abuseEmail: undefined,
      nameservers: [],
    };
  }
}

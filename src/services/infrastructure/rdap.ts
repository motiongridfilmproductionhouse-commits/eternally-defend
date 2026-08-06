import { WhoisResult } from "./types";

export async function lookupRDAP(domain: string): Promise<WhoisResult> {
  try {
    const response = await fetch(`https://rdap.org/domain/${domain}`);

    if (!response.ok) {
      return {
        registrar: "Unknown",
        nameservers: [],
      };
    }

    const data = await response.json();

    return {
      registrar: data.registrarName ?? "Unknown",
      nameservers: data.nameservers?.map((ns: any) => ns.ldhName) ?? [],
    };
  } catch {
    return {
      registrar: "Unknown",
      nameservers: [],
    };
  }
}

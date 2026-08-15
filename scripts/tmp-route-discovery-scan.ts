import { discoverOnDomainCopyrightContact } from "@/lib/enforcement/contact-discovery.server";
const hosts = ["deephot.link","desifakes.com","bollywoodmaal.com","heroine-xxx.com","actressx.com","sexcelebrity.net","pornkeen.net","sexbaba.co","imgfy.net","fapello.com","xxxbp.tv","kompoz2.com","celebritydeeplink.com","sexdug.net","buleporn.com","flirttendre.com"];
for (const h of hosts) {
  const r = await discoverOnDomainCopyrightContact(`https://${h}/`);
  console.log(JSON.stringify({ host: h, found: r.found, candidate: r.candidate?.email ?? null, source: r.candidate?.sourceUrl ?? null, pages: r.pagesInspected.length, rejected: r.rejected.map(x=>x.email).slice(0,4), skipped: r.skippedReason }));
}

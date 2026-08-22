import { generateDeepfakeQueries } from "../../src/lib/deepfake/query-generator.server.ts";
import { isBlockedHost } from "../../src/lib/deepfake/queries.ts";

const target = {
  name: "Maya Kapoor",
  aliases: ["M Kapoor", "Maya K"],
  handles: ["@mayakapoor"],
};

const queries = generateDeepfakeQueries(target);

let wasted = 0;
const wastedSamples = [];
for (const q of queries) {
  const match = q.match(/site:([a-zA-Z0-9.-]+)/);
  if (match && isBlockedHost(match[1])) {
    wasted += 1;
    if (wastedSamples.length < 5) wastedSamples.push(q);
  }
}

console.log(
  JSON.stringify(
    {
      total_queries: queries.length,
      structurally_wasted_blocked_host_queries: wasted,
      wasted_samples: wastedSamples,
      sample_queries: queries.slice(0, 10),
    },
    null,
    2,
  ),
);

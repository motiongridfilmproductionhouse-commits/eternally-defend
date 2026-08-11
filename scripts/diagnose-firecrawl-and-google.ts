import fs from "node:fs";
import path from "node:path";
import { firecrawlEnvironmentDiagnostic, firecrawlFetch } from "../src/lib/firecrawl-client.server";
import { buildGoogleImagesInvestigationQueries } from "../src/lib/deepfake/google-images-queries.server";
import { firecrawlSearch } from "../src/lib/deepfake/firecrawl.server";

// Auto-load env files if needed
function loadEnvFiles() {
  const envFiles = [".env.local", ".env.production", ".env.preview", ".env"];
  for (const file of envFiles) {
    const filePath = path.resolve(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}

loadEnvFiles();

async function diagnoseProviders() {
  console.log("==================================================");
  console.log("1. FIRECRAWL ENVIRONMENT DIAGNOSTIC");
  console.log("==================================================");
  const diag = firecrawlEnvironmentDiagnostic();
  console.log("Firecrawl Config Diagnostic:", JSON.stringify(diag, null, 2));

  console.log("\n==================================================");
  console.log("2. CONTROLLED FIRECRAWL DIAGNOSTIC SEARCHES");
  console.log("==================================================");

  const testQueries = [
    'desifakes.com',
    'site:desifakes.com deepfake',
    'site:desifakes.com "Mamitha Baiju"',
    'imgfy.net',
    'site:imgfy.net "Mamitha Baiju"',
    '"Mamitha Baiju" deepfake',
  ];

  for (const q of testQueries) {
    console.log(`\n--- TESTING QUERY: ${q} ---`);
    try {
      const resp = await firecrawlFetch("/search", {
        query: q,
        limit: 5,
      });

      console.log(`HTTP Status: ${resp.status} ${resp.statusText}`);
      const text = await resp.text();
      console.log("Raw Response Length:", text.length);

      try {
        const json = JSON.parse(text);
        console.log("Response JSON Structure:");
        console.log("  success:", json.success);
        console.log("  error:", json.error ?? "none");
        if (json.data) {
          if (Array.isArray(json.data)) {
            console.log(`  data: Array [length = ${json.data.length}]`);
            if (json.data.length > 0) {
              console.log("  First Item Keys:", Object.keys(json.data[0]));
              console.log("  Sample Item 0:", JSON.stringify(json.data[0], null, 2));
            }
          } else {
            console.log("  data keys:", Object.keys(json.data));
            if (json.data.web) console.log(`  data.web: Array [length = ${json.data.web.length}]`);
            if (json.data.images) console.log(`  data.images: Array [length = ${json.data.images.length}]`);
            if (json.data.web && json.data.web.length > 0) {
              console.log("  Sample web item 0:", JSON.stringify(json.data.web[0], null, 2));
            }
          }
        } else {
          console.log("  json response:", JSON.stringify(json, null, 2).slice(0, 500));
        }

        // Also test firecrawlSearch function mapping
        const hits = await firecrawlSearch(q, 5);
        console.log(`Parsed firecrawlSearch hits count: ${hits.length}`);
        if (hits.length > 0) {
          console.log("  First hit URL:", hits[0].url);
          console.log("  First hit Title:", hits[0].title);
        }
      } catch (pe) {
        console.error("JSON parse error:", pe);
        console.log("Raw body text preview:", text.slice(0, 500));
      }
    } catch (err) {
      console.error(`Fetch error for "${q}":`, err instanceof Error ? err.message : String(err));
    }
  }

  console.log("\n==================================================");
  console.log("3. GOOGLE IMAGES INVESTIGATION DIAGNOSTIC");
  console.log("==================================================");
  const googleQueries = buildGoogleImagesInvestigationQueries({ name: "Mamitha Baiju" });
  console.log(`Google Images queries generated (${googleQueries.length}):`);
  console.log("First 5:", googleQueries.slice(0, 5));
}

diagnoseProviders().catch(console.error);

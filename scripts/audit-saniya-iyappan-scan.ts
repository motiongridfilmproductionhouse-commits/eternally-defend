import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFiles() {
  const envFiles = [".env", ".env.production", ".env.preview", ".env.local"];
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
          if (val.includes("[SENSITIVE]")) continue;
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  }
}

loadEnvFiles();

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(url, key);

async function auditSaniyaIyappanScan() {
  console.log("==================================================");
  console.log("AUDITING SANIYA IYAPPAN SCAN & DISCOVERIES");
  console.log("==================================================");

  const { data: scans, error: sErr } = await supabase
    .from("deepfake_scans")
    .select("*")
    .ilike("target_name", "%saniya%")
    .order("created_at", { ascending: false });

  if (sErr) {
    console.error("Scan query error:", sErr.message);
    return;
  }

  console.log(`Found ${scans?.length ?? 0} scans for target "saniya iyappan":`);
  scans?.forEach((s) => {
    console.log(`  ID: ${s.id} | Status: ${s.status} | Created: ${s.created_at} | Results: ${s.total_results}`);
  });

  const latestScan = scans?.[0];
  if (!latestScan) {
    console.log("No scans found.");
    return;
  }

  console.log(`\n--- LATEST SCAN DETAILS (${latestScan.id}) ---`);
  console.log("Status:", latestScan.status);
  console.log("Error / Telemetry:", latestScan.error_message?.slice(0, 500));

  const { data: discoveries, error: dErr } = await supabase
    .from("deepfake_discoveries")
    .select("*")
    .eq("scan_id", latestScan.id);

  console.log(`\nFound ${discoveries?.length ?? 0} discovery rows in deepfake_discoveries table:`);
  if (discoveries && discoveries.length > 0) {
    const statusCounts: Record<string, number> = {};
    discoveries.forEach((d) => {
      const st = d.analysis_status || "null";
      statusCounts[st] = (statusCounts[st] || 0) + 1;
    });
    console.log("  Analysis Status breakdown:", JSON.stringify(statusCounts));

    console.log("\nSample 10 Discoveries:");
    discoveries.slice(0, 10).forEach((d, idx) => {
      console.log(`  ${idx + 1}. [${d.analysis_status}] ${d.page_title || d.page_url}`);
      console.log(`     URL: ${d.page_url}`);
      console.log(`     Query: ${d.search_query}`);
    });
  }

  const { data: findings, error: fErr } = await supabase
    .from("deepfake_findings")
    .select("*")
    .eq("scan_id", latestScan.id);

  console.log(`\nFound ${findings?.length ?? 0} findings in deepfake_findings table:`);
  findings?.forEach((f, idx) => {
    console.log(`  ${idx + 1}. [${f.finding_classification}] ${f.page_title || f.canonical_url}`);
    console.log(`     URL: ${f.canonical_url}`);
    console.log(`     Confidence: ${f.identity_confidence} | Review Status: ${f.review_status}`);
  });
}

auditSaniyaIyappanScan().catch(console.error);

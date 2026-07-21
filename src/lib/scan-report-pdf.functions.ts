import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Hit = z.object({
  title:z.string(),url:z.string(),description:z.string().nullish(),platform:z.string(),source:z.string(),author:z.string().nullish(),published:z.string().nullish(),category:z.string(),contentLabel:z.string(),severity:z.string(),sentiment:z.string(),threatScore:z.number(),credibilityScore:z.number(),reachEstimate:z.number(),engagement:z.number(),detectionReason:z.string().nullish(),recommendedAction:z.string(),discoveredAt:z.string().nullish(),thumbnailUrl:z.string().nullish(),
});
const Input=z.object({subject:z.string().min(1).max(240),period:z.string(),generatedAt:z.string(),reputationScore:z.number(),reputationLevel:z.string(),headline:z.string(),totals:z.object({unique:z.number(),critical:z.number(),high:z.number(),negative:z.number(),viral:z.number(),totalReach:z.number()}),sources:z.array(z.string()).max(40),immediateActions:z.array(z.string()).max(30),longTerm:z.array(z.string()).max(30),hits:z.array(Hit).max(300)});

export const generateScanReportPdf=createServerFn({method:"POST"})
  .middleware([requireSupabaseAuth])
  .inputValidator((data:unknown)=>Input.parse(data))
  .handler(async({data})=>{
    const {buildScanReportPdf}=await import("./scan-report-pdf.server");
    const out=await buildScanReportPdf(data);
    return {fileName:("Eterna-Evidence-Report-"+out.reportId+".pdf"),base64:Buffer.from(out.bytes).toString("base64"),reportId:out.reportId,sha256:out.hash};
  });

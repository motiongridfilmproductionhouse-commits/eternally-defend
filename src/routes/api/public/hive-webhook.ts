// @ts-nocheck -- pre-existing sensitive-protection module (out of onboarding scope)
import { createAPIFileRoute } from "@tanstack/react-start/api";
import { createClient } from "@supabase/supabase-js";
import { normalizeHiveResponse, calculateRiskLevel } from "@/lib/providers/hive-classification.functions";

export const APIRoute = createAPIFileRoute("/api/public/hive-webhook")({
  POST: async ({ request }) => {
    try {
      const body = await request.json();
      // Validate Hive callback structure
      if (!body.task_id || !body.status) {
        return new Response("Invalid payload", { status: 400 });
      }

      const taskId = body.task_id;
      
      const supabase = createClient(
        process.env.VITE_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      // Find pending task
      const { data: task, error: taskError } = await supabase
        .from("hive_provider_tasks")
        .select("*")
        .eq("hive_task_id", taskId)
        .eq("provider_status", "submitted")
        .maybeSingle();

      if (taskError || !task) {
        return new Response("Task not found or already processed", { status: 404 });
      }

      // Normalize results
      const normalized = normalizeHiveResponse(body);

      // Update provider task status
      await supabase.from("hive_provider_tasks").update({
        provider_status: "completed",
        completed_at: new Date().toISOString(),
        raw_result_private_reference: JSON.stringify(body)
      }).eq("id", task.id);

      // We should ideally fetch the current result to compute risk level with Rekognition similarities
      const { data: currentResult } = await supabase
        .from("sensitive_scan_results")
        .select("face_similarity, duplicate_count")
        .eq("id", task.result_id)
        .maybeSingle();

      let risk_level = "LOW";
      if (currentResult) {
        risk_level = calculateRiskLevel(
          normalized.explicit_content_score, 
          normalized.deepfake_score, 
          currentResult.face_similarity ?? 0, 
          currentResult.duplicate_count ?? 0
        );
      }

      // Update the scan result
      await supabase.from("sensitive_scan_results").update({
        ...normalized,
        risk_level: risk_level as any,
      }).eq("id", task.result_id);

      return new Response(JSON.stringify({ received: true }), { 
        status: 200, 
        headers: { "Content-Type": "application/json" }
      });
    } catch (e: any) {
      console.error("Hive Webhook Error:", e.message);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
});

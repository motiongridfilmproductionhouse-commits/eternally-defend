import { createFileRoute } from "@tanstack/react-router";

// Optional scheduler recovery for requests interrupted before their background work completes.
// Reuses the platform's existing worker credential conventions; never accepts public jobs.
export const Route = createFileRoute("/api/public/hooks/agent-assessments")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizeCronRequest, cronAuthResponse, requireTrustedRuntime } =
          await import("@/lib/protection/cron-auth.server");
        const runtime = requireTrustedRuntime();
        if (!runtime.ok) return runtime.response;
        const auth = await authorizeCronRequest(request, {
          jobName: "agent-assessments",
          envSecrets: [process.env.AGENT_ASSESSMENT_WORKER_SECRET],
        });
        if (!auth.ok) return cronAuthResponse(auth);
        const { db, runAssessment } = await import("@/lib/agent/assessment.server");
        const { error } = await db
          .from("agent_assessments")
          .update({
            status: "FAILED",
            pricing: null,
            stage: "Scan interrupted",
            reason: "Scan interrupted. Please try again.",
          })
          .in("status", ["SCANNING", "ANALYZING"])
          .lt("updated_at", new Date(Date.now() - 180000).toISOString());
        if (error) return Response.json({ error: "Recovery unavailable" }, { status: 503 });
        const { data, error: readError } = await db
          .from("agent_assessments")
          .select("id")
          .eq("status", "QUEUED")
          .order("created_at")
          .limit(5);
        if (readError) return Response.json({ error: "Queue unavailable" }, { status: 503 });
        await Promise.all((data ?? []).map((row) => runAssessment(row.id)));
        return Response.json({ processed: data?.length ?? 0 });
      },
    },
  },
});

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { lookupInfrastructure } from "@/lib/investigation/lookup.server";
import {
  normalizeInvestigationRecord,
  normalizeInvestigationResponse,
} from "@/lib/investigation/website-investigation";

type InvestigationJobRecord = {
  status: "pending" | "completed" | "failed";
  investigation?: ReturnType<typeof normalizeInvestigationRecord>;
  error?: string;
  createdAt: number;
};

const investigationJobs = new Map<string, InvestigationJobRecord>();

function pruneOldJobs(): void {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of investigationJobs) {
    if (job.createdAt < cutoff) investigationJobs.delete(id);
  }
}

/** Legacy entry point — returns normalized investigation payload. */
export const investigateUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ url: z.string().url() }).parse(data))
  .handler(async ({ data }) => {
    const report = await lookupInfrastructure(data.url);
    const investigation = normalizeInvestigationRecord(report, {
      fallbackUrl: data.url,
    });
    if (!investigation) {
      throw new Error("Could not normalize investigation report.");
    }
    return { investigation };
  });

export const runWebsiteInvestigation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        url: z.string().url(),
        classification: z.string().optional(),
        async: z.boolean().optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    pruneOldJobs();

    if (data.async) {
      const jobId = crypto.randomUUID();
      investigationJobs.set(jobId, {
        status: "pending",
        createdAt: Date.now(),
      });

      void (async () => {
        try {
          const report = await lookupInfrastructure(data.url);
          const investigation = normalizeInvestigationRecord(report, {
            classification: data.classification ?? null,
            fallbackUrl: data.url,
          });
          if (!investigation) {
            investigationJobs.set(jobId, {
              status: "failed",
              error: "Could not normalize investigation report.",
              createdAt: Date.now(),
            });
            return;
          }
          investigationJobs.set(jobId, {
            status: "completed",
            investigation,
            createdAt: Date.now(),
          });
        } catch (error) {
          investigationJobs.set(jobId, {
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
            createdAt: Date.now(),
          });
        }
      })();

      return { jobId, status: "pending" as const };
    }

    const report = await lookupInfrastructure(data.url);
    const investigation = normalizeInvestigationRecord(report, {
      classification: data.classification ?? null,
      fallbackUrl: data.url,
    });
    if (!investigation) {
      throw new Error("Could not normalize investigation report.");
    }

    return { investigation };
  });

export const getWebsiteInvestigation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ jobId: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => {
    pruneOldJobs();
    const job = investigationJobs.get(data.jobId);
    if (!job) {
      return { status: "failed" as const, error: "Investigation job not found." };
    }

    if (job.status === "pending") {
      return { jobId: data.jobId, status: "pending" as const };
    }

    if (job.status === "failed") {
      return { status: "failed" as const, error: job.error ?? "Investigation failed." };
    }

    return {
      status: "completed" as const,
      investigation: job.investigation,
    };
  });

/** Test helper — normalize without running lookup. */
export function normalizeWebsiteInvestigationResponse(response: unknown) {
  return normalizeInvestigationResponse(response);
}

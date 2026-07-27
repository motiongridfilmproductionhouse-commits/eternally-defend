import { z } from "zod";

const schema = z.object({
  ETERNA_HOOK_URL: z.string().url(),
  AUTOMATION_WORKER_SECRET: z.string().min(32),
  WORKER_ID: z.string().default("worker-1"),
  PROFILE_DIR: z.string().default("./.profiles"),
  PORT: z.coerce.number().default(8080),
});

export const config = schema.parse(process.env);

export const RETRY = { maxAttempts: 3, initialDelayMs: 5_000, backoffFactor: 2 };
export const TIMEOUTS = {
  navigationMs: 30_000,
  uploadMs: 60_000,
  totalJobMs: 10 * 60_000,
};

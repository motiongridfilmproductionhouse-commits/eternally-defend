import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import pino from "pino";
import { config } from "./config.js";
import { runJob } from "./runner.js";

const log = pino({ name: "enforcement-worker" });

function verify(body: string, ts: string | null, sig: string | null): boolean {
  if (!ts || !sig) return false;
  const tsn = Number(ts);
  if (!Number.isFinite(tsn) || Math.abs(Date.now() - tsn) > 5 * 60 * 1000) return false;
  const expected = createHmac("sha256", config.AUTOMATION_WORKER_SECRET).update(`${tsn}.${body}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, workerId: config.WORKER_ID }));
    return;
  }
  if (req.method === "POST" && req.url === "/run") {
    const body = await readBody(req);
    const ok = verify(body, req.headers["x-eterna-timestamp"] as string | undefined ?? null, req.headers["x-eterna-signature"] as string | undefined ?? null);
    if (!ok) {
      res.writeHead(401);
      res.end("Invalid signature");
      return;
    }
    let jobId: string | null = null;
    try {
      jobId = JSON.parse(body).job_id;
    } catch {
      /* ignore */
    }
    if (!jobId) {
      res.writeHead(400);
      res.end("Missing job_id");
      return;
    }
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify({ accepted: true, job_id: jobId }));

    runJob(jobId).catch((e) => log.error({ err: e }, "runJob failed"));
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

server.listen(config.PORT, () => {
  log.info({ port: config.PORT, workerId: config.WORKER_ID }, "Eterna enforcement worker listening");
});

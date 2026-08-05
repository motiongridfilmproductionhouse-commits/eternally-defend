export interface Env {
  BUSINESS_REPUTATION_RECOVERY_URL: string;
  COPYRIGHT_SCAN_WORKER_SECRET: string;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function sign(secret: string, body: string, timestamp: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)),
  );
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const body = JSON.stringify({ sweep: true });
    const timestamp = String(Date.now());
    const signature = await sign(env.COPYRIGHT_SCAN_WORKER_SECRET, body, timestamp);
    const response = await fetch(env.BUSINESS_REPUTATION_RECOVERY_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-eterna-timestamp": timestamp,
        "x-eterna-signature": signature,
      },
      body,
    });
    if (!response.ok) throw new Error(`Business recovery endpoint returned ${response.status}`);
  },
};

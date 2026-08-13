import { createHash, randomInt } from "crypto";

export type OtpDeliveryStatus = "SENT" | "UNAVAILABLE" | "FAILED";

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtpCode(userId: string, email: string, code: string): string {
  return createHash("sha256")
    .update(`${userId}:${email.trim().toLowerCase()}:${code}`)
    .digest("hex");
}

/**
 * Sends the business-email verification code through the configured
 * transactional provider. When no provider is configured the OTP is still
 * recorded, delivery is reported as UNAVAILABLE, and the company stays in
 * AUTHORITY_PENDING (monitoring allowed, enforcement blocked).
 */
export async function deliverCompanyOtpEmail(params: {
  to: string;
  code: string;
  companyName: string;
}): Promise<{ status: OtpDeliveryStatus; error?: string }> {
  const token = process.env["POSTMARK_SERVER_TOKEN"];
  const from = process.env["POSTMARK_FROM_EMAIL"];
  if (!token || !from) return { status: "UNAVAILABLE" };

  try {
    const response = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Postmark-Server-Token": token,
      },
      body: JSON.stringify({
        From: from,
        To: params.to,
        Subject: "Verify your business email — Eterna Sentinel",
        TextBody: [
          `Verification code: ${params.code}`,
          "",
          `Use this code to verify the business email for ${params.companyName}.`,
          "The code expires in 10 minutes. If you did not request it, ignore this message.",
        ].join("\n"),
        MessageStream: "outbound",
      }),
    });
    if (!response.ok) {
      return { status: "FAILED", error: `Provider responded ${response.status}` };
    }
    return { status: "SENT" };
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message : "send failed" };
  }
}

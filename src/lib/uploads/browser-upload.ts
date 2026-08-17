/**
 * The single browser upload contract used by BOTH single and bulk protection.
 *
 * prepareAssetUpload -> presigned PUT url (+ exact required headers)
 *   -> browser PUT with exactly those headers, nothing unsignable
 *   -> wait for S3 200
 *   -> register / fingerprint
 *
 * Never add extra headers here: any header not covered by the signature makes
 * S3 answer 403 SignatureDoesNotMatch.
 */

export type UploadStage =
  | "PRESIGN_FAILED"
  | "CORS_BLOCKED"
  | "S3_UPLOAD_FAILED"
  | "SIGNATURE_MISMATCH"
  | "INGEST_FAILED"
  | "FINGERPRINT_FAILED";

const FRIENDLY: Record<UploadStage, string> = {
  PRESIGN_FAILED: "Could not start the upload. Please try again.",
  CORS_BLOCKED: "The upload was blocked by the browser before it reached storage.",
  S3_UPLOAD_FAILED: "The file could not be uploaded. Please try again.",
  SIGNATURE_MISMATCH: "The upload authorization expired. Please try again.",
  INGEST_FAILED: "The file uploaded but could not be registered.",
  FINGERPRINT_FAILED: "The file was stored but fingerprinting failed.",
};

export class UploadError extends Error {
  constructor(
    readonly stage: UploadStage,
    /** Safe, credential-free reason for logs. */
    readonly reason: string,
  ) {
    super(FRIENDLY[stage]);
    this.name = "UploadError";
  }
}

/** Safe log line: never includes the presigned URL, key query params or credentials. */
function logStage(stage: UploadStage | "OK", info: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.info(
    JSON.stringify({ scope: "asset_upload", stage, at: new Date().toISOString(), ...info }),
  );
}

export type PreparedUpload = { key: string; uploadUrl: string; headers?: Record<string, string> };

export async function uploadViaPresignedUrl(
  file: File,
  prepare: (input: { fileName: string; contentType: string; size: number }) => Promise<PreparedUpload>,
): Promise<{ key: string }> {
  const base = { name: file.name, size: file.size, type: file.type };

  let prepared: PreparedUpload;
  try {
    prepared = await prepare({ fileName: file.name, contentType: file.type, size: file.size });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown presign failure";
    logStage("PRESIGN_FAILED", { ...base, reason });
    throw new UploadError("PRESIGN_FAILED", reason);
  }

  // Exactly the signed headers — Content-Type only — and no credentials/mode overrides.
  const headers: Record<string, string> = prepared.headers ?? { "Content-Type": file.type };

  let put: Response;
  try {
    put = await fetch(prepared.uploadUrl, { method: "PUT", headers, body: file });
  } catch (error) {
    // A thrown fetch on a cross-origin PUT is a CORS/preflight/network block.
    const reason = error instanceof Error ? error.message : "network failure";
    logStage("CORS_BLOCKED", { ...base, origin: window.location.origin, reason });
    throw new UploadError("CORS_BLOCKED", reason);
  }

  if (!put.ok) {
    const body = await put.text().catch(() => "");
    const signature = put.status === 403 || /SignatureDoesNotMatch/i.test(body);
    const stage: UploadStage = signature ? "SIGNATURE_MISMATCH" : "S3_UPLOAD_FAILED";
    logStage(stage, { ...base, status: put.status, reason: body.slice(0, 200) });
    throw new UploadError(stage, `s3 ${put.status}`);
  }

  logStage("OK", { ...base, key: prepared.key });
  return { key: prepared.key };
}

/** Wraps the register/fingerprint call so its failures are classified too. */
export async function registerUploadedAsset<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown ingest failure";
    const stage: UploadStage = /fingerprint|phash|hash/i.test(reason)
      ? "FINGERPRINT_FAILED"
      : "INGEST_FAILED";
    logStage(stage, { reason });
    throw new UploadError(stage, reason);
  }
}

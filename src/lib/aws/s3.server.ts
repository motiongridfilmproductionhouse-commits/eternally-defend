import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3, getBucket } from "./clients.server";

export async function putObject(opts: {
  key: string;
  body: Uint8Array | Buffer;
  contentType?: string;
  metadata?: Record<string, string>;
}) {
  const bucket = getBucket();
  await getS3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: opts.key,
      Body: opts.body,
      ContentType: opts.contentType,
      Metadata: opts.metadata,
      ServerSideEncryption: "AES256",
    }),
  );
  return { bucket, key: opts.key };
}

export async function getSignedGetUrl(key: string, expiresInSeconds = 300) {
  return getSignedUrl(getS3(), new GetObjectCommand({ Bucket: getBucket(), Key: key }), { expiresIn: expiresInSeconds });
}

export async function getSignedPutUrl(key: string, contentType: string, expiresInSeconds = 300) {
  return getSignedUrl(getS3(), new PutObjectCommand({ Bucket: getBucket(), Key: key, ContentType: contentType }), { expiresIn: expiresInSeconds });
}

export async function headObject(key: string) {
  try {
    return await getS3().send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }));
  } catch {
    return null;
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Download a remote URL to bytes. Returns null on failure so callers can skip gracefully. */
export async function fetchImageBytes(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "application/octet-stream";
    if (!ct.startsWith("image/")) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength === 0 || ab.byteLength > 15 * 1024 * 1024) return null;
    return { bytes: new Uint8Array(ab), contentType: ct };
  } catch {
    return null;
  }
}

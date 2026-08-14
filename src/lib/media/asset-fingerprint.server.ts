/**
 * Server-only fingerprint helpers shared by the asset fingerprint server
 * functions. Keeps the server-function module a thin wrapper.
 */
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getBucket, getS3 } from "@/lib/aws/clients.server";
import { computePerceptualHashes } from "./perceptual-hash.server";

export const HASH_ALGORITHM = "phash64_dct32+dhash64+ahash64";

export async function loadObjectBytes(key: string): Promise<Uint8Array> {
  const object = await getS3().send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
  return new Uint8Array(await object.Body!.transformToByteArray());
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", ab);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Real perceptual fingerprint for an image object stored in S3. */
export async function fingerprintImageObject(key: string) {
  const bytes = await loadObjectBytes(key);
  if (!bytes.length) throw new Error("Stored object is empty");
  const hashes = computePerceptualHashes(bytes);
  return { bytes, hashes, sha256: await sha256Hex(bytes) };
}

/** A hash is legacy/fake when it is not a 16-hex-char perceptual hash. */
export function isRealPerceptualHash(value: string | null | undefined): boolean {
  return typeof value === "string" && /^[0-9a-f]{16}$/i.test(value);
}

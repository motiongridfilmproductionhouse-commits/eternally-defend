import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getBucket, getS3 } from "@/lib/aws/clients.server";

export const copyrightImageTypes = ["image/jpeg", "image/png", "image/webp"] as const;

export async function readStoredObject(key: string): Promise<Uint8Array> {
  const obj = await getS3().send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
  if (!obj.Body) {
    throw new Error("Reference file could not be read from storage.");
  }
  return new Uint8Array(await obj.Body.transformToByteArray());
}

export function bytesToDataUrl(bytes: Uint8Array, contentType: string): string {
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:${contentType};base64,${base64}`;
}

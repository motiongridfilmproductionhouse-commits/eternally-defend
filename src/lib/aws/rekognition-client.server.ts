/**
 * Lazy Rekognition client factory.
 *
 * Env vars are only injected at request time, so credentials must be read
 * inside the getter (never at module scope). Values are trimmed because
 * copy/pasted secrets often carry trailing whitespace or newlines, which
 * produces AWS `InvalidSignatureException` at signing time.
 */
import { RekognitionClient } from "@aws-sdk/client-rekognition";

const cache = new Map<string, RekognitionClient>();

function env(name: string): string | undefined {
  const value = process.env[name];
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

export function rekognitionRegion(): string {
  return env("AWS_REKOGNITION_REGION") ?? env("AWS_REGION") ?? "eu-north-1";
}

export function hasRekognitionCredentials(): boolean {
  return Boolean(env("AWS_ACCESS_KEY_ID") && env("AWS_SECRET_ACCESS_KEY"));
}

export function getRekognitionClient(region = rekognitionRegion()): RekognitionClient {
  const accessKeyId = env("AWS_ACCESS_KEY_ID");
  const secretAccessKey = env("AWS_SECRET_ACCESS_KEY");
  const sessionToken = env("AWS_SESSION_TOKEN");
  const key = `${region}|${accessKeyId ?? ""}|${secretAccessKey ? secretAccessKey.length : 0}`;

  const cached = cache.get(key);
  if (cached) return cached;

  const client = new RekognitionClient({
    region,
    credentials:
      accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey, sessionToken }
        : undefined,
  });
  cache.set(key, client);
  return client;
}

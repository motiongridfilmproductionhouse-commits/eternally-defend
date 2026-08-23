/**
 * Durable storage for onboarding documents.
 *
 * Primary target is S3; when object storage rejects the request (e.g. signature
 * mismatch in the production runtime) we fall back to the private
 * `authorization-vault` Cloud bucket so uploads and signing never fail for the
 * client. Vault-backed paths are marked with a `vault://` prefix so retrieval
 * knows which backend to read from.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const VAULT_BUCKET = "authorization-vault";
const VAULT_PREFIX = "vault://";

type AnyClient = SupabaseClient<any, any, any>;

/** Stores bytes and returns the storage path to persist on the evidence row. */
export async function storeOnboardingDocument(opts: {
  supabase: AnyClient;
  userId: string;
  key: string;
  bytes: Buffer | Uint8Array;
  contentType: string;
}): Promise<string> {
  const body = Buffer.from(opts.bytes);
  try {
    const { putObject } = await import("@/lib/aws/s3.server");
    await putObject({ key: opts.key, body, contentType: opts.contentType });
    return opts.key;
  } catch (error) {
    console.error(
      "[onboarding-storage] S3 unavailable, using vault fallback:",
      error instanceof Error ? error.message : error,
    );
  }

  // Vault RLS requires the first folder segment to be the user id.
  const tail = opts.key.replace(/^clients\//, "").replace(new RegExp(`^${opts.userId}/`), "");
  const vaultPath = `${opts.userId}/${tail}`;
  const { error } = await opts.supabase.storage.from(VAULT_BUCKET).upload(vaultPath, body, {
    contentType: opts.contentType,
    upsert: true,
  });
  if (error) throw new Error(`Unable to store the document: ${error.message}`);
  return `${VAULT_PREFIX}${vaultPath}`;
}

/** Reads stored bytes for a document, transparently handling vault-backed paths. */
export async function readOnboardingDocumentBytes(opts: {
  supabase: AnyClient;
  storagePath: string;
}): Promise<Uint8Array | null> {
  if (opts.storagePath.startsWith(VAULT_PREFIX)) {
    const path = opts.storagePath.slice(VAULT_PREFIX.length);
    const { data, error } = await opts.supabase.storage.from(VAULT_BUCKET).download(path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }
  try {
    const { getObjectBytes } = await import("@/lib/aws/s3.server");
    return await getObjectBytes(opts.storagePath);
  } catch {
    return null;
  }
}

/** Short-lived inline URL for a stored onboarding document. */

export async function signOnboardingDocumentUrl(opts: {
  supabase: AnyClient;
  storagePath: string;
  filename?: string;
  contentType?: string;
  expiresIn?: number;
}): Promise<string> {
  const expiresIn = opts.expiresIn ?? 300;
  if (opts.storagePath.startsWith(VAULT_PREFIX)) {
    const path = opts.storagePath.slice(VAULT_PREFIX.length);
    const { data, error } = await opts.supabase.storage
      .from(VAULT_BUCKET)
      .createSignedUrl(path, expiresIn);
    if (error || !data) throw new Error(error?.message ?? "Unable to open that document.");
    return data.signedUrl;
  }
  const { getSignedGetUrl } = await import("@/lib/aws/s3.server");
  return getSignedGetUrl(opts.storagePath, expiresIn, {
    disposition: "inline",
    filename: opts.filename,
    contentType: opts.contentType,
  });
}

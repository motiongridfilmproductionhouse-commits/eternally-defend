/**
 * Encryption helpers for the enforcement automation vault.
 *
 * Uses AES-256-GCM with a base64 32-byte key from `ENFORCEMENT_VAULT_SECRET`.
 * The stored ciphertext layout is `iv(12) | authTag(16) | ciphertext`, base64.
 *
 * Server-only. Never import from browser bundles.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.ENFORCEMENT_VAULT_SECRET;
  if (!raw) throw new Error("ENFORCEMENT_VAULT_SECRET is not set");
  // Accept base64 or raw utf8 (pad/truncate to 32 bytes if utf8).
  try {
    const buf = Buffer.from(raw, "base64");
    if (buf.length >= 32) return buf.subarray(0, 32);
  } catch {
    /* fall through */
  }
  const utf = Buffer.from(raw, "utf8");
  if (utf.length >= 32) return utf.subarray(0, 32);
  const padded = Buffer.alloc(32);
  utf.copy(padded);
  return padded;
}

export function encryptVault(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptVault(stored: string): string {
  const buf = Buffer.from(stored, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

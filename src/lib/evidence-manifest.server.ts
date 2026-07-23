import { createHash } from "node:crypto";
import { zipSync } from "fflate";

export interface ManifestFile {
  path: string;
  bytes: Uint8Array;
  mimeType: string;
  objectType: string;
}

export interface ManifestEntry {
  path: string;
  mimeType: string;
  objectType: string;
  bytes: number;
  sha256: string;
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildDeterministicManifest(reportId: string, files: ManifestFile[]) {
  const entries: ManifestEntry[] = files
    .map((file) => ({
      path: file.path.replace(/^\/+/, ""),
      mimeType: file.mimeType,
      objectType: file.objectType,
      bytes: file.bytes.byteLength,
      sha256: sha256Bytes(file.bytes),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const canonical = JSON.stringify({
    version: 1,
    reportId,
    hashingAlgorithm: "SHA-256",
    files: entries,
  });
  return { entries, canonical, sha256: sha256Bytes(new TextEncoder().encode(canonical)) };
}

export function buildDeterministicEvidenceZip(
  reportId: string,
  files: ManifestFile[],
): { bytes: Uint8Array; manifestSha256: string } {
  const manifest = buildDeterministicManifest(reportId, files);
  const manifestBytes = new TextEncoder().encode(manifest.canonical);
  const fixedTime = new Date("1980-01-01T00:00:00.000Z");
  const entries: Record<string, [Uint8Array, { mtime: Date; level: 6 }]> = {};
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    entries[file.path.replace(/^\/+/, "")] = [file.bytes, { mtime: fixedTime, level: 6 }];
  }
  entries["manifest.json"] = [manifestBytes, { mtime: fixedTime, level: 6 }];
  return { bytes: zipSync(entries as never), manifestSha256: manifest.sha256 };
}

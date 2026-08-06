export type IdentityStateSource = {
  target_name?: string | null;
  identity_name?: string | null;
};

export function normalizeIdentityName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function resolveActiveIdentityName(input: {
  selectedProfileName?: string | null;
  scan?: IdentityStateSource | null;
  selectedScan?: IdentityStateSource | null;
  targetName?: string | null;
}): string {
  return (
    input.selectedProfileName ??
    input.scan?.target_name ??
    input.scan?.identity_name ??
    input.selectedScan?.target_name ??
    input.selectedScan?.identity_name ??
    input.targetName ??
    ""
  );
}

export function isSarayuMohanIdentity(value: string): boolean {
  return normalizeIdentityName(value) === "sarayumohan";
}

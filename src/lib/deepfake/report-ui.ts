/** Interim is available for any non-failed scan that has progress or findings. */
export function canGenerateInterimReport(input: {
  scanStatus: string | null | undefined;
  findingCount: number;
}): boolean {
  const status = input.scanStatus ?? "";
  if (status === "failed") return false;
  if (status === "running" || status === "partial" || status === "completed") {
    return true;
  }
  return input.findingCount > 0;
}

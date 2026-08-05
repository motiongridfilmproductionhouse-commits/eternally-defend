export function businessFindingKey(input: {
  source: string;
  externalId?: string | null;
  url: string;
}): string {
  return `${input.source.toLowerCase()}::${input.externalId || input.url}`;
}

export async function recordBusinessFindingHistory(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  scanId: string;
  userId: string;
  key: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  existing?: any;
  current: { url: string; severity: string; engagement?: number | null };
  now?: string;
}) {
  const eventType = !input.existing
    ? "new"
    : input.existing.scan_id === input.scanId
      ? "rediscovered"
      : "reappeared";
  if (
    eventType === "rediscovered" &&
    input.existing?.severity === input.current.severity &&
    input.existing?.canonical_url === input.current.url &&
    input.existing?.engagement === input.current.engagement
  )
    return;
  await input.supabase.from("business_reputation_finding_history").insert({
    scan_id: input.scanId,
    user_id: input.userId,
    finding_key: input.key,
    event_type: eventType,
    previous_scan_id: input.existing?.scan_id || null,
    previous_url: input.existing?.canonical_url || null,
    current_url: input.current.url,
    previous_severity: input.existing?.severity || null,
    current_severity: input.current.severity,
    previous_engagement: input.existing?.engagement || null,
    current_engagement: input.current.engagement || null,
    created_at: input.now || new Date().toISOString(),
  });
}

export async function recordRemovedBusinessFindings(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  scanId: string;
  userId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  baseline: any[];
  seenKeys: Set<string>;
}) {
  const removed = input.baseline.filter((row) => !input.seenKeys.has(row.finding_key));
  if (removed.length)
    await input.supabase.from("business_reputation_finding_history").insert(
      removed.map((row) => ({
        scan_id: input.scanId,
        user_id: input.userId,
        finding_key: row.finding_key,
        event_type: "removed",
        previous_scan_id: row.scan_id || null,
        previous_url: row.canonical_url || null,
        current_url: null,
        previous_severity: row.severity || null,
        current_severity: null,
        previous_engagement: row.engagement || null,
        current_engagement: null,
      })),
    );
  return removed.length;
}

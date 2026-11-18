/** Public MCP deliberately excludes the BigQuery adapter and every BigQuery credential path. */
export async function addBigQueryEvidence(story: unknown, address?: unknown) {
  return {story, bigQueryStatus: address ? 'disabled' as const : 'address_unverified' as const, placeRecords: []};
}

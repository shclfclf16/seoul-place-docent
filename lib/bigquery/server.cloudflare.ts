import type {BigQueryResult} from './records';

/** The Sites bundle has no Node ADC or Vercel identity provider. */
export async function getBigQueryHistoricalRecords(): Promise<BigQueryResult> {
  return {status: 'disabled'};
}

/** Cloudflare's current public MCP runtime does not hold BigQuery credentials. */
export async function getBigQueryPlaceHistory(_district:string,_dong:string) {
  return {status:'disabled' as const,scenes:[]};
}

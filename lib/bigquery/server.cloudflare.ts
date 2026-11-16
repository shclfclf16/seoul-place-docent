import type {BigQueryResult} from './records';

/** The Sites bundle has no Node ADC or Vercel identity provider. */
export async function getBigQueryHistoricalRecords(): Promise<BigQueryResult> {
  return {status: 'disabled'};
}

import type {CandidateSearch, CandidateResult} from './candidate-records';
import type {BigQueryResult} from './records';
import type {CatalogDiagnosticsResult} from './catalog-diagnostics';
import type {ClassroomRecordsResult} from './classroom-records';
import type {Address} from '@/lib/providers';

/** The Sites bundle has no Node ADC or Vercel identity provider. */
export async function getBigQueryHistoricalRecords(): Promise<BigQueryResult> {
  return {status: 'disabled'};
}

/** Cloudflare's current runtime does not carry BigQuery credentials for admin diagnostics. */
export async function getBigQueryCatalogDiagnostics(): Promise<CatalogDiagnosticsResult> {
  return {status: 'disabled'};
}

/** Classroom candidate data is deliberately unavailable in the Cloudflare public runtime. */
export async function getClassroomDemoRecords(): Promise<ClassroomRecordsResult> {
  return {status: 'disabled'};
}

/** Cloudflare's current public MCP runtime does not hold BigQuery credentials. */
export async function getBigQueryPlaceHistory(_address:Address) {
  return {status:'disabled' as const,records:[],scenes:[]};
}

/** Candidate review data is never available from the public Cloudflare runtime. */
export async function getBigQueryCandidateRecords(_input:CandidateSearch):Promise<CandidateResult> {
  return {status:"disabled"};
}

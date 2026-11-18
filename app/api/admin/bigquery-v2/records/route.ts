import {candidateHandler} from '@/lib/bigquery/candidate-api';
import {getBigQueryCandidateRecords} from '@/lib/bigquery/server';

export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(request:Request){return candidateHandler(process.env,getBigQueryCandidateRecords)(request);}

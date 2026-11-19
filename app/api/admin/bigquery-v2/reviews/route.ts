import {reviewHandlers} from '@/lib/bigquery/review-api';
import {getBigQueryCandidateRecords} from '@/lib/bigquery/server';
import {env} from '@/lib/runtime-env';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export async function GET(req:Request){return reviewHandlers(process.env,env.DB,getBigQueryCandidateRecords).GET(req);}
export async function POST(req:Request){return reviewHandlers(process.env,env.DB,getBigQueryCandidateRecords).POST(req);}

import {approvedHandler} from '@/lib/bigquery/approved-api';
import {getBigQueryApprovalCandidates} from '@/lib/bigquery/server';
import {env} from '@/lib/runtime-env';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(req:Request){return approvedHandler(process.env,env.DB,getBigQueryApprovalCandidates)(req);}

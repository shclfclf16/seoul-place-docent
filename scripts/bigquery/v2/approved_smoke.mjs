/** Explicit read-only check against the configured existing Preview registry. Never seeds reviews. */
import {loadEnvFile} from 'node:process';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createNodeEnv} from '../../../lib/runtime-env.ts';
import {getBigQueryApprovalCandidates} from '../../../lib/bigquery/server.ts';
import {selectApprovedRecords} from '../../../lib/bigquery/approved-records.ts';
const args=process.argv.slice(2),value=key=>{const i=args.indexOf(key);return i<0?undefined:args[i+1];};
if(value('--confirm-read')!=='seoul-place-docent-514906.seoul_history')throw Error('Explicit --confirm-read seoul-place-docent-514906.seoul_history required');
const out=value('--out');if(!out)throw Error('--out required');
if(value('--env-file'))loadEnvFile(value('--env-file'));
const report={mode:'LOCAL_PREVIEW_READ_ONLY',hostedPreviewVerified:false,automaticApproval:false};
try{
 if(process.env.VERCEL_ENV!=='preview'||process.env.BIGQUERY_V2_PREVIEW_ENABLED!=='true')throw Error('PREVIEW_SETTINGS_REQUIRED');
 if(process.env.BIGQUERY_PROJECT_ID!=='seoul-place-docent-514906'||process.env.BIGQUERY_DATASET_ID!=='seoul_history')throw Error('PROJECT_SETTINGS_MISMATCH');
 const db=createNodeEnv(process.env).DB;if(!db)throw Error('PREVIEW_D1_CREDENTIALS_MISSING');
 const r=await selectApprovedRecords(process.env,db,{limit:20,after:'',action:'metadata'},getBigQueryApprovalCandidates);
 Object.assign(report,{status:'ok',registryCounts:r.registryCounts,selectedCount:r.selectedCount,scannedApprovedLinks:r.scannedApprovedLinks,nextCursor:r.nextCursor,complete:r.nextCursor===null,bigQuerySkipped:r.bigQuerySkipped,budget:r.budget,rejected:r.rejected});
}catch(e){report.status='unverified';report.error=/^[A-Z0-9_]+$/.test(e.message)?e.message:'READ_CHECK_FAILED';process.exitCode=1;}
await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));

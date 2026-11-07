import type {McpToolResult} from './mcp-protocol';

// Companion to mcp_client_docent_log: keep its historical retrieval metrics intact.
// Never accept request arguments, headers, identities or answer text here.
export type AuditRow = {requestId:string; at:number; tool:string; ok:boolean; records:number; ms:number; errorCode:string|null; validation:string; client:'unverified'};
export async function ensureMcpAudit(db:D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS mcp_request_log (
    request_id TEXT PRIMARY KEY, at INTEGER NOT NULL, tool TEXT NOT NULL,
    ok INTEGER NOT NULL, records INTEGER NOT NULL, ms INTEGER NOT NULL,
    error_code TEXT, validation TEXT NOT NULL, client TEXT NOT NULL)`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS mcp_request_log_at ON mcp_request_log(at)').run();
}
export async function saveMcpAudit(db:D1Database|undefined,row:AuditRow) {
  if(!db)return false;
  try {
    await ensureMcpAudit(db);
    await db.prepare('INSERT INTO mcp_request_log (request_id,at,tool,ok,records,ms,error_code,validation,client) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(row.requestId,row.at,row.tool,row.ok?1:0,row.records,row.ms,row.errorCode,row.validation,row.client).run();
    return true;
  } catch { return false; }
}
function payload(result:McpToolResult):Record<string,any> {
  try { const v=JSON.parse(result.content[0]?.text||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{}; } catch { return {}; }
}
export async function auditedTool(db:D1Database|undefined,tool:string,execute:()=>Promise<McpToolResult>,persist=saveMcpAudit):Promise<McpToolResult> {
  const at=Date.now(),requestId=crypto.randomUUID();
  let result:McpToolResult;
  try { result=await execute(); }
  catch { result={isError:true,content:[{type:'text',text:'INTERNAL_ERROR: 자료 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.'}]}; }
  const data=payload(result);
  const records=Array.isArray(data.neighborhood?.records)?data.neighborhood.records.length:
    Array.isArray(data.neighborhood?.scenes)?data.neighborhood.scenes.length:
    Array.isArray(data.candidates)?data.candidates.length:Array.isArray(data.sources)?data.sources.length:0;
  // Fixed error taxonomy: do not persist provider messages or user input.
  const code=result.isError?(result.content[0]?.text.startsWith('INTERNAL_ERROR:')?'INTERNAL_ERROR':
    result.content[0]?.text.startsWith('도구 입력 형식')?'INVALID_INPUT':'TOOL_ERROR'):null;
  const row:AuditRow={requestId,at,tool,ok:!result.isError,records,ms:Math.max(0,Date.now()-at),errorCode:code,
    validation:tool==='validate_place_answer'?(result.isError?'error':data.valid?'mechanical_pass':'mechanical_reject'):'not_requested',client:'unverified'};
  const persisted=await persist(db,row);
  const receipt={requestId,persisted,tool,returnedRecords:records,validation:row.validation,
    note:'서버 도구 실행 확인용입니다. 최종 AI 답변 완료·자료 사용·토큰 소비를 증명하지 않습니다.'};
  return {...result,_meta:{receipt},content:[...result.content,{type:'text',text:JSON.stringify({mcpReceipt:receipt})}]};
}
export async function mcpAuditStats(db:D1Database) {
  await ensureMcpAudit(db);
  const today=Math.floor((Date.now()+9*3600e3)/86400e3)*86400e3-9*3600e3;
  const totals=await db.prepare(`SELECT COUNT(*) total, COALESCE(SUM(at>=?),0) today,
    COALESCE(SUM(ok),0) success, COALESCE(SUM(ok=0),0) failure, AVG(ms) averageMs,
    COALESCE(SUM(records>0),0) withRecords, COALESCE(SUM(validation!='not_requested'),0) validations
    FROM mcp_request_log`).bind(today).first<{total:number;today:number;success:number;failure:number;averageMs:number|null;withRecords:number;validations:number}>();
  const count=totals?.total??0;
  const p95=count?await db.prepare('SELECT ms FROM mcp_request_log ORDER BY ms LIMIT 1 OFFSET ?').bind(Math.ceil(count*.95)-1).first<{ms:number}>():null;
  const tools=await db.prepare('SELECT tool, COUNT(*) calls FROM mcp_request_log GROUP BY tool ORDER BY calls DESC').all();
  const errors=await db.prepare('SELECT request_id, at, tool, error_code FROM mcp_request_log WHERE ok=0 ORDER BY at DESC LIMIT 20').all();
  return {available:true,totals,p95Ms:p95?.ms??null,tools:tools.results,errors:errors.results,
    timezone:'Asia/Seoul',scope:'기록이 저장된 도구 실행만 집계. HTTP 거절·DB 미연결·저장 실패는 제외.',
    clientIdentity:'unverified',aiAnswerCompleted:null,clientTokens:null,usedEvidenceInAnswer:null};
}

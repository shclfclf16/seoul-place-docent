import {env} from '@/lib/runtime-env';
import {requireArchiveAdmin} from '@/lib/archive-db';
import {ensureMcpAudit,mcpAuditStats} from '@/lib/mcp-audit';
export const dynamic='force-dynamic';
function auditDatabase(){return env.DB||(env as Cloudflare.Env & {MCP_AUDIT_DB?:D1Database}).MCP_AUDIT_DB;}
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
export async function GET(request:Request) {
  try { requireArchiveAdmin(request,env); } catch { return Response.json({error:'관리자 인증이 필요합니다.'},{status:403,headers}); }
  const auditDb=auditDatabase();
  if(!auditDb)return Response.json({available:false,error:'D1 연결이 없어 호출 기록을 확인할 수 없습니다.'},{status:503,headers});
  const id=new URL(request.url).searchParams.get('requestId');
  if(id&&!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return Response.json({error:'요청 ID 형식을 확인하세요.'},{status:400,headers});
  try {
    if(id){await ensureMcpAudit(auditDb);const receipt=await auditDb.prepare('SELECT * FROM mcp_request_log WHERE request_id=?').bind(id).first();return Response.json({receipt,note:'기록 없음은 호출되지 않았다는 증명이 아닙니다. 저장 실패나 다른 배포일 수 있습니다.'},{status:receipt?200:404,headers});}
    return Response.json(await mcpAuditStats(auditDb),{headers});
  } catch {return Response.json({error:'통계를 조회할 수 없습니다. DB 연결을 확인하세요.'},{status:503,headers});}
}

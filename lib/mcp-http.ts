import {MCP_SUPPORTED_VERSIONS} from './mcp-protocol';
type Settings={MCP_ALLOWED_ORIGINS?:string;MCP_ALLOWED_HOSTS?:string};
const csv=(s?:string)=>s?.split(',').map(x=>x.trim()).filter(Boolean)??[];
export function checkMcpHttp(request:Request,settings:Settings={}) {
  const url=new URL(request.url),origin=request.headers.get('origin');
  const allowedHosts=csv(settings.MCP_ALLOWED_HOSTS);
  if(allowedHosts.length&&!allowedHosts.includes(url.host))return 403;
  if(origin&&origin!==url.origin&&!csv(settings.MCP_ALLOWED_ORIGINS).includes(origin))return 403;
  const version=request.headers.get('mcp-protocol-version');
  if(version&&!MCP_SUPPORTED_VERSIONS.includes(version))return 400;
  if(request.method==='POST') {
    const accept=request.headers.get('accept')||'';
    if(!accept.includes('application/json')||!accept.includes('text/event-stream'))return 406;
  }
  return null;
}
// No IP, identity or credential retained. A per-instance backstop, not a distributed WAF.
export function createMcpLimiter(limit=120) {
  let window=0,count=0;
  return (now=Date.now())=>{const minute=Math.floor(now/60000);if(minute!==window){window=minute;count=0;}return ++count<=limit;};
}

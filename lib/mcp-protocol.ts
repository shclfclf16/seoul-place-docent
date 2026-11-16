export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, boolean>;
};
export type McpContent = {type: 'text'; text: string};
export type McpToolResult = {content: McpContent[]; structuredContent?:Record<string,unknown>; isError?: boolean; errorType?:string; _meta?:Record<string,unknown>};
type Execute = (name: string, args: Record<string, unknown>) => Promise<McpToolResult>;

export const MCP_VERSION = '2026-07-28';
export const MCP_LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
export const MCP_SUPPORTED_VERSIONS = [MCP_VERSION, ...MCP_LEGACY_VERSIONS];
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function rpcError(id: string | number | null, code: number, message: string) {
  return {jsonrpc: '2.0', id, error: {code, message}};
}
export function textResult(value: unknown): McpToolResult {
  return {content: [{type: 'text', text: JSON.stringify(value)}]};
}
/** Structured output for capable MCP clients, with JSON text retained for older clients. */
export function structuredResult(value: Record<string, unknown>): McpToolResult {
  return {structuredContent: value, content: [{type: 'text', text: JSON.stringify(value)}]};
}

/** Public, stateless evidence tools; admin data uses a separate authenticated API. */
export async function handleMcpMessage(value: unknown, tools: readonly McpTool[], execute: Execute) {
  if (!isObject(value)) return rpcError(null, -32600, 'Invalid Request');
  const hasId = Object.prototype.hasOwnProperty.call(value, 'id');
  const id = typeof value.id === 'string' || (typeof value.id === 'number' && Number.isSafeInteger(value.id)) ? value.id : null;
  if (value.jsonrpc !== '2.0' || typeof value.method !== 'string' || (hasId && id === null)) {
    return rpcError(null, -32600, 'Invalid Request');
  }
  if (value.params !== undefined && !isObject(value.params)) {
    return hasId ? rpcError(id, -32602, 'Invalid params') : undefined;
  }
  // Notifications must not execute tools or return JSON-RPC responses.
  if (!hasId) return undefined;
  const params = (value.params ?? {}) as Record<string, unknown>;
  let result: unknown;
  switch (value.method) {
    case 'server/discover':
      result = {
        supportedVersions: MCP_SUPPORTED_VERSIONS,
        _meta: {'io.modelcontextprotocol/serverInfo': {name: 'seoul-place-docent', version: '2.0.0'}},
        instructions: 'search_place로 주소 후보를 조회하고 복수 후보는 사용자가 선택하게 하세요. resolve_place_entity로 공식 장소 ID를 확인하고 prepare_place_answer로 건축물대장과 동네 역사 근거를 함께 받으세요. 호출한 AI가 출처와 시기를 붙여 최종 해설을 작성하고, 같은 token·question으로 validate_place_answer를 호출할 수 있습니다. 건물·필지·동네 범위를 구분하고 사용승인일을 건립연도로 바꾸지 마세요. 서버는 모델 API를 호출하지 않습니다.',
        capabilities: {tools: {}},
        serverInfo: {name: 'seoul-place-docent', version: '2.0.0'},
      };
      break;
    case 'initialize':
      if (typeof params.protocolVersion !== 'string') return rpcError(id, -32602, 'protocolVersion is required');
      // Legacy initialize negotiates a supported version rather than rejecting older clients.
      const negotiated = MCP_SUPPORTED_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : MCP_LEGACY_VERSIONS[0];
      result = {
        protocolVersion: negotiated,
        instructions: '주소 또는 실제 GPS를 확인한 다음 resolve_place_entity와 prepare_place_answer로 장소 ID 및 건축·역사 근거를 조회하세요. 질문 분류와 최종 도슨트 작성은 호출한 AI가 수행합니다. 서버는 모델 API를 호출하지 않습니다.',
        capabilities: {tools: {}},
        serverInfo: {name: 'seoul-place-docent', version: '2.0.0'},
      };
      break;
    case 'ping':
      result = {};
      break;
    case 'tools/list':
      result = {tools};
      break;
    case 'tools/call':
      if (typeof params.name !== 'string' || !tools.some(tool => tool.name === params.name)) {
        return rpcError(id, -32602, 'Unknown tool');
      }
      if (params.arguments !== undefined && !isObject(params.arguments)) {
        return rpcError(id, -32602, 'Tool arguments must be an object');
      }
      try {
        result = await execute(params.name, (params.arguments ?? {}) as Record<string, unknown>);
      } catch {
        result = {
          content: [{type: 'text', text: '자료 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.'}],
          isError: true,
        };
      }
      break;
    default:
      return rpcError(id, -32601, 'Method not found');
  }
  if(isObject(result)&&(value.method==='server/discover'||isObject(params._meta)&&params._meta['io.modelcontextprotocol/protocolVersion']===MCP_VERSION))result={...result,resultType:'complete',_meta:{...(isObject(result._meta)?result._meta:{}),'io.modelcontextprotocol/serverInfo':{name:'seoul-place-docent',version:'2.0.0'}}};
  return {jsonrpc: '2.0', id, result};
}

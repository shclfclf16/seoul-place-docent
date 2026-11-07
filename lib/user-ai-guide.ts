export const AI_SERVICES=[
  {id:'chatgpt',name:'ChatGPT',url:'https://chatgpt.com/',
    support:'원격 MCP 지원 · 실제 계정 연결 미검증',
    condition:'웹의 맞춤 MCP 메뉴와 워크스페이스 권한이 필요합니다. 계정별 제공 여부를 확인하세요.',
    steps:'Plugins → + → Add custom MCP server에서 서버 URL과 인증을 설정하고 설치하세요. 새 대화에서 @로 플러그인을 선택하세요.',
    docs:'https://developers.openai.com/api/docs/guides/custom-mcp-server'},
  {id:'claude',name:'Claude',url:'https://claude.ai/',
    support:'원격 MCP 지원 · 실제 계정 연결 미검증',
    condition:'Free 포함 지원 플랜. Free는 맞춤 연결 1개입니다. 서버가 인터넷에서 접근 가능해야 합니다.',
    steps:'Customize → Connectors → + Add → Add custom connector에서 URL을 입력하고 인증하세요. 대화에서 해당 연결을 켜세요.',
    docs:'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp'},
  {id:'gemini',name:'Gemini',url:'https://gemini.google.com/',
    support:'조건부 지원 · 실제 계정 연결 미검증',
    condition:'맞춤 앱 공식 안내 기준 미국·18세 이상·개인 계정·영어·활동 저장 조건이 있습니다. 한국 계정에서 된다고 보장하지 않습니다.',
    steps:'웹 Settings → Connected Apps → Custom apps에서 MCP URL을 추가하고 인증하세요. 메뉴가 없다면 계정 지원 여부를 확인하세요.',
    docs:'https://support.google.com/gemini/answer/17209137?co=GENIE.Platform%3DDesktop&hl=en-PR'},
] as const;
// Accept only the visible address string, never the Candidate object or its signed token.
export function historyQuestion(address:string) {
  const place=address.replace(/[\r\n\t]/g,' ').trim().slice(0,200)||'[조회할 서울 주소]';
  return `서울 장소 역사 도슨트 MCP를 사용해 “${place}”의 역사와 공간 변화를 조사해 줘. 먼저 search_place로 주소를 확인하고 후보가 여러 개면 내 선택을 기다려 줘. 선택한 후보의 token으로 prepare_place_answer를 호출한 다음, 반환된 근거로 네가 해설을 작성해 줘. 공식 자료를 우선하고 건물·부지와 주변 동네의 역사를 구분해 줘. 자료 연도·자료 ID·원문 링크를 표시하고, 확인되지 않은 내용은 미확인으로 남겨 줘. 가능하면 validate_place_answer로 기계적 근거 검사를 하고 한계를 설명해 줘. 반환된 mcpReceipt.requestId도 표시해 줘. MCP 연결이 없거나 호출이 실패하면 성공한 것처럼 답하지 말고 연결이 필요하다고 알려 줘.`;
}

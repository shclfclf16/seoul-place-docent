'use client';
import {useEffect,useState} from 'react';
import {aiServices,historyQuestion,photoHistoryQuestion} from '@/lib/user-ai';

export default function UserAIConnect({address=''}:{address?:string}) {
 const [service,setService]=useState<keyof typeof aiServices>('ChatGPT');
 const [url,setUrl]=useState('');const [message,setMessage]=useState('');const [sitesHost,setSitesHost]=useState(false);
 useEffect(()=>{
  const sites=window.location.hostname.endsWith('.chatgpt.site');setSitesHost(sites);
  if(!sites)setUrl(window.location.origin+'/mcp');
  let active=true;fetch('/api/mcp-connection').then(async r=>r.ok?await r.json() as {serverUrl?:string|null}:null).then(v=>{if(active&&v?.serverUrl)setUrl(v.serverUrl);}).catch(()=>{});
  return ()=>{active=false;};
 },[]);
 const info=aiServices[service],question=historyQuestion(address);
 async function copy(value:string) {
  try {await navigator.clipboard.writeText(value);setMessage('복사했습니다. 선택한 AI에 붙여넣어 주세요.');}
  catch {setMessage('복사 권한을 사용할 수 없습니다. 아래 텍스트를 선택해 직접 복사해 주세요.');}
 }
 return <section className="user-ai-connect" aria-labelledby="ai-guide-title">
  <h1 id="ai-guide-title">내 AI로 역사 해설 듣기</h1>
  <div className="user-ai-body">
   <p>자료는 이 서버가 찾고, 해설은 내가 선택한 AI가 작성합니다. AI 구독을 홈페이지 API 결제로 전환하는 기능은 아닙니다.</p>
   <label>사용할 AI <select value={service} onChange={e=>{setService(e.target.value as keyof typeof aiServices);setMessage('');}}>{Object.keys(aiServices).map(name=><option key={name}>{name}</option>)}</select></label>
   <h3>{service} · {info.support}</h3><p>{info.conditions}</p>
   <ol>{info.steps.map(step=><li key={step}>{step}</li>)}</ol>
   {sitesHost&&!url&&<p role="alert">이 홈페이지의 Sites MCP 주소는 호스팅 OAuth 인증을 요구합니다. 인증 없음으…282 tokens truncated…bc18영됩니다.</p>}
   <button type="button" onClick={()=>void copy(question)}>역사 질문 복사</button>
   <h4>스마트폰 사진으로 시작하기</h4><p>기본 카메라에서 위치정보를 켜고 촬영한 원본 JPEG·HEIC를 AI 대화에 파일로 첨부한 뒤 아래 질문을 붙여넣으세요. 사진 미리보기와 원본 파일 전달은 다를 수 있습니다. GPS가 없거나 첨부를 읽지 못하면 홈페이지에서 원본 사진을 선택해 주소를 확인할 수 있어요.</p>
   <button type="button" onClick={()=>void copy(photoHistoryQuestion())}>사진 도슨트 질문 복사</button>
   <p role="status" aria-live="polite">{message}</p>
   <h4>연결 상태 확인 방법</h4><p>AI의 도구 호출 상세에서 search_place → prepare_place_answer 실행과 자료·요청 ID를 확인하세요. 이 화면에서 AI 계정 연결 여부를 확인할 수는 없습니다. 관리자 로그와 요청 ID를 대조하면 서버 호출을 확인할 수 있지만, 최종 답변에 자료가 사용됐는지는 별도로 검토해야 합니다.</p>
   <p>별도 공개 MCP 서버는 공개 자료 조회 전용입니다. 홈페이지가 공개여도 Sites의 /mcp에는 별도 인증이 적용됩니다. 위에 표시된 전용 주소만 사용하고, 관리자 키나 API 키는 AI에 입력하지 마세요.</p>
   <small>공식 문서 확인: 2026-11-07 · 실제 계정 연결과 답변 완료: 미검증 · <a href={info.docs} target="_blank" rel="noopener noreferrer">공식 연결 안내</a></small>
  </div>
 </section>;
}

'use client';
import {useEffect,useState} from 'react';
import {AI_SERVICES,historyQuestion} from '@/lib/user-ai-guide';
import './user-ai.css';
export default function UserAiPanel({address=''}:{address?:string}) {
  const [service,setService]=useState<(typeof AI_SERVICES)[number]>(AI_SERVICES[0]);
  const [url,setUrl]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{setUrl(new URL('/mcp',window.location.origin).href);},[]);
  const question=historyQuestion(address);
  async function copy(text:string,label:string){try{await navigator.clipboard.writeText(text);setNotice(label+' 복사 완료');}catch{setNotice('자동 복사가 제한되었습니다. 아래 내용을 선택해 직접 복사하세요.');}}
  return <section className="user-ai-panel" aria-labelledby="user-ai-heading">
    <div className="user-ai-eyebrow">MY AI · SEOUL ARCHIVE</div>
    <h2 id="user-ai-heading">내 AI로 역사 해설 듣기</h2>
    <p>이곳의 역사자료를 내가 쓰는 AI에 연결하세요. 자료는 MCP 서버가 찾고, 해설은 선택한 AI가 작성합니다.</p>
    <div className="user-ai-choices" aria-label="AI 선택">{AI_SERVICES.map(s=><button key={s.id} aria-pressed={s.id===service.id} onClick={()=>{setService(s);setNotice('');}}>{s.name}</button>)}</div>
    <div className="user-ai-guide"><strong>{service.support}</strong><p>{service.condition}</p>
      <ol><li>{service.steps} <a href={service.docs} target="_blank" rel="noopener noreferrer">공식 안내 ↗</a></li>
      <li>서버의 인증 절차를 마친 뒤 아래 질문을 복사해 대화에 붙여 넣으세요.</li>
      <li>도구 실행 내역에 <code>search_place</code>, <code>prepare_place_answer</code>와 요청 ID가 표시되는지 확인하세요.</li></ol>
    </div>
    <label htmlFor="user-ai-url">MCP 서버 주소</label><input id="user-ai-url" readOnly value={url}/>
    <div className="user-ai-actions"><button disabled={!url} onClick={()=>copy(url,'MCP URL')}>MCP URL 복사</button><a href={service.url} target="_blank" rel="noopener noreferrer">{service.name} 열기 ↗</a></div>
    <label htmlFor="user-ai-question">{address?'선택한 주소로 만든 질문':'먼저 홈페이지에서 주소를 선택하면 질문에 반영됩니다'}</label>
    <textarea id="user-ai-question" readOnly value={question} rows={5}/>
    <button onClick={()=>copy(question,'역사 질문')}>역사 질문 복사</button><p role="status">{notice}</p>
    <details><summary>연결이 안 되거나 비용이 궁금한가요?</summary><p>이 버튼은 AI를 자동 연결하거나 실행하지 않습니다. 127.0.0.1 주소는 내 컴퓨터 전용이며 외부 AI에는 배포된 HTTPS 주소가 필요합니다. 401은 인증 필요, 403은 접근 정책, 429는 호출 제한입니다. 연결 상태는 AI 앱 안에서 확인하세요.</p><p>MCP 조회는 운영자 모델 API를 호출하지 않습니다. AI 답변에는 이용자 서비스의 한도·요금이 적용됩니다. 기존 홈페이지 AI 요약·번역·내레이션은 별도 운영자 API 비용이 발생할 수 있습니다. 질문은 복사 후 직접 붙여 넣으며 공유 링크에 주소나 토큰을 넣지 않습니다.</p><p>요청 ID는 서버 실행 확인용이며 AI 답변 완성·자료 사용·토큰 소비의 증거는 아닙니다. 공식 안내 확인: 2026-11-07.</p></details>
  </section>;
}

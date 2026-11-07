'use client';
import {useRef,useState} from 'react';
import '../../components/user-ai.css';
type Stats={totals:{total:number;today:number;success:number;failure:number;averageMs:number|null;withRecords:number;validations:number};p95Ms:number|null;tools:{tool:string;calls:number}[];errors:{request_id:string;at:number;tool:string;error_code:string}[];scope:string};
export default function Page(){
  const key=useRef<HTMLInputElement>(null),[stats,setStats]=useState<Stats|null>(null),[id,setId]=useState(''),[receipt,setReceipt]=useState<unknown>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  async function load(lookup=false){setBusy(true);setMessage('');setStats(null);setReceipt(null);try{const r=await fetch('/api/mcp-admin'+(lookup?'?requestId='+encodeURIComponent(id):''),{headers:{'x-archive-admin':key.current?.value||''},cache:'no-store'});const data=await r.json() as Stats & {error?:string;note?:string;receipt?:unknown};if(!r.ok)throw new Error(data.error||data.note||'기록을 찾지 못했습니다.');if(lookup)setReceipt(data.receipt);else setStats(data);}catch(e){setMessage(e instanceof Error?e.message:'조회 실패');}finally{setBusy(false);}}
  return <main className="user-ai-panel"><a href="/">← 홈페이지</a><h1>MCP 호출 확인</h1><p>관리자 인증 후에만 통계를 불러옵니다. 관리자 키는 이 화면 메모리에서만 사용하며 저장하지 않습니다.</p>
    <label htmlFor="admin-key">관리자 키 (Sites 소유자 인증 사용 시 생략 가능)</label><input id="admin-key" type="password" ref={key} autoComplete="off"/>
    <button disabled={busy} onClick={()=>load()}>통계 조회</button> <button onClick={()=>{if(key.current)key.current.value='';setStats(null);setReceipt(null);setMessage('인증 정보와 화면을 지웠습니다.');}}>화면 잠그기</button>
    <p role="status">{busy?'조회 중…':message}</p>
    {stats&&<><h2>저장된 실행 기록</h2><dl>{Object.entries({'오늘 호출 (한국 시간)':stats.totals.today,'전체 호출':stats.totals.total,'성공':stats.totals.success,'실패':stats.totals.failure,'자료 반환':stats.totals.withRecords,'근거 검사':stats.totals.validations,'평균 응답 ms':stats.totals.averageMs?.toFixed(1)??'미측정','P95 응답 ms':stats.p95Ms??'미측정'}).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><p>{stats.scope}</p><h2>도구별 호출</h2><ul>{stats.tools.map(t=><li key={t.tool}>{t.tool}: {t.calls}회</li>)}</ul><h2>최근 오류</h2><ul>{stats.errors.map(e=><li key={e.request_id}>{new Date(e.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} · {e.tool} · {e.error_code}</li>)}</ul></>}
    <h2>요청 ID 확인</h2><label htmlFor="request-id">AI 도구 결과의 mcpReceipt.requestId</label><input id="request-id" value={id} onChange={e=>setId(e.target.value)} maxLength={36}/><button disabled={busy||!id} onClick={()=>load(true)}>기록 찾기</button>{receipt!=null&&<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(receipt,null,2)}</pre>}
    <h2>이 통계가 증명하는 범위</h2><p>서버 호출 성공과 자료 반환은 확인할 수 있습니다. 사용자 AI의 최종 답변 완성, 실제 자료 인용, 토큰 사용량은 별도 확인이 필요합니다. 근거 검사는 기계적 검사이며 역사적 사실 전체의 검증이 아닙니다. AI 종류는 인증된 증거가 없어 미확인으로 기록합니다.</p>
  </main>;
}

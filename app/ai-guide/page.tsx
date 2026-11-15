'use client';
import {useEffect,useState} from 'react';
import {ChevronDown,Layers3} from 'lucide-react';
import UserAIConnect from '../components/UserAIConnect';
import '../docent.css';

export default function AIGuidePage(){
 const [address,setAddress]=useState('');
 useEffect(()=>{setAddress(sessionStorage.getItem('docent-ai-address')||'');},[]);
 return <>
  <header className="site-header"><div className="header-inner">
   <a className="wordmark" href="/"><span className="logo-mark"><Layers3 size={22}/></span><span>서울 장소 도슨트<small>SEOUL PLACE DOCENT</small></span></a>
   <nav aria-label="주 메뉴"><a href="/#explore">시작하기</a><details className="archive-menu"><summary>자료실·안내<ChevronDown size={14}/></summary><div><a href="/archive">역사자료 DB</a><a href="/archive/document-research">문헌 조사자료</a><a href="/archive/photo-research">사진·지도 조사자료</a><a href="/archive/article-research">기사 조사자료</a><a href="/archive/video-research">영상 조사자료</a></div></details><a href="/ai-guide" className="nav-active" aria-current="page">AI 안내</a></nav>
  </div></header>
  <main className="ai-guide-page">
   <a className="ai-guide-back" href="/#explore">← 장소 탐색으로 돌아가기</a>
   {address&&<p className="ai-guide-address">선택한 주소: <strong>{address}</strong></p>}
   <UserAIConnect address={address}/>
  </main>
 </>;
}

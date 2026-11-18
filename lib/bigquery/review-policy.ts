const CHECKS=['human_review','original_source','rights','place','relation'] as const;
export function approvalBlock(candidate:any,value:any,expiresAt:unknown,now=Date.now()):string|null{
 const checks=value.checks as Record<string,{status:string}>,permissions=value.permissions as Record<string,{status:string}>;
 if(CHECKS.some(k=>checks[k]?.status!=='VERIFIED')||permissions.metadata?.status!=='ALLOWED'||!candidate.sourceUrl)return '다섯 검토와 metadata 권리·HTTPS 원문 근거가 모두 필요합니다.';
 if(candidate.relationType==='UNCERTAIN'||candidate.relationType==='')return '불확실/미연결 자료는 승인할 수 없습니다.';
 if(candidate.relationType==='EXACT_SITE'&&(!value.verifiedLocation.evidenceUrl||(!value.verifiedLocation.address&&!value.verifiedLocation.buildingManagementNumber&&value.verifiedLocation.latitude===null)))return '직접 연결은 검증된 위치 근거가 필요합니다.';
 if(typeof expiresAt!=='string'||!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=now||Date.parse(expiresAt)>now+180*86400000)return '승인 만료일은 180일 이내로 설정하세요.';
 return null;
}

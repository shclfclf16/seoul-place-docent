/** Video catalog entries are currently pending or held; none are published from public MCP. */
export async function getDocentVideoCandidates(_district: string, _dong: string) {
  return {records: [], note: '검토 완료 상태로 공개 승인된 영상 자료가 없습니다.'};
}

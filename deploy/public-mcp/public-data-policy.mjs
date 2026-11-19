const APPROVED_REVIEW_STATES = new Set([
  'approved', 'verified', '확정', '검토완료', '검토 완료', '원문확인완료', '원문 확인 완료',
]);

export function isPubliclyReviewed(value) {
  return typeof value === 'string' && APPROVED_REVIEW_STATES.has(value.normalize('NFKC').trim());
}

export function publicPhotoRecords(records) {
  return records.filter((item) => {
    const status = item.reviewStatus || item.values?.['검토상태'];
    return isPubliclyReviewed(status) && item.recordType === 'visual' &&
      item.candidate !== true && !item.correctionOf && item.conflictMentioned !== true &&
      !item.importWarnings?.length && !item.metadataWarnings?.length;
  });
}

export function publicDocumentBundle(bundle) {
  const sources = bundle.tables.sources.filter((row) => isPubliclyReviewed(row.status) && !row.issues?.length);
  const sourceIds = new Set(sources.map((row) => row.id));
  const rows = (table) => bundle.tables[table].filter((row) =>
    isPubliclyReviewed(row.status) && !row.issues?.length && row.sourceIds?.length > 0 &&
    row.sourceIds.every((id) => sourceIds.has(id)));
  const claims = rows('claims');
  const claimIds = new Set(claims.map((row) => row.id));
  const timeline = rows('timeline').map((row) => ({
    ...row,
    evidenceIds: row.evidenceIds.filter((id) => claimIds.has(id)),
  }));
  return {
    targets: bundle.targets,
    tables: {sources, claims, timeline, links: [], drafts: [], leads: [], progress: []},
  };
}

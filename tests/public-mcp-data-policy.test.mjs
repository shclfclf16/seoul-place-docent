import test from 'node:test';
import assert from 'node:assert/strict';
import {isPubliclyReviewed, publicDocumentBundle, publicPhotoRecords} from '../deploy/public-mcp/public-data-policy.mjs';

test('only explicitly reviewed source states may enter public MCP data', () => {
  assert.equal(isPubliclyReviewed('검토완료'), true);
  assert.equal(isPubliclyReviewed('원문 확인·검토 대기'), false);
  assert.equal(isPubliclyReviewed('원문 미확인 후보'), false);
});

test('public photos exclude pending, candidate, conflicted, and warning-bearing records', () => {
  const base = {recordType: 'visual', reviewStatus: '검토완료', candidate: false, correctionOf: null, conflictMentioned: false};
  const result = publicPhotoRecords([
    {id: 'approved', ...base},
    {id: 'pending', ...base, reviewStatus: '원문 확인·검토 대기'},
    {id: 'candidate', ...base, candidate: true},
    {id: 'warning', ...base, importWarnings: ['원문 확인 필요']},
  ]);
  assert.deepEqual(result.map((row) => row.id), ['approved']);
});

test('public documents exclude unreviewed rows and rows citing unreviewed sources', () => {
  const source = (id, status) => ({id, status, issues: []});
  const row = (id, status, sourceIds) => ({id, status, sourceIds, issues: [], evidenceIds: []});
  const result = publicDocumentBundle({
    targets: [{id: 'district'}],
    tables: {
      sources: [source('approved-source', '원문확인완료'), source('pending-source', '원문 확인·검토 대기')],
      claims: [row('approved-claim', '검토완료', ['approved-source']), row('pending-claim', '원문 확인·검토 대기', ['approved-source']), row('mixed-claim', '확정', ['approved-source', 'pending-source'])],
      timeline: [row('approved-event', '확정', ['approved-source'])],
    },
  });
  assert.deepEqual(result.tables.sources.map((item) => item.id), ['approved-source']);
  assert.deepEqual(result.tables.claims.map((item) => item.id), ['approved-claim']);
  assert.deepEqual(result.tables.timeline.map((item) => item.id), ['approved-event']);
});

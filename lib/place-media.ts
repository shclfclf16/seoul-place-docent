import type {DocentStory} from './docent-story';
import {photoResearchCredit, photoResearchThumbnail} from './photo-research';
import {filterVideoCatalog, videoCatalog, videoDetails, videoRelation} from './video-catalog';

/** Bounded, read-only media evidence shared by the website and MCP. */
export async function placeMedia(story: DocentStory) {
  const photos = [...new Map(story.scenes.flatMap(scene => scene.photos.map(photo => [photo.id, {photo, scene}] as const))).values()]
    .slice(0, 6).map(({photo, scene}) => ({
      id: photo.id, title: photo.values['자료명'] || scene.title,
      date: scene.date, sourceUrl: photo.sourceUrl, previewUrl: photoResearchThumbnail(photo),
      provider: photo.provider, credit: photoResearchCredit(photo),
      rights: photo.values['이용조건'] || '제공기관 원문 확인 필요',
      relation: photo.relation, scope: scene.scope, reviewStatus: photo.reviewStatus,
    }));
  const matches = filterVideoCatalog(videoCatalog.items, {district: story.district, dong: story.dong, place: true});
  const videos = await Promise.all(matches.slice(0, 6).map(async item => {
    let details;
    try {details = await videoDetails(item.id);} catch { /* Index links remain usable if provenance storage is unavailable. */ }
    return {
      id: item.id, title: item.title, url: item.url, provider: item.provider, channel: item.channel,
      historicalPeriods: item.historicalPeriods, date: item.date, dateType: item.dateType, duration: item.duration,
      relation: videoRelation(item, story.district, story.dong), reviewStatus: item.reviewStatus,
      independentlyVerified: item.independentlyVerified,
      detailUrl: '/api/archive/video-research?dataset=combined&id=' + encodeURIComponent(item.id),
      provenanceStatus: details ? 'available' : 'unavailable',
      sources: details?.records.map(record => ({ref: record.ref, sourceUrl: record.sourceUrl, rights: record.rights})) || [],
      segments: details?.records.flatMap(record => record.segments.filter(segment =>
        segment.verifiedTime && segment.validTime && segment.start !== null &&
        Number.isFinite(segment.start) && segment.start >= 0 &&
        (segment.end === null || Number.isFinite(segment.end) && segment.end > segment.start)
      ).map(segment => ({...segment, sourceRef: record.ref}))) || [],
      segmentNotice: '검증된 구간만 제공하며, 빈 목록은 재생구간 미검증 또는 미확보를 뜻합니다.',
    };
  }));
  return {photos, videos, videoMatches: matches.length, scope: 'neighborhood_candidates',
    notice: '사진·영상은 동네·자치구·서울 배경 자료입니다. 촬영 위치와 피사체, 개별 건물·부지의 동일성은 미검증입니다.'};
}
export type PlaceMedia = Awaited<ReturnType<typeof placeMedia>>;

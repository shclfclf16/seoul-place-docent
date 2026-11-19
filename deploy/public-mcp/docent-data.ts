import photos from '../../.mcp-public/public-data/photos.json';
import documents from '../../.mcp-public/public-data/documents.json';
import {buildDocentStory, composeByYear} from '../../lib/docent-story';
import {ServiceError} from '../../lib/providers';
import type {DocumentBundle} from '../../lib/document-research';
import type {PhotoResearchBundle} from '../../lib/photo-research';

const publicPhotos = photos as unknown as PhotoResearchBundle;
const publicDocuments = documents as unknown as DocumentBundle;
function story(district: string, dong: string) {
  if (!district || !dong || district.length > 20 || dong.length > 30 ||
      !publicDocuments.targets.some((target) => target.level === '법정동' && target.district === district && target.name === dong)) {
    throw new ServiceError('STORY_LOCATION', '서울 주소를 먼저 선택해 주세요.', 400);
  }
  return buildDocentStory(publicPhotos, publicDocuments, district, dong);
}

export function getFullDocentStory(district: string, dong: string) { return story(district, dong); }
export function getDocentStory(district: string, dong: string, focus: string[] = []) {
  const result = story(district, dong);
  return {...result, scenes: composeByYear(result.scenes, focus)};
}

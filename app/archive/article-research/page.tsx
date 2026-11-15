import type {Metadata} from 'next';
import manifest from '@/data/district-media/manifest.json';
import DistrictMediaResearch, {type Manifest} from '../district-media/district-media-research';
import '../district-media/district-media.css';

export const metadata: Metadata = {
  title: '구별 기사 조사자료 | 서울 장소 도슨트',
  description: `${manifest.totals.districts}개 자치구의 제출 기사 CSV ${manifest.totals.articles.toLocaleString('ko-KR')}건을 원문 표기와 함께 검색합니다.`,
};

export default function ArticleResearchPage() {
  return <DistrictMediaResearch manifest={manifest as unknown as Manifest} mode="articles"/>;
}

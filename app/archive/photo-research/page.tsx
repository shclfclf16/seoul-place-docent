import type {Metadata} from 'next';
import summary from '@/data/photo-research/combined-summary.json';
import districtMedia from '@/data/district-media/manifest.json';
import PhotoResearch from './photo-research';
import type {Manifest} from '../district-media/district-media-research';
import type {PhotoResearchMeta} from '@/lib/photo-research';
import './photo-research.css';
import './integrated-research.css';
import '../district-media/district-media.css';
import './district-media-embedded.css';
export const metadata: Metadata = {
  title: '사진·지도 조사자료 | 서울 장소 도슨트',
  description: `${summary.meta.districtCount}개 자치구·${summary.meta.dongCount}개 동의 자료와 서울 전역 통합조사에 구별 수집 사진·지도 ${districtMedia.totals.photos.toLocaleString('ko-KR')}건을 더해 탐색합니다.`,
};
export default function PhotoResearchPage() {return <PhotoResearch meta={summary.meta as unknown as PhotoResearchMeta} districtMedia={districtMedia as unknown as Manifest}/>;}

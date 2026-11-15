import manifest from '@/data/district-media/manifest.json';
import DistrictMediaResearch, {type Manifest} from './district-media-research';
import './district-media.css';

export default function DistrictMediaPage() {
  return <DistrictMediaResearch manifest={manifest as unknown as Manifest} />;
}

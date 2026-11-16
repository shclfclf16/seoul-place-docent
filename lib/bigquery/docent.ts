import type {DocentStory} from '@/lib/docent-story';
import {getBigQueryPlaceHistory} from './server';

/** Keep the existing local story available if BigQuery is disabled or unavailable. */
export async function addBigQueryEvidence(story:DocentStory){
  try{
    const result=await getBigQueryPlaceHistory(story.district,story.dong);
    if(result.status!=='ok')return {story,bigQueryStatus:result.status};
    const scenes=[...story.scenes,...result.scenes].sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
    return {story:{...story,scenes,total:story.total+result.scenes.length},bigQueryStatus:'ok' as const};
  }catch{
    return {story,bigQueryStatus:'unavailable' as const};
  }
}

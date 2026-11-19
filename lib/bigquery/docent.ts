import type {DocentStory} from '@/lib/docent-story';
import type {Address} from '@/lib/providers';
import {getBigQueryPlaceHistory} from './server';

/** Keep the existing local story available if BigQuery is disabled or unavailable. */
export async function addBigQueryEvidence(story:DocentStory,address?:Address){
  if(!address)return {story,bigQueryStatus:'address_unverified' as const,placeRecords:[]};
  try{
    const result=await getBigQueryPlaceHistory(address);
    if(result.status!=='ok')return {story,bigQueryStatus:result.status,placeRecords:[]};
    const scenes=[...story.scenes,...result.scenes].sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));
    return {story:{...story,scenes,total:story.total+result.scenes.length},bigQueryStatus:'ok' as const,placeRecords:result.records};
  }catch{
    return {story,bigQueryStatus:'unavailable' as const,placeRecords:[]};
  }
}

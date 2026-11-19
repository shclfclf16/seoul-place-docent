/** Page only neighborhood/context scenes; exact-site records are returned separately. */
export function paginateHistoryScenes<T extends {placeRelation?:string}>(allScenes:T[],offset:number,limit:number){
  const scenesForHistory=allScenes.filter(scene=>scene.placeRelation!=='EXACT_SITE');
  const scenes=scenesForHistory.slice(offset,offset+limit);
  const nextOffset=offset+scenes.length;
  return {
    scenes,
    offset,
    total:scenesForHistory.length,
    sceneCount:scenesForHistory.length,
    nextOffset:nextOffset<scenesForHistory.length?nextOffset:null,
  };
}

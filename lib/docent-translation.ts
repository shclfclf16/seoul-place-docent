import type {StoryScene} from './docent-story';
import {ServiceError} from './providers';
export type SceneTranslation={id:string;title:string;text:string};
export function validateSceneTranslations(raw:unknown,scenes:StoryScene[]):SceneTranslation[]{
 const rows=(raw as {scenes?:unknown})?.scenes;if(!Array.isArray(rows)||rows.length!==scenes.length)throw new ServiceError('TRANSLATION_FORMAT','번역 결과를 확인하지 못했습니다.',502);
 return scenes.map(scene=>{const row=rows.find(r=>r?.id===scene.id);if(!row||typeof row.title!=='string'||typeof row.text!=='string'||!row.title.trim()||row.title.length>600||row.text.length>3000)throw new ServiceError('TRANSLATION_FORMAT','번역 결과를 확인하지 못했습니다.',502);
  const years=(s:string)=>[...new Set(s.match(/\b(?:1\d{3}|20\d{2})\b/g)||[])].sort().join(',');
  if(years(scene.title+' '+scene.text)!==years(row.title+' '+row.text))throw new ServiceError('TRANSLATION_YEARS','연도 대조를 통과하지 못해 한국어 원문을 표시합니다.',502);
  return {id:scene.id,title:row.title,text:row.text};});
}
const memory=new Map<string,SceneTranslation>();
export async function translateScenes(scenes:StoryScene[],secrets:{OPENAI_API_KEY?:string;OPENAI_MODEL?:string;BUCKET?:R2Bucket}){
 const model=secrets.OPENAI_MODEL||'gpt-5.4-mini';
 const keys=await Promise.all(scenes.map(async s=>{const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({version:1,model,id:s.id,title:s.title,text:s.text,language:'en'})));return 'docent-translations/'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')+'.json';}));
 const cached=await Promise.all(keys.map(async(key,i)=>{if(memory.has(key))return memory.get(key)!;try{const object=await secrets.BUCKET?.get(key);if(object){const row=validateSceneTranslations({scenes:[await object.json()]},[scenes[i]])[0];memory.set(key,row);return row;}}catch{}return null;}));
 return cached.filter((row):row is SceneTranslation=>row!==null);

}

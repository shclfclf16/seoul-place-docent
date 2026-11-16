import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {Plugin} from 'vite';

/** Vinext resolves tsconfig paths before user aliases; select native code at transform time. */
export function sitesNativeRuntime():Plugin{
 const modules=new Map([
  [fileURLToPath(new URL('../lib/bigquery/server.ts',import.meta.url)).replaceAll('\\','/'),readFileSync(new URL('../lib/bigquery/server.cloudflare.ts',import.meta.url),'utf8')],
  [fileURLToPath(new URL('../lib/runtime-env.ts',import.meta.url)).replaceAll('\\','/'),"export {env} from 'cloudflare:workers';"],
  [fileURLToPath(new URL('../lib/video-records-asset.ts',import.meta.url)).replaceAll('\\','/'),readFileSync(new URL('../lib/video-records-asset.cloudflare.ts',import.meta.url),'utf8')],
 ]);
 return {name:'sites-native-runtime',enforce:'pre',transform(_code,id){
  const code=modules.get(id.split('?')[0].replaceAll('\\','/'));
  return code===undefined?null:{code,map:null};
 }};
}

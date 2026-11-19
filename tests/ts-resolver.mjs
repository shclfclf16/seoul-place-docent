import {registerHooks} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('@/'))return next(new URL('../'+specifier.slice(2)+'.ts',import.meta.url).href,context);if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier)&&context.parentURL){const u=new URL(specifier+'.ts',context.parentURL);if(existsSync(fileURLToPath(u)))return next(u.href,context);}return next(specifier,context);},load(url,context,next){if(url.endsWith('.json')&&!url.includes('/node_modules/'))return {format:'module',source:'export default '+readFileSync(fileURLToPath(url),'utf8'),shortCircuit:true};return next(url,context);}});

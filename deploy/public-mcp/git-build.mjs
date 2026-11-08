import {execFileSync} from 'node:child_process';
import {cp,mkdir,rm,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// Build the exact Git checkout supplied by Vercel. Do not fetch a moving branch.
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=new URL('./.vercel/output/',import.meta.url);
const run=args=>execFileSync('corepack',['pnpm',...args],{cwd:root,stdio:'inherit'});
if(!process.argv.includes('--skip-install'))run(['install','--frozen-lockfile']);
run(['run','build:mcp-public:vercel']);
await rm(output,{recursive:true,force:true});
await mkdir(new URL('./.vercel/',import.meta.url),{recursive:true});
await cp(new URL('../../.vercel/output/',import.meta.url),output,{recursive:true});
const config=JSON.parse(await readFile(new URL('config.json',output),'utf8'));
if(config.version!==3)throw new Error('Invalid Vercel Build Output');
console.log('Git-linked public MCP build prepared from current checkout.');

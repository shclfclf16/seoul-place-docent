import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
/** Explicitly enabled local MCP metrics only. Never used as the history archive DB. */
export function createLocalAudit(file:string):D1Database {
  const path=resolve(file);mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL');
  return {prepare(sql:string){
    // This local store accepts only the two MCP metric tables.
    if(!/\bmcp_(request_log|client_docent_log)\b/.test(sql)||/;\s*\S/.test(sql))throw Error('Local audit query rejected');
    let values:unknown[]=[];
    const statement={bind(...args:unknown[]){values=args;return statement;},
      async run(){db.prepare(sql).run(...values as any[]);return {success:true,results:[],meta:{}};},
      async all(){return {success:true,results:db.prepare(sql).all(...values as any[]),meta:{}};},
      async first(){return db.prepare(sql).get(...values as any[])??null;}};
    return statement;
  }} as unknown as D1Database;
}

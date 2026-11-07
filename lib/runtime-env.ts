import {createD1Http} from './runtime/d1-http';
import {createR2Http} from './runtime/r2-http';
import {createLocalAudit} from './runtime/local-audit';

/** Server-only environment for native Next.js / Vercel. No build-time secret snapshot. */
export function createNodeEnv(settings: NodeJS.ProcessEnv): Cloudflare.Env {
  let db: D1Database | undefined, bucket: R2Bucket | undefined;
  let localAudit:D1Database|undefined;
  return new Proxy({} as Cloudflare.Env, {
    get(_target, name: string) {
      if(name==='MCP_AUDIT_DB')return settings.MCP_LOCAL_AUDIT_FILE?(localAudit??=createLocalAudit(settings.MCP_LOCAL_AUDIT_FILE)):undefined;
      if (name === 'DB') {
        if (!settings.CLOUDFLARE_ACCOUNT_ID || !settings.CLOUDFLARE_D1_DATABASE_ID || !settings.CLOUDFLARE_D1_API_TOKEN) return undefined;
        return db ??= createD1Http({accountId: settings.CLOUDFLARE_ACCOUNT_ID, databaseId: settings.CLOUDFLARE_D1_DATABASE_ID, token: settings.CLOUDFLARE_D1_API_TOKEN});
      }
      if (name === 'BUCKET') {
        if (!settings.CLOUDFLARE_ACCOUNT_ID || !settings.R2_BUCKET_NAME || !settings.R2_ACCESS_KEY_ID || !settings.R2_SECRET_ACCESS_KEY) return undefined;
        return bucket ??= createR2Http({accountId: settings.CLOUDFLARE_ACCOUNT_ID, bucket: settings.R2_BUCKET_NAME, accessKeyId: settings.R2_ACCESS_KEY_ID, secretAccessKey: settings.R2_SECRET_ACCESS_KEY});
      }
      // Vercel does not verify Sites' identity headers. Use ARCHIVE_ADMIN_TOKEN.
      if (name === 'ARCHIVE_OWNER_EMAIL') return undefined;
      return settings[name];
    },
  });
}

export const env = createNodeEnv(process.env);

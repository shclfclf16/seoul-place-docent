import {readFile, writeFile} from 'node:fs/promises';
import {mkdir} from 'node:fs/promises';
import {publicDocumentBundle, publicPhotoRecords} from './public-data-policy.mjs';

const root = new URL('../../', import.meta.url);
const output = new URL('../../.mcp-public/public-data/', import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const [legacyPhotos, integratedPhotos, workbookPhotos, documents] = await Promise.all([
  json('data/photo-research/bundle.json'),
  json('data/integrated-research/photo-items.json'),
  json('data/archive-workbook/photos.json'),
  json('data/document-research/bundle.json'),
]);

const photos = publicPhotoRecords([
  ...legacyPhotos.items,
  ...integratedPhotos,
  ...workbookPhotos,
]);
const files = [...new Map(photos.map((item) => [item.batchId, {
  id: item.batchId, collectionScope: item.collectionScope,
  district: item.district, dong: item.dong,
}])).values()];
const publicDocuments = publicDocumentBundle(documents);
await mkdir(output, {recursive: true});
await Promise.all([
  writeFile(new URL('photos.json', output), JSON.stringify({meta: {files}, items: photos})),
  writeFile(new URL('documents.json', output), JSON.stringify(publicDocuments)),
]);
console.log(`Public MCP data prepared: ${publicDocuments.tables.sources.length} reviewed sources, ${publicDocuments.tables.claims.length} reviewed claims, ${photos.length} reviewed photos.`);

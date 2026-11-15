import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {mkdir, readFile, readdir, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.resolve(process.argv[2] || 'C:/Users/shclf/OneDrive/바탕 화면/자료조사');
const output = path.join(root, 'public/research/district-media-20261115');
const manifestFile = path.join(root, 'data/district-media/manifest.json');
const summaryFile = path.join(root, 'data/district-media/summary.json');

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); if (row.some(value => value !== '')) rows.push(row); }
  return rows;
}

function slug(value) {
  const roman = {
    '강남구':'gangnam-gu','강동구':'gangdong-gu','강북구':'gangbuk-gu','강서구':'gangseo-gu',
    '관악구':'gwanak-gu','광진구':'gwangjin-gu','구로구':'guro-gu','금천구':'geumcheon-gu',
    '노원구':'nowon-gu','도봉구':'dobong-gu','동대문구':'dongdaemun-gu','동작구':'dongjak-gu',
    '마포구':'mapo-gu','서대문구':'seodaemun-gu','서초구':'seocho-gu','성동구':'seongdong-gu',
    '성북구':'seongbuk-gu','송파구':'songpa-gu','양천구':'yangcheon-gu','영등포구':'yeongdeungpo-gu',
    '용산구':'yongsan-gu','은평구':'eunpyeong-gu','종로구':'jongno-gu','중구':'jung-gu','중랑구':'jungnang-gu',
  };
  return roman[value] || value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const dirs = (await readdir(input, {withFileTypes: true})).filter(entry => entry.isDirectory());
const sourceFiles = [];
for (const dir of dirs) for (const name of await readdir(path.join(input, dir.name))) {
  if (name.toLocaleLowerCase('en-US').endsWith('.csv')) sourceFiles.push({dir: dir.name, name, path: path.join(input, dir.name, name)});
}
if (sourceFiles.length !== 50) throw new Error(`Expected 50 district CSVs; found ${sourceFiles.length}`);

await mkdir(output, {recursive: true});
await mkdir(path.dirname(manifestFile), {recursive: true});
try {
  const previous = JSON.parse(await readFile(manifestFile, 'utf8'));
  for (const file of previous.files || []) {
    const name = path.basename(file.file || '');
    if (name && name === file.file) await unlink(path.join(output, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const files = [];
for (const source of sourceFiles) {
  const district = source.dir.split(',').map(value => value.trim()).find(value => source.name.startsWith(value));
  if (!district) throw new Error(`District is not identifiable from ${source.name}`);
  const bytes = await readFile(source.path);
  let text, encoding = 'utf-8';
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch { encoding = 'euc-kr'; text = new TextDecoder('euc-kr', {fatal: true}).decode(bytes); }
  text = text.replace(/^\uFEFF/, '');
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error(`${source.name} has no data rows`);
  const columns = rows[0].map((value, index) => index === 0 ? value.replace(/^\uFEFF/, '') : value);
  const articleLike = columns.some(value => /^(article[_ ]?id|기사[_ ]?id)$/i.test(value.trim()));
  const declaredArticle = /기사/.test(source.name) && !/사진/.test(source.name);
  const kind = articleLike || declaredArticle ? 'articles' : 'photos';
  const mislabeled = kind === 'articles' && /사진/.test(source.name);
  const basename = `${slug(district)}-${kind}${mislabeled ? '-from-misnamed-photo-file' : ''}.csv.gz`;
  const destination = path.join(output, basename);
  const compressed = gzipSync(bytes, {level: 9});
  await writeFile(destination, compressed);
  files.push({
    id: `${slug(district)}-${kind}${mislabeled ? '-extra' : ''}`,
    district, kind, file: basename,
    url: `/research/district-media-20261115/${basename}`,
    originalName: source.name, sourceFolder: source.dir,
    encoding, rowCount: rows.length - 1, columns,
    sizeBytes: bytes.byteLength, compressedSizeBytes: compressed.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    ...(mislabeled ? {classificationNote: '파일명은 사진이지만 실제 CSV 열은 기사 레코드 형식이어서 기사 자료로 분류했습니다.'} : {}),
  });
}

const districts = [...new Set(files.map(file => file.district))].sort((a, b) => a.localeCompare(b, 'ko'));
const articles = files.filter(file => file.kind === 'articles');
const photos = files.filter(file => file.kind === 'photos');
const total = kind => files.filter(file => file.kind === kind).reduce((sum, file) => sum + file.rowCount, 0);
const manifest = {
  id: 'SEOUL-DISTRICT-COLLECTIONS-20261115',
  importedOn: '2026-11-15',
  districts,
  totals: {districts: districts.length, files: files.length, articles: total('articles'), photos: total('photos')},
  files: files.sort((a, b) => a.district.localeCompare(b.district, 'ko') || a.kind.localeCompare(b.kind) || a.originalName.localeCompare(b.originalName, 'ko')),
  note: '사용자가 제공한 25개 자치구의 기사·사진 조사 CSV입니다. 자료의 내용·검증·권리 표기는 제출된 파일의 기록으로 보존되며 사이트의 독립 검증을 뜻하지 않습니다. 기사·사진 원문은 각각의 이용조건에 따릅니다. 성북구_역사사진.csv는 EUC-KR 인코딩이고 화면에서만 글자를 변환해 읽습니다. 원본 파일 바이트는 그대로 보존합니다.',
};
await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
await writeFile(summaryFile, JSON.stringify({id:manifest.id,importedOn:manifest.importedOn,totals:manifest.totals,note:manifest.note}, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify(manifest.totals) + '\n');

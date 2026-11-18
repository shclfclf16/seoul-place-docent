export type ClassroomRecord = {
  recordId: string;
  title: string;
  recordType: string;
  institution: string;
  sourceUrl: string;
  createdYear: number | null;
  subjectStartYear: number | null;
  subjectEndYear: number | null;
  rightsStatus: string;
  reviewStatus: string;
  duplicateStatus: string;
  historicalPlaceName: string;
  placeId: string;
  placeName: string;
  district: string;
  legalDong: string;
  locationReviewStatus: string;
  relationType: string;
  relationEvidence: string;
  linkReviewStatus: string;
};

export type ClassroomRecordsResult =
  | {status: 'disabled'}
  | {status: 'ok'; location: string; records: ClassroomRecord[]; imageEmbedEnabled: boolean}
  | {status: 'unavailable'; code: string};

type Dependencies = {getToken: (signal: AbortSignal) => Promise<string>; fetch?: typeof fetch};
type QueryResponse = {
  errors?: unknown[];
  totalBytesProcessed?: string;
  jobComplete?: boolean;
  pageToken?: string;
  schema?: {fields?: Array<{name?: string}>};
  rows?: Array<{f: Array<{v: string | number | boolean | null}>}>;
};

const columns = [
  'record_id', 'record_title', 'record_type', 'source_institution', 'source_url',
  'created_year', 'subject_start_year', 'subject_end_year', 'rights_status', 'review_status',
  'duplicate_status', 'historical_place_name', 'place_id', 'place_name', 'district', 'legal_dong',
  'location_review_status', 'relation_type', 'relation_evidence', 'link_review_status',
] as const;
const safeError = /^BIGQUERY_[A-Z_]+$/;

export async function readClassroomRecords(
  settings: Record<string, string | undefined>,
  deps: Dependencies,
): Promise<ClassroomRecordsResult> {
  if (settings.CLASSROOM_DEMO_ENABLED !== 'true' || settings.VERCEL_ENV !== 'preview') return {status: 'disabled'};
  const project = settings.BIGQUERY_PROJECT_ID ?? '';
  const dataset = settings.BIGQUERY_DATASET_ID ?? '';
  const configuredLocation = settings.BIGQUERY_LOCATION;
  const byteCap = settings.BIGQUERY_MAX_BYTES_BILLED ?? '104857600';
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) || !/^\w{1,1024}$/.test(dataset) ||
      (configuredLocation && !/^[a-z0-9-]{1,64}$/i.test(configuredLocation)) ||
      !/^[1-9]\d{0,17}$/.test(byteCap)) {
    return {status: 'unavailable', code: 'BIGQUERY_CONFIG_INVALID'};
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = new AbortController();
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new Error('BIGQUERY_TIMEOUT'));
    }, 12000);
  });

  async function read(): Promise<ClassroomRecordsResult> {
    const token = await deps.getToken(abort.signal).catch(() => { throw new Error('BIGQUERY_AUTH_FAILED'); });
    if (!token) throw new Error('BIGQUERY_AUTH_FAILED');
    const root = `https://bigquery.googleapis.com/bigquery/v2/projects/${project}`;
    async function api<T>(path: string, body?: object): Promise<T> {
      const response = await (deps.fetch ?? fetch)(root + path, {
        method: body ? 'POST' : 'GET', redirect: 'error', cache: 'no-store', signal: abort.signal,
        headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403
        ? 'BIGQUERY_ACCESS_DENIED' : 'BIGQUERY_REQUEST_FAILED');
      return await response.json() as T;
    }

    const metadata = await api<{location?: string}>(`/datasets/${dataset}?fields=location`);
    const location = metadata.location;
    if (typeof location !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(location)) throw new Error('BIGQUERY_LOCATION_UNKNOWN');
    if (configuredLocation && configuredLocation.toLowerCase() !== location.toLowerCase()) throw new Error('BIGQUERY_LOCATION_MISMATCH');

    const quote = String.fromCharCode(96);
    const query = `SELECT ${columns.map(column => `r.${column} AS ${column}`).slice(0, 12).join(', ')},
  p.place_id AS place_id, p.place_name AS place_name, p.district AS district, p.legal_dong AS legal_dong,
  p.location_review_status AS location_review_status, l.relation_type AS relation_type,
  l.relation_evidence AS relation_evidence, l.link_review_status AS link_review_status
FROM ${quote}${project}.${dataset}.historical_records${quote} r
LEFT JOIN ${quote}${project}.${dataset}.record_place_links${quote} l ON l.record_id=r.record_id
LEFT JOIN ${quote}${project}.${dataset}.places${quote} p ON p.place_id=l.place_id
WHERE STARTS_WITH(r.record_id, 'DANGIN-') OR LOWER(COALESCE(r.historical_place_name, '')) LIKE '%당인리%'
ORDER BY r.record_id, l.relation_type LIMIT 100`;
    const request = {query, useLegacySql: false, location, maximumBytesBilled: byteCap, maxResults: 100, timeoutMs: 8000};
    const estimate = await api<QueryResponse>('/queries', {...request, dryRun: true});
    if (estimate.errors?.length || typeof estimate.totalBytesProcessed !== 'string' || !/^\d+$/.test(estimate.totalBytesProcessed)) {
      throw new Error('BIGQUERY_ESTIMATE_FAILED');
    }
    if (BigInt(estimate.totalBytesProcessed) > BigInt(byteCap)) throw new Error('BIGQUERY_BUDGET_EXCEEDED');
    const result = await api<QueryResponse>('/queries', request);
    if (result.errors?.length) throw new Error('BIGQUERY_QUERY_FAILED');
    if (result.jobComplete !== true) throw new Error('BIGQUERY_QUERY_INCOMPLETE');
    if (result.pageToken) throw new Error('BIGQUERY_RESULT_TRUNCATED');
    const names = result.schema?.fields?.map(field => field.name ?? '') ?? [];
    if (names.length !== columns.length || names.some((name, index) => name !== columns[index])) {
      throw new Error('BIGQUERY_RESULT_INVALID');
    }
    const records = (result.rows ?? []).map(row => {
      const values = Object.fromEntries(row.f.map((cell, index) => [names[index], cell.v]));
      const get = (key: string) => values[key] == null ? '' : String(values[key]);
      const year = (key: string) => {
        const raw = get(key);
        return /^\d{1,4}$/.test(raw) ? Number(raw) : null;
      };
      const sourceUrl = get('source_url');
      if (!/^https:\/\//i.test(sourceUrl)) throw new Error('BIGQUERY_RESULT_INVALID');
      return {
        recordId: get('record_id'), title: get('record_title'), recordType: get('record_type'),
        institution: get('source_institution'), sourceUrl, createdYear: year('created_year'),
        subjectStartYear: year('subject_start_year'), subjectEndYear: year('subject_end_year'),
        rightsStatus: get('rights_status'), reviewStatus: get('review_status'), duplicateStatus: get('duplicate_status'),
        historicalPlaceName: get('historical_place_name'), placeId: get('place_id'), placeName: get('place_name'),
        district: get('district'), legalDong: get('legal_dong'), locationReviewStatus: get('location_review_status'),
        relationType: get('relation_type'), relationEvidence: get('relation_evidence'), linkReviewStatus: get('link_review_status'),
      } satisfies ClassroomRecord;
    });
    return {
      status: 'ok', location, records,
      imageEmbedEnabled: settings.CLASSROOM_DEMO_IMAGE_EMBED_ENABLED === 'true' &&
        settings.CLASSROOM_DEMO_IMAGE_RIGHTS_APPROVED === 'true',
    };
  }

  try {
    return await Promise.race([read(), deadline]);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return {status: 'unavailable', code: safeError.test(message) ? message : 'BIGQUERY_REQUEST_FAILED'};
  } finally {
    clearTimeout(timer);
  }
}

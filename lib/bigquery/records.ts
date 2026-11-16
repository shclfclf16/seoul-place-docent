export type HistoricalRecord = {
  record_id: string | null;
  record_title: string | null;
  record_type: string | null;
  source_url: string | null;
};
export type BigQueryResult =
  | {status: 'disabled'}
  | {status: 'ok'; location: string; records: HistoricalRecord[]}
  | {status: 'unavailable'; code: string};

type Dependencies = {getToken: () => Promise<string>; fetch?: typeof fetch};
type QueryResponse = {
  errors?: unknown[];
  totalBytesProcessed?: string;
  jobComplete?: boolean;
  pageToken?: string;
  rows?: Array<{f: Array<{v: string | number | boolean | null}>}>;
};
const columns = ['record_id', 'record_title', 'record_type', 'source_url'] as const;

export async function readHistoricalRecords(settings: Record<string, string | undefined>, deps: Dependencies): Promise<BigQueryResult> {
  if (settings.BIGQUERY_ENABLED !== 'true') return {status: 'disabled'};
  const project = settings.BIGQUERY_PROJECT_ID ?? '';
  const dataset = settings.BIGQUERY_DATASET_ID ?? '';
  const table = settings.BIGQUERY_TABLE_ID ?? '';
  const configuredLocation = settings.BIGQUERY_LOCATION;
  const costCap = settings.BIGQUERY_MAX_BYTES_BILLED ?? '104857600';
  const rowLimit = Number(settings.BIGQUERY_MAX_ROWS ?? '25');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) ||
      !/^\w{1,1024}$/.test(dataset) || !/^\w{1,1024}$/.test(table) ||
      (configuredLocation && !/^[a-z0-9-]{1,64}$/i.test(configuredLocation)) ||
      !/^[1-9]\d{0,17}$/.test(costCap) || !Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 100) {
    return {status: 'unavailable', code: 'BIGQUERY_CONFIG_INVALID'};
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = new AbortController();
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new Error('BIGQUERY_TIMEOUT')); abort.abort(); }, 12000);
  });
  async function read(): Promise<BigQueryResult> {
    const token = await deps.getToken().catch(() => '');
    if (!token) throw new Error('BIGQUERY_AUTH_FAILED');
    const root = `https://bigquery.googleapis.com/bigquery/v2/projects/${project}`;
    async function api<T>(path: string, body?: object): Promise<T> {
      const response = await (deps.fetch ?? fetch)(root + path, {
        method: body ? 'POST' : 'GET', redirect: 'error', cache: 'no-store', signal: abort.signal,
        headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'BIGQUERY_ACCESS_DENIED' : 'BIGQUERY_REQUEST_FAILED');
      return await response.json() as T;
    }
    const metadata = await api<{location?: string}>(`/datasets/${dataset}?fields=location`);
    const location = metadata.location;
    if (typeof location !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(location)) throw new Error('BIGQUERY_LOCATION_UNKNOWN');
    if (configuredLocation && location.toLowerCase() !== configuredLocation.toLowerCase()) throw new Error('BIGQUERY_LOCATION_MISMATCH');
    const request = {
      query: `SELECT ${columns.join(', ')} FROM \`${project}.${dataset}.${table}\` ORDER BY record_id LIMIT @maxRows`,
      parameterMode: 'NAMED', queryParameters: [{name: 'maxRows', parameterType: {type: 'INT64'}, parameterValue: {value: String(rowLimit)}}],
      useLegacySql: false, location, maximumBytesBilled: costCap, maxResults: rowLimit, timeoutMs: 8000,
    };
    const estimate = await api<QueryResponse>('/queries', {...request, dryRun: true});
    if (estimate.errors?.length || typeof estimate.totalBytesProcessed !== 'string' || !/^\d+$/.test(estimate.totalBytesProcessed)) throw new Error('BIGQUERY_ESTIMATE_FAILED');
    if (BigInt(estimate.totalBytesProcessed) > BigInt(costCap)) throw new Error('BIGQUERY_BUDGET_EXCEEDED');
    const result = await api<QueryResponse>('/queries', request);
    if (result.errors?.length) throw new Error('BIGQUERY_QUERY_FAILED');
    if (result.jobComplete !== true) throw new Error('BIGQUERY_QUERY_INCOMPLETE');
    if (result.pageToken) throw new Error('BIGQUERY_RESULT_TRUNCATED');
    const records = (result.rows ?? []).slice(0, rowLimit).map(row =>
      Object.fromEntries(columns.map((key, index) => {
        const value = row.f[index]?.v;
        return [key, value == null ? null : String(value)];
      })) as HistoricalRecord);
    return {status: 'ok', location, records};
  }
  try {
    return await Promise.race([read(), deadline]);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return {status: 'unavailable', code: /^BIGQUERY_(TIMEOUT|AUTH_FAILED|ACCESS_DENIED|REQUEST_FAILED|LOCATION_UNKNOWN|LOCATION_MISMATCH|ESTIMATE_FAILED|BUDGET_EXCEEDED|QUERY_FAILED|QUERY_INCOMPLETE|RESULT_TRUNCATED)$/.test(message) ? message : 'BIGQUERY_REQUEST_FAILED'};
  } finally {
    clearTimeout(timer);
  }
}

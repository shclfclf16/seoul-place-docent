export type CatalogTableCount = {
  table: 'historical_records' | 'places' | 'record_place_links';
  rowCount: number;
  expectedCount: number;
  matchesExpected: boolean;
};

export type CatalogDiagnosticsResult =
  | {status: 'disabled'}
  | {status: 'ok'; location: string; tables: CatalogTableCount[]; allMatchExpected: boolean}
  | {status: 'unavailable'; code: string};

type Dependencies = {getToken: (signal: AbortSignal) => Promise<string>; fetch?: typeof fetch};
type QueryResponse = {
  errors?: unknown[];
  totalBytesProcessed?: string;
  jobComplete?: boolean;
  pageToken?: string;
  rows?: Array<{f: Array<{v: string | number | boolean | null}>}>;
};

const expected = {historical_records: 7, places: 3, record_place_links: 7} as const;
const tableNames = Object.keys(expected) as Array<keyof typeof expected>;
const safeError = /^BIGQUERY_[A-Z_]+$/;

/** Read-only, cost-bounded row-count diagnostic for the reviewed catalog tables. */
export async function readBigQueryCatalogDiagnostics(
  settings: Record<string, string | undefined>,
  deps: Dependencies,
): Promise<CatalogDiagnosticsResult> {
  if (settings.BIGQUERY_ENABLED !== 'true') return {status: 'disabled'};

  const project = settings.BIGQUERY_PROJECT_ID ?? '';
  const dataset = settings.BIGQUERY_DATASET_ID ?? '';
  const configuredLocation = settings.BIGQUERY_LOCATION;
  const byteCap = settings.BIGQUERY_MAX_BYTES_BILLED ?? '104857600';
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project) ||
      !/^\w{1,1024}$/.test(dataset) ||
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

  async function read(): Promise<CatalogDiagnosticsResult> {
    const token = await deps.getToken(abort.signal).catch(() => { throw new Error('BIGQUERY_AUTH_FAILED'); });
    if (!token) throw new Error('BIGQUERY_AUTH_FAILED');

    const root = `https://bigquery.googleapis.com/bigquery/v2/projects/${project}`;
    async function api<T>(path: string, body?: object): Promise<T> {
      const response = await (deps.fetch ?? fetch)(root + path, {
        method: body ? 'POST' : 'GET',
        redirect: 'error', cache: 'no-store', signal: abort.signal,
        headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        throw new Error(response.status === 401 || response.status === 403
          ? 'BIGQUERY_ACCESS_DENIED' : 'BIGQUERY_REQUEST_FAILED');
      }
      return await response.json() as T;
    }

    const metadata = await api<{location?: string}>(`/datasets/${dataset}?fields=location`);
    const location = metadata.location;
    if (typeof location !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(location)) {
      throw new Error('BIGQUERY_LOCATION_UNKNOWN');
    }
    if (configuredLocation && configuredLocation.toLowerCase() !== location.toLowerCase()) {
      throw new Error('BIGQUERY_LOCATION_MISMATCH');
    }

    const quote = String.fromCharCode(96);
    const selects = tableNames.map(name =>
      `(SELECT COUNT(*) FROM ${quote}${project}.${dataset}.${name}${quote}) AS ${name}_count`);
    const request = {
      query: `SELECT ${selects.join(', ')}`,
      useLegacySql: false,
      location,
      maximumBytesBilled: byteCap,
      maxResults: 1,
      timeoutMs: 8000,
    };
    const estimate = await api<QueryResponse>('/queries', {...request, dryRun: true});
    if (estimate.errors?.length || typeof estimate.totalBytesProcessed !== 'string' ||
        !/^\d+$/.test(estimate.totalBytesProcessed)) throw new Error('BIGQUERY_ESTIMATE_FAILED');
    if (BigInt(estimate.totalBytesProcessed) > BigInt(byteCap)) throw new Error('BIGQUERY_BUDGET_EXCEEDED');

    const result = await api<QueryResponse>('/queries', request);
    if (result.errors?.length) throw new Error('BIGQUERY_QUERY_FAILED');
    if (result.jobComplete !== true) throw new Error('BIGQUERY_QUERY_INCOMPLETE');
    if (result.pageToken) throw new Error('BIGQUERY_RESULT_TRUNCATED');
    const values = result.rows?.[0]?.f.map(cell => cell.v) ?? [];
    if (values.length !== tableNames.length) throw new Error('BIGQUERY_RESULT_INVALID');

    const tables = tableNames.map((table, index) => {
      const raw = values[index];
      const value = typeof raw === 'number' ? String(raw) : raw;
      if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new Error('BIGQUERY_RESULT_INVALID');
      }
      const rowCount = Number(value);
      return {table, rowCount, expectedCount: expected[table], matchesExpected: rowCount === expected[table]};
    });
    return {status: 'ok', location, tables, allMatchExpected: tables.every(table => table.matchesExpected)};
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

// Overpass API client with endpoint rotation, per-request timeout, and retry with backoff.
// Public Overpass instances are shared, rate-limited infrastructure: keep queries small,
// cache results (courses are fetched once and stored in Postgres), and back off on 429.

export const USER_AGENT = 'ClubSense/1.2 (clubsensesupport@gmail.com)';

export const DEFAULT_OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const BACKOFF_MS = [500, 1500, 4000];
const MAX_ATTEMPTS = 4;

export class OverpassError extends Error {
  constructor(message: string, readonly status: number | null, readonly retryable: boolean) {
    super(message);
    this.name = 'OverpassError';
  }
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  center?: { lat: number; lon: number };
  geometry?: ({ lat: number; lon: number } | null)[];
  nodes?: number[];
  members?: {
    type: 'node' | 'way' | 'relation';
    ref: number;
    role: string;
    lat?: number;
    lon?: number;
    geometry?: ({ lat: number; lon: number } | null)[];
  }[];
}

export interface OverpassOptions {
  /** Per-request timeout. Default 30s. */
  timeoutMs?: number;
  /** Total time budget across retries. Default 60s. */
  budgetMs?: number;
  /** Overrides the endpoint list (else env OVERPASS_ENDPOINTS, else defaults). */
  endpoints?: string[];
  /** For tests. */
  fetch?: typeof fetch;
  /** For tests: backoff schedule in ms. */
  backoffMs?: number[];
}

export function getOverpassEndpoints(): string[] {
  let fromEnv: string | undefined;
  try {
    fromEnv = Deno.env.get('OVERPASS_ENDPOINTS');
  } catch { /* env access not permitted */ }
  const list = (fromEnv ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_OVERPASS_ENDPOINTS;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs an Overpass QL query and returns its `elements`. Throws OverpassError. */
export async function overpassQuery(ql: string, opts: OverpassOptions = {}): Promise<OverpassElement[]> {
  const endpoints = opts.endpoints ?? getOverpassEndpoints();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const budgetMs = opts.budgetMs ?? 60_000;
  const backoff = opts.backoffMs ?? BACKOFF_MS;
  const doFetch = opts.fetch ?? fetch;
  const started = Date.now();
  let lastError: OverpassError = new OverpassError('Overpass unavailable', null, true);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const remaining = budgetMs - (Date.now() - started);
    if (remaining <= 0) break;
    const endpoint = endpoints[attempt % endpoints.length];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, remaining));
    try {
      const res = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: 'data=' + encodeURIComponent(ql),
        signal: controller.signal,
      });
      if (res.ok) {
        const json = await res.json() as { elements?: OverpassElement[]; remark?: string };
        // Overpass reports server-side timeouts / memory limits as HTTP 200 with a remark.
        if (json.remark && /runtime error/i.test(json.remark)) {
          lastError = new OverpassError(`Overpass runtime error: ${json.remark.slice(0, 200)}`, 200, true);
        } else {
          return Array.isArray(json.elements) ? json.elements : [];
        }
      } else {
        const text = (await res.text().catch(() => '')).slice(0, 200);
        if (res.status === 429 || res.status >= 500) {
          lastError = new OverpassError(`Overpass HTTP ${res.status}`, res.status, true);
        } else {
          // 400 = bad query: retrying elsewhere won't help.
          throw new OverpassError(`Overpass HTTP ${res.status}: ${text}`, res.status, false);
        }
      }
    } catch (err) {
      if (err instanceof OverpassError && !err.retryable) throw err;
      if (err instanceof OverpassError) {
        lastError = err;
      } else if (controller.signal.aborted) {
        lastError = new OverpassError('Overpass request timed out', null, true);
      } else {
        lastError = new OverpassError(`Overpass network error: ${(err as Error).message}`, null, true);
      }
    } finally {
      clearTimeout(timer);
    }

    if (attempt < MAX_ATTEMPTS - 1) {
      const base = backoff[Math.min(attempt, backoff.length - 1)] ?? 0;
      const delay = base * (0.75 + Math.random() * 0.5); // +-25% jitter
      if (Date.now() - started + delay >= budgetMs) break;
      await sleep(delay);
    }
  }
  throw lastError;
}

/** Escapes a value for use inside a double-quoted Overpass QL string. */
export function qlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\t]/g, ' ');
}

/** Escapes regex metacharacters (POSIX ERE, as used by Overpass `~`). */
export function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

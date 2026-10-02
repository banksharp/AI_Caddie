// Nominatim (OpenStreetMap geocoder) name search.
// Usage policy: max 1 request/second, a real User-Agent, and no search-as-you-type —
// the app only calls course-search on submit, and results are cached in `courses`.
// https://operations.osmfoundation.org/policies/nominatim/

import { USER_AGENT } from './overpass.ts';

export interface NominatimResult {
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  category?: string;
  class?: string;
  type?: string;
  name?: string;
  display_name?: string;
  boundingbox?: [string, string, string, string]; // south, north, west, east
  address?: Record<string, string>;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

/** Searches golf courses by name. Returns only leisure=golf_course results. */
export async function searchByName(
  q: string,
  opts: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<NominatimResult[]> {
  const params = new URLSearchParams({
    q: `${q} golf`,
    format: 'jsonv2',
    limit: '10',
    addressdetails: '1',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await (opts.fetch ?? fetch)(`${NOMINATIM_URL}?${params}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`Nominatim HTTP ${res.status}`);
    }
    const results = await res.json() as NominatimResult[];
    return (Array.isArray(results) ? results : []).filter(isGolfCourse);
  } finally {
    clearTimeout(timer);
  }
}

export function isGolfCourse(r: NominatimResult): boolean {
  const cat = r.category ?? r.class;
  return cat === 'leisure' && r.type === 'golf_course';
}

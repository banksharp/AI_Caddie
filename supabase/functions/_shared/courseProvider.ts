// Course data source abstraction. OpenStreetMap today; a paid provider can implement the same
// interface later (rows would use source = 'provider').

import type { LatLng } from './geo.ts';
import { searchByName as nominatimSearch, type NominatimResult } from './nominatim.ts';
import { boundaryFromElement, parseGolfFeatures, type ParsedCourse } from './osmGolf.ts';
import { type OverpassElement, overpassQuery, qlString, regexEscape } from './overpass.ts';

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

/** Course metadata as stored in `courses` (insert/upsert shape). */
export interface CourseSummary {
  source: 'osm' | 'provider';
  osm_type: 'node' | 'way' | 'relation';
  osm_id: number;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  center_lat: number;
  center_lng: number;
  bbox_south: number | null;
  bbox_west: number | null;
  bbox_north: number | null;
  bbox_east: number | null;
}

export interface CourseRef {
  osm_type: string | null;
  osm_id: number | null;
  center_lat: number;
  center_lng: number;
  bbox_south: number | null;
  bbox_west: number | null;
  bbox_north: number | null;
  bbox_east: number | null;
}

export interface CourseGeometry extends ParsedCourse {
  boundary: LatLng[][] | null;
}

export interface CourseProvider {
  searchNearby(lat: number, lng: number, radiusM: number): Promise<CourseSummary[]>;
  searchByName(query: string, near?: { lat: number; lng: number }): Promise<CourseSummary[]>;
  fetchCourseGeometry(course: CourseRef): Promise<CourseGeometry>;
}

const DEFAULT_NAME = 'Golf course';
const NAME_SEARCH_RADIUS_M = 150_000;
const BBOX_PAD_M = 150;
const NO_BBOX_RADIUS_M = 1200;

const fin = (n: number) => n.toFixed(6);
const clean = (s: string | undefined | null) => {
  const t = (s ?? '').trim();
  return t ? t.slice(0, 200) : null;
};

/** Overpass `out tags bb` / `out` elements -> course summaries. Pure; exported for tests. */
export function elementsToSummaries(elements: OverpassElement[]): CourseSummary[] {
  const areas: CourseSummary[] = [];
  const nodes: CourseSummary[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    if (tags.leisure !== 'golf_course') continue;
    let center: LatLng | null = null;
    let bbox: [number, number, number, number] | null = null;
    if (el.bounds) {
      const b = el.bounds;
      bbox = [b.minlat, b.minlon, b.maxlat, b.maxlon];
      center = [(b.minlat + b.maxlat) / 2, (b.minlon + b.maxlon) / 2];
    } else if (typeof el.lat === 'number' && typeof el.lon === 'number') {
      center = [el.lat, el.lon];
    } else if (el.center) {
      center = [el.center.lat, el.center.lon];
    }
    if (!center) continue;
    const summary: CourseSummary = {
      source: 'osm',
      osm_type: el.type,
      osm_id: el.id,
      name: clean(tags.name) ?? DEFAULT_NAME,
      city: clean(tags['addr:city']),
      region: clean(tags['addr:state']),
      country: clean(tags['addr:country']),
      center_lat: center[0],
      center_lng: center[1],
      bbox_south: bbox?.[0] ?? null,
      bbox_west: bbox?.[1] ?? null,
      bbox_north: bbox?.[2] ?? null,
      bbox_east: bbox?.[3] ?? null,
    };
    (el.type === 'node' ? nodes : areas).push(summary);
  }
  // A course is sometimes mapped as both a node and an area: drop nodes inside an area's bbox.
  const keptNodes = nodes.filter((n) =>
    !areas.some((a) =>
      a.bbox_south !== null && n.center_lat >= a.bbox_south && n.center_lat <= a.bbox_north! &&
      n.center_lng >= a.bbox_west! && n.center_lng <= a.bbox_east!
    )
  );
  return [...areas, ...keptNodes];
}

const US_LIKE = new Set(['us', 'ca', 'au']);

/** Nominatim result -> course summary. Pure; exported for tests. */
export function nominatimToSummary(r: NominatimResult): CourseSummary | null {
  const type = r.osm_type;
  if (type !== 'node' && type !== 'way' && type !== 'relation') return null;
  const lat = Number(r.lat), lng = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || typeof r.osm_id !== 'number') return null;
  const bb = (r.boundingbox ?? []).map(Number);
  const hasBox = bb.length === 4 && bb.every(Number.isFinite);
  const a = r.address ?? {};
  const cc = (a.country_code ?? '').toLowerCase();
  const iso = a['ISO3166-2-lvl4'];
  const region = US_LIKE.has(cc) && iso?.includes('-') ? iso.split('-')[1] : (a.state ?? null);
  return {
    source: 'osm',
    osm_type: type,
    osm_id: r.osm_id,
    name: clean(r.name) ?? clean(a.golf_course) ?? clean(a.leisure) ?? DEFAULT_NAME,
    city: clean(a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb),
    region: clean(region),
    country: cc ? cc.toUpperCase() : null,
    center_lat: hasBox ? (bb[0] + bb[1]) / 2 : lat,
    center_lng: hasBox ? (bb[2] + bb[3]) / 2 : lng,
    bbox_south: hasBox ? bb[0] : null,
    bbox_north: hasBox ? bb[1] : null,
    bbox_west: hasBox ? bb[2] : null,
    bbox_east: hasBox ? bb[3] : null,
  };
}

function nearbyQuery(lat: number, lng: number, radiusM: number, nameFilter = ''): string {
  const around = `(around:${Math.round(radiusM)},${fin(lat)},${fin(lng)})`;
  const sel = `["leisure"="golf_course"]${nameFilter}`;
  // Nodes printed with coordinates; ways/relations print tags + bounds only (small response).
  return `[out:json][timeout:25];node${sel}${around};out;` +
    `(way${sel}${around};relation${sel}${around};);out tags bb;`;
}

/** Overpass query for one course's golf features (boundary element + features in its padded bbox). */
export function geometryQuery(course: CourseRef): string {
  const parts: string[] = [];
  if ((course.osm_type === 'way' || course.osm_type === 'relation') && course.osm_id) {
    parts.push(`${course.osm_type}(${course.osm_id});`);
  }
  let area: string;
  if (course.bbox_south !== null && course.bbox_west !== null && course.bbox_north !== null && course.bbox_east !== null) {
    const dLat = BBOX_PAD_M / 111_320;
    const dLng = BBOX_PAD_M / (111_320 * Math.max(0.01, Math.cos((course.center_lat * Math.PI) / 180)));
    area = `(${fin(course.bbox_south - dLat)},${fin(course.bbox_west - dLng)},${fin(course.bbox_north + dLat)},${fin(course.bbox_east + dLng)})`;
  } else {
    area = `(around:${NO_BBOX_RADIUS_M},${fin(course.center_lat)},${fin(course.center_lng)})`;
  }
  parts.push(
    `way["golf"~"^(hole|green|tee|fairway|bunker|water_hazard|lateral_water_hazard|out_of_bounds)$"]${area};`,
    `relation["golf"~"^(green|tee|fairway|bunker|water_hazard|lateral_water_hazard)$"]${area};`,
    `node["golf"="pin"]${area};`,
    `node["golf"="tee"]${area};`,
    `way["natural"="water"]${area};`,
    `relation["natural"="water"]${area};`,
  );
  return `[out:json][timeout:25];(${parts.join('')});out geom qt;`;
}

export class OsmProvider implements CourseProvider {
  async searchNearby(lat: number, lng: number, radiusM: number): Promise<CourseSummary[]> {
    return elementsToSummaries(await overpassQuery(nearbyQuery(lat, lng, radiusM)));
  }

  /** With a location: Overpass name match within 150 km. Without one (or no hits): Nominatim. */
  async searchByName(query: string, near?: { lat: number; lng: number }): Promise<CourseSummary[]> {
    if (near) {
      const filter = `["name"~"${qlString(regexEscape(query))}",i]`;
      const hits = elementsToSummaries(
        await overpassQuery(nearbyQuery(near.lat, near.lng, NAME_SEARCH_RADIUS_M, filter)),
      );
      if (hits.length) return hits;
    }
    const results = await nominatimSearch(query);
    return results.map(nominatimToSummary).filter((s): s is CourseSummary => s !== null);
  }

  async fetchCourseGeometry(course: CourseRef): Promise<CourseGeometry> {
    const elements = await overpassQuery(geometryQuery(course));
    let boundary: LatLng[][] | null = null;
    let boundaryId: string | undefined;
    if ((course.osm_type === 'way' || course.osm_type === 'relation') && course.osm_id) {
      const el = elements.find((e) => e.type === course.osm_type && e.id === course.osm_id);
      boundary = boundaryFromElement(el);
      boundaryId = `${course.osm_type === 'way' ? 'w' : 'r'}${course.osm_id}`;
    }
    return { ...parseGolfFeatures(elements, boundary, boundaryId), boundary };
  }
}

export function getCourseProvider(): CourseProvider {
  return new OsmProvider();
}

import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { OverpassError, overpassQuery, qlString, regexEscape } from '../overpass.ts';
import { isGolfCourse, searchByName } from '../nominatim.ts';
import { elementsToSummaries, geometryQuery, nominatimToSummary } from '../courseProvider.ts';

type Call = { url: string; init?: RequestInit };
function fakeFetch(responses: (() => Response | Promise<Response>)[], calls: Call[]): typeof fetch {
  let i = 0;
  return ((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i++, responses.length - 1)];
    return Promise.resolve(r());
  }) as typeof fetch;
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
const opts = { endpoints: ['https://a.test/i', 'https://b.test/i', 'https://c.test/i'], backoffMs: [1, 1, 1] };

Deno.test('overpass: posts data= with User-Agent and returns elements', async () => {
  const calls: Call[] = [];
  const els = await overpassQuery('[out:json];node(1);out;', { ...opts, fetch: fakeFetch([json({ elements: [{ type: 'node', id: 1 }] })], calls) });
  assertEquals(els.length, 1);
  assertEquals(calls[0].url, 'https://a.test/i');
  assertEquals(calls[0].init?.method, 'POST');
  assertEquals(calls[0].init?.body, 'data=' + encodeURIComponent('[out:json];node(1);out;'));
  assertEquals((calls[0].init?.headers as Record<string, string>)['User-Agent'], 'ClubSense/1.2 (clubsensesupport@gmail.com)');
});

Deno.test('overpass: rotates endpoints on 429/5xx and runtime-error remarks', async () => {
  const calls: Call[] = [];
  const els = await overpassQuery('q', {
    ...opts,
    fetch: fakeFetch([
      () => new Response('busy', { status: 429 }),
      () => new Response('oops', { status: 504 }),
      json({ elements: [], remark: 'runtime error: Query timed out in "query" at line 1' }),
      json({ elements: [{ type: 'way', id: 2 }] }),
    ], calls),
  });
  assertEquals(els.map((e) => e.id), [2]);
  assertEquals(calls.map((c) => c.url), ['https://a.test/i', 'https://b.test/i', 'https://c.test/i', 'https://a.test/i']);
});

Deno.test('overpass: 400 fails immediately', async () => {
  const calls: Call[] = [];
  const err = await assertRejects(
    () => overpassQuery('bad', { ...opts, fetch: fakeFetch([() => new Response('parse error', { status: 400 })], calls) }),
    OverpassError,
  );
  assertEquals(err.status, 400);
  assertEquals(calls.length, 1);
});

Deno.test('overpass: gives up after 4 attempts', async () => {
  const calls: Call[] = [];
  await assertRejects(
    () => overpassQuery('q', { ...opts, fetch: fakeFetch([() => new Response('', { status: 503 })], calls) }),
    OverpassError,
  );
  assertEquals(calls.length, 4);
});

Deno.test('overpass: timeout aborts and retries', async () => {
  let n = 0;
  const f = ((_url: string, init?: RequestInit) => {
    n++;
    if (n === 1) {
      return new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      });
    }
    return Promise.resolve(new Response(JSON.stringify({ elements: [] })));
  }) as typeof fetch;
  const els = await overpassQuery('q', { ...opts, timeoutMs: 20, fetch: f });
  assertEquals(els, []);
  assertEquals(n, 2);
});

Deno.test('QL escaping', () => {
  assertEquals(regexEscape('St. Andrews (Old)'), 'St\\. Andrews \\(Old\\)');
  assertEquals(qlString('a"b\\c'), 'a\\"b\\\\c');
});

Deno.test('nominatim: query format and golf_course filter', async () => {
  const calls: Call[] = [];
  const results = await searchByName('Torrey Pines', {
    fetch: fakeFetch([json([
      { osm_type: 'way', osm_id: 1, category: 'leisure', type: 'golf_course', lat: '32.9', lon: '-117.25' },
      { osm_type: 'node', osm_id: 2, category: 'amenity', type: 'restaurant', lat: '32.9', lon: '-117.25' },
      { osm_type: 'way', osm_id: 3, class: 'leisure', type: 'golf_course', lat: '32.9', lon: '-117.25' },
    ])], calls),
  });
  assertEquals(results.map((r) => r.osm_id), [1, 3]);
  const url = new URL(calls[0].url);
  assertEquals(url.origin + url.pathname, 'https://nominatim.openstreetmap.org/search');
  assertEquals(url.searchParams.get('q'), 'Torrey Pines golf');
  assertEquals(url.searchParams.get('format'), 'jsonv2');
  assertEquals(url.searchParams.get('limit'), '10');
  assertEquals(url.searchParams.get('addressdetails'), '1');
  assert(isGolfCourse({ category: 'leisure', type: 'golf_course' }));
});

Deno.test('elementsToSummaries: bbox center, node coords, unnamed, node-in-area dedupe', () => {
  const s = elementsToSummaries([
    { type: 'way', id: 10, tags: { leisure: 'golf_course', name: 'Alpha', 'addr:city': 'Town', 'addr:state': 'CA', 'addr:country': 'US' }, bounds: { minlat: 1, minlon: 2, maxlat: 3, maxlon: 4 } },
    { type: 'node', id: 11, tags: { leisure: 'golf_course', name: 'Alpha dup' }, lat: 2, lon: 3 },
    { type: 'node', id: 12, tags: { leisure: 'golf_course' }, lat: 10, lon: 20 },
    { type: 'relation', id: 13, tags: { leisure: 'park' }, bounds: { minlat: 0, minlon: 0, maxlat: 1, maxlon: 1 } },
  ]);
  assertEquals(s.map((c) => `${c.osm_type}/${c.osm_id}`), ['way/10', 'node/12']);
  assertEquals(s[0], {
    source: 'osm', osm_type: 'way', osm_id: 10, name: 'Alpha', city: 'Town', region: 'CA', country: 'US',
    center_lat: 2, center_lng: 3, bbox_south: 1, bbox_west: 2, bbox_north: 3, bbox_east: 4,
  });
  assertEquals(s[1].name, 'Golf course');
  assertEquals(s[1].bbox_south, null);
});

Deno.test('nominatimToSummary maps address and bbox', () => {
  const s = nominatimToSummary({
    osm_type: 'relation', osm_id: 5, lat: '32.9', lon: '-117.2', name: 'Torrey Pines Golf Course',
    boundingbox: ['32.8', '33.0', '-117.3', '-117.1'],
    address: { city: 'San Diego', state: 'California', 'ISO3166-2-lvl4': 'US-CA', country_code: 'us' },
  })!;
  assertEquals(s.region, 'CA');
  assertEquals(s.country, 'US');
  assertEquals(s.city, 'San Diego');
  assertEquals([s.bbox_south, s.bbox_north, s.bbox_west, s.bbox_east], [32.8, 33.0, -117.3, -117.1]);
  assertEquals(nominatimToSummary({ osm_type: 'area' }), null);
});

Deno.test('geometryQuery pads the bbox and includes the boundary element', () => {
  const q = geometryQuery({
    osm_type: 'way', osm_id: 77, center_lat: 0, center_lng: 0,
    bbox_south: 0, bbox_west: 0, bbox_north: 0.01, bbox_east: 0.01,
  });
  assert(q.startsWith('[out:json][timeout:25];(way(77);'));
  assert(q.includes('(-0.001347,-0.001347,0.011347,0.011347)'));
  assert(q.endsWith('out geom qt;'));
  const q2 = geometryQuery({
    osm_type: 'node', osm_id: 1, center_lat: 1, center_lng: 2,
    bbox_south: null, bbox_west: null, bbox_north: null, bbox_east: null,
  });
  assert(q2.includes('(around:1200,1.000000,2.000000)'));
  assert(!q2.includes('node(1)'));
});

# GPS rounds: shared contracts

The interfaces between the database, edge functions and the app for the GPS course
map, live yardage and "Ask Club Sense" shot advice. Change this file first if a
contract has to change.

## Product decisions

- Course data: OpenStreetMap (Overpass + Nominatim), fetched by edge functions and
  cached in Postgres, once per course. Behind a `courseProvider` interface so a paid
  source can be added later.
- When a hole has no green data, the user taps the green on the satellite map; the pin
  is saved privately for that user (`user_hole_pins`) and reused.
- Free: course search, course detail, map, GPS yardage. Pro (subscription + saved
  clubs): `shot-recommendation`.
- AI advice is labelled for casual play. A **Tournament mode** setting (stored on the
  device, AsyncStorage key `settings:tournamentMode`, `"1"` = on) hides Ask Club Sense
  so only distances show.
- Yards only. Wind/elevation are manual chips. The tee used for hole length is the one
  farthest from the green. Android is out of scope (iOS / Apple Maps only).
- Attribution `© OpenStreetMap contributors` is always visible on the map.
- Location never leaves the phone except: course search sends a lat/lng to
  `course-search` (not logged), and the shot request sends distances, not coordinates.

## Coordinates

Always `[lat, lng]` arrays in JSON and storage. Convert to `{ latitude, longitude }`
only inside map components.

## Database (`supabase/migrations/006_courses_gps.sql`)

- `courses` (shared cache, authenticated read, service-role write): `id bigint`,
  `source`, `osm_type`, `osm_id`, `name`, `city`, `region`, `country`, `center_lat`,
  `center_lng`, `bbox_south/west/north/east`, `boundary jsonb`, `hole_data_status`
  (`unknown|fetching|ready|partial|none|error`), `hole_count`, `unassigned_greens jsonb`,
  `geometry_fetched_at`, `fetch_started_at`, `fetch_error`.
- `course_holes` (shared cache): one row per `(course_id, loop_key, hole_number)`.
- `course_search_cells` (service role only): 0.1° grid cache of nearby searches.
- `user_hole_pins` (owner-only RLS, written directly by the app with an upsert on
  `user_id,course_id,loop_key,hole_number`): `course_id`, `loop_key` (default `''`),
  `hole_number`, `par`, `green_center_lat/lng` (required), `green_front_lat/lng`,
  `green_back_lat/lng`, `tee_lat/lng`.
- `rounds` gains `course_id bigint null`, `loop_keys text[] null`,
  `finished_at timestamptz null`. `course_name` stays as the display name.

## CourseHole (returned by `course-detail`, cached on the device)

```json
{
  "hole_number": 7,
  "loop_key": "",
  "par": 4,
  "handicap": 11,
  "length_yds": 412,
  "tee": [32.89, -117.25],
  "line": [[32.89, -117.25], [32.891, -117.248]],
  "green": {
    "center": [32.892, -117.247],
    "front": [32.8919, -117.2471],
    "back": [32.8921, -117.2469],
    "polygon": [[32.8919, -117.2472], [32.8921, -117.2471], [32.8921, -117.2468]]
  },
  "hazards": [
    { "id": "w123", "kind": "bunker", "name": null, "polygon": [[32.89, -117.24], [32.8901, -117.24], [32.8901, -117.2401]] }
  ],
  "source": "osm"
}
```

- `kind`: `bunker | water | lateral_water | ob`.
- Any of `tee`, `line`, `green.*`, `par`, `handicap`, `length_yds` may be `null`.
- The app merges `user_hole_pins` over this: a pin overrides `green.center/front/back`,
  `tee` and `par`, and sets `source: "user"`. A hole that only exists as a pin is added.

## `course-search` (signed-in user, free)

Request: `{ "lat"?: number, "lng"?: number, "query"?: string, "radius_m"?: number }`.
Either `lat`+`lng` or `query` (2–80 chars). `radius_m` default 25000, max 50000.

Response 200:

```json
{
  "courses": [
    { "id": 12, "name": "Torrey Pines (South)", "city": "La Jolla", "region": "CA",
      "center_lat": 32.9, "center_lng": -117.25, "distance_m": 1834,
      "hole_data_status": "ready", "hole_count": 18, "source": "osm" }
  ],
  "degraded": false
}
```

`distance_m` is `null` without lat/lng. Errors: 400 `{detail}`, 401, 503
`{detail, code: "provider_unavailable", courses: [...cached], degraded: true}`.

## `course-detail` (signed-in user, free)

Request: `{ "course_id": number, "refresh"?: boolean }`.

Response 200:

```json
{
  "course": { "id": 12, "name": "…", "city": "…", "region": "…", "center_lat": 0, "center_lng": 0,
              "bbox_south": 0, "bbox_west": 0, "bbox_north": 0, "bbox_east": 0,
              "hole_data_status": "ready", "hole_count": 18 },
  "status": "ready",
  "holes": [ "CourseHole…" ],
  "unassigned_greens": [ { "id": "w99", "center": [0, 0], "polygon": [[0, 0]] } ],
  "attribution": "© OpenStreetMap contributors"
}
```

`status`: `ready | partial | none | fetching | error`. On `fetching` the app retries
after 2s, 4s, 8s. On `error` (503) the app falls back to tap-to-set pins.

## `shot-recommendation` (subscription + saved clubs)

Request (validated server-side):

```json
{
  "distance_to_pin_yds": 156,
  "distance_to_front_yds": 148,
  "distance_to_back_yds": 165,
  "hole": { "number": 7, "par": 4, "length_yds": 412 },
  "shot_number": 2,
  "lie": "fairway",
  "wind": { "direction": "into", "strength_mph": 10 },
  "elevation": "flat",
  "hazards": [
    { "kind": "water", "side": "right", "reach_yds": 140, "carry_yds": 162, "lateral_yds": 12, "in_play": true }
  ],
  "gps_accuracy_yds": 4,
  "source": "osm"
}
```

- `distance_to_pin_yds` 1–700 (required). Front/back 1–750 optional.
- `lie`: `tee|fairway|first_cut|rough|deep_rough|sand|hardpan|pine_straw`.
- `wind.direction`: `calm|into|down|left_to_right|right_to_left|into_left|into_right|down_left|down_right`; `strength_mph` 0–50.
- `elevation`: `flat|uphill|downhill`. `hazards` max 8. `source`: `osm|user_pin|manual`.

Response 200 `{ "data": ShotAdvice, "status": "success" }`, or the text fallback
`{ "advice": "…", "status": "success", "format": "text" }`:

```json
{
  "club": "7-Iron",
  "alternateClub": "6-Iron",
  "shotType": "full",
  "target": { "description": "Center of the green, away from the water", "aimSide": "left", "aimOffsetYds": 5 },
  "carryNeededYds": 152,
  "playsLikeYds": 164,
  "playsLikeNotes": ["10 mph into the wind adds about a club"],
  "hazardsInPlay": [{ "hazard": "Water right", "note": "162 to carry; miss left is safe" }],
  "risk": { "level": "medium", "bailout": "Front-left of the green", "notes": "Short-sided right brings water in" },
  "why": ["Your 7-iron carries 155", "Into the wind, take the extra club if between"]
}
```

`shotType`: `full|three_quarter|knockdown|punch|layup|pitch|chip|bunker|putt`.
`club` is always a club from the user's bag. Errors: 400, 401, 403
`{code: "subscription_required"}`, 400 `"Club distances not set up"`, 500.

# Handoff: GPS rounds

Status as of 2026-10-02. Update this file when the status changes.

## Done and live

- Security and subscription fixes, Green book login/create-account design, Club Sense
  rebrand, faster Profile tab: merged to `main` (PRs #1–#9) and deployed where server-side.
- Version 1.2.0 with the new login screen builds from `main` (see CLAUDE.md). The user
  has release notes and an updated App Store description for it.

## Built, not deployed: branch `gps-rounds` (open PR into `main`)

GPS course map, live yardage and "Ask Club Sense" shot advice in the Round tab, plus
iPad width caps on all screens. Contracts and product decisions: `docs/gps-contracts.md`.

Verified on the branch: `npx jest` in mobile/ (47 geo tests), `npx -y deno test
_shared/__tests__/` in supabase/functions (41 tests), `deno check` on every function,
and `npx expo export --platform ios` bundles the whole app. Nothing has run on a device,
against real Overpass data, or against the real AI model.

Server pieces:
- `supabase/migrations/006_courses_gps.sql`: courses, course_holes, course_search_cells,
  user_hole_pins, rounds.course_id/loop_keys/finished_at, search_courses_by_name,
  claim_course_fetch, replace_course_holes. pg_trgm is not installed yet in production;
  the migration creates it in the `extensions` schema.
- Functions `course-search`, `course-detail` (OpenStreetMap via Overpass/Nominatim, cached;
  first course fetch can take ~60 s), `shot-recommendation` (Pro; Claude, picks clubs from
  the user's bag). Shared code in `_shared/{auth,geo,overpass,nominatim,osmGolf,courseProvider}.ts`
  and additions to `_shared/ai.ts`.

App pieces:
- Dependencies: react-native-maps 1.20.1 (runs through the New Architecture interop layer;
  markers kept simple), expo-location ~19.0.8 (when-in-use only), AsyncStorage 2.2.0, jest.
- `mobile/src/geo/` distance + hole detection, `mobile/src/location/` GPS hooks,
  `mobile/src/courseApi.js`, `mobile/src/round/` (session + offline queue),
  `mobile/src/components/round/*` (course picker, map, yardage, hazards, green setup,
  shot advice card, score entry, scorecard), `mobile/src/settings.js` (Tournament mode),
  `mobile/app/(tabs)/round.js` rewritten. Course search sends coordinates rounded to
  2 decimals. Privacy pages have a Location section.

## Next steps

1. Review/merge the `gps-rounds` PR (or keep testing on the branch first).
2. With the user's OK and a fresh Supabase token: `npx -y supabase@latest migration list --linked`,
   then `db push --linked` (applies 006), then
   `functions deploy course-search course-detail shot-recommendation`.
3. Development build: `cd mobile && npx eas-cli build --platform ios --profile development`
   (maps/location are new native modules). Consider `npx expo install --fix` first
   (expo-doctor reports patch drift: expo 54.0.33→~54.0.37, react-native 0.81.4→0.81.5, others).
4. On-device testing (listed by the round UI engineer): map camera zoom/rotation, tap-to-measure
   vs marker taps, OSM label vs Apple legal label, polygons/circles under the New Architecture,
   location permission flow (denied → Settings → back), airplane mode mid-round, kill/resume,
   offline green setup, two-nines courses, slow first course fetch, keyboard on small iPhones,
   AI advice as subscriber vs not, Tournament mode. Compare yardages with a rangefinder.
5. Before release: App Store privacy label → Coarse Location, not linked, app functionality;
   bump the app version; add a GPS section to the App Store description.

# Club Sense (formerly AI Caddie / My cAIddie)

iOS golf app: AI club recommendations, hole strategy, round tracking, subscriptions.
App Store listing name "Club Sense - Golf"; home-screen name "Club Sense".

## Stack and layout

- `mobile/`: Expo SDK 54, React Native 0.81, expo-router, expo-dev-client, EAS builds.
  `app/` screens (tabs: index = Caddie, round, clubs, history, profile), `src/` shared code
  (`api.js`, `AuthContext.js`, `SubscriptionContext.js`, `PaywallScreen.js`, `GreenBook.js`).
- `supabase/`: Postgres migrations (`migrations/00N_*.sql`) and Deno edge functions
  (`functions/*/index.ts`, shared code in `functions/_shared/`).
- `docs/`: privacy/terms/support pages served by GitHub Pages from `main`
  (https://banksharp.github.io/AI_Caddie/...). `supabase/legal-pages/` holds older copies.
- GitHub: `banksharp/AI_Caddie`, default branch `main` (local branch is `master`).
- Supabase project ref `gnfokeidwbmzgykmwluz` (dashboard name "My cAIddie").

## Preferences and conventions

- Never add Claude/AI attribution to commits or PRs (also set globally in ~/.claude/settings.json).
- Work on a feature branch, open a PR; the user merges.
- Deploying edge functions and pushing migrations affect production: confirm with the user
  first. The Supabase CLI needs `npx supabase login --token ...`; the user deletes tokens
  after use, so expect to ask for a new one. Run CLI commands from the repo root
  (`--linked` uses supabase/.temp). Use `npx -y supabase@latest`.
- Verify JS with `node -e "require('@babel/core').transformFileSync(f,{presets:['babel-preset-expo']})"`
  from `mobile/`, the whole app with `npx expo export --platform ios --output-dir <tmp>`,
  and edge functions with `npx -y deno check <fn>/index.ts` from `supabase/functions`.
- Don't guess at causes: get real data (DB rows, error text, library source) before fixing.

## Things that must not change

- iOS bundle ID `com.cAIddie.aicaddie` and product IDs `caiddie_pro_monthly` /
  `caiddie_pro_yearly` (required by the App Store transfer; users never see them).
- Expo slug `my-caiddie` (must match the EAS project; expo.dev can't rename it).
- Link scheme is `clubsense://` (Supabase Auth redirect URLs include
  `clubsense://auth/callback` and the old `ai-caddie://` one).

## Subscriptions (Apple)

- Server-side only: `subscription-verify` (purchase/restore) and `subscription-sync`
  (Profile refresh) call the App Store Server API with an In-App Purchase key from the
  user's own developer account (secrets APPLE_KEY_ID, APPLE_ISSUER_ID, APPLE_PRIVATE_KEY,
  APPLE_BUNDLE_ID). Live API first, sandbox fallback on 404 (`_shared/apple.ts`).
  APPLE_SANDBOX is no longer used.
- Both use the subscription matching the stored `apple_original_transaction_id` and its
  latest status (expired/revoked = no access). Access belongs to the Club Sense login,
  not the Apple ID. Subscription columns on `profiles` are server-write only (migration 003).
- Profile id `11c594ed-…` is the owner's account with a 100-year admin grant.
- TestFlight purchases on the owner's real Apple ID hit a stale expired sandbox entitlement
  from before the app transfer; test purchases with a separate sandbox Apple ID.

## Build and release

```
cd ~/Documents/Caiddie && git checkout master && git pull origin main
cd mobile && npm install
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --latest
```

Must run in the user's own Terminal (Apple login needs a TTY). Build numbers are managed
by EAS (`appVersionSource: remote`). App version is 1.2.0 in `mobile/app.json`. No
expo-updates, so every app change ships in a store build. A development build
(`--profile development`) plus `npx expo start` gives live reload on a phone.

## Current work: GPS rounds (branch `gps-rounds`, not merged or deployed)

Course map + GPS yardage + "Ask Club Sense" shot advice in the Round tab. Contracts and
product decisions are in `docs/gps-contracts.md` (read it first). Decisions: free
OpenStreetMap data cached in Postgres, tap-to-set greens when a course has no data,
map/yardage free and AI advice Pro, casual-play label plus a Tournament mode switch.

Work was split across four parallel agents (files per owner):
- Server courses: `supabase/migrations/006_courses_gps.sql`, `_shared/{auth,geo,overpass,nominatim,osmGolf,courseProvider}.ts`,
  `functions/course-search`, `functions/course-detail`, `_shared/__tests__/`.
- AI: `functions/shot-recommendation/`, additions to `_shared/ai.ts`, `mobile/src/shotApi.js`,
  `mobile/src/settings.js` (Tournament mode), `mobile/src/components/round/ShotAdviceCard.js`, a switch in profile.js.
- Platform: `mobile/package.json`/`app.json` (react-native-maps 1.20.1, expo-location,
  AsyncStorage, jest), `mobile/src/geo/*` + tests, `mobile/src/location/*`, privacy pages.
- Round UI: `mobile/app/(tabs)/round.js`, `history.js`, `mobile/src/api.js`, `mobile/src/courseApi.js`,
  `mobile/src/round/*`, `mobile/src/components/round/*`.

See `docs/HANDOFF.md` for the latest status and next steps.

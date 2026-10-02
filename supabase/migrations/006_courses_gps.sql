-- GPS rounds: shared course cache (OpenStreetMap), per-user green pins, round <-> course link.
-- Contracts: docs/gps-contracts.md.
--
-- Access model:
--   courses / course_holes   : any signed-in user may read; only edge functions (service_role)
--                              write. Writes go through course-search / course-detail.
--   course_search_cells      : service_role only (grid cache of nearby searches).
--   user_hole_pins           : owner-only, written directly by the app (upsert on
--                              user_id,course_id,loop_key,hole_number).
-- Supabase grants ALL on new public tables to anon/authenticated by default (003 only
-- adjusted profiles), so the client-facing privileges are revoked/granted explicitly here.

create extension if not exists pg_trgm with schema extensions;

-- 1. Courses -------------------------------------------------------------------------------

create table public.courses (
  id bigint generated always as identity primary key,
  source text not null default 'osm' check (source in ('osm', 'user', 'provider')),
  osm_type text check (osm_type in ('node', 'way', 'relation')),
  osm_id bigint,
  name text not null,
  city text,
  region text,
  country text,
  center_lat double precision not null check (center_lat between -90 and 90),
  center_lng double precision not null check (center_lng between -180 and 180),
  bbox_south double precision,
  bbox_west double precision,
  bbox_north double precision,
  bbox_east double precision,
  -- Course boundary as an array of outer rings: [[[lat, lng], ...], ...]. Null when unknown.
  boundary jsonb,
  hole_data_status text not null default 'unknown'
    check (hole_data_status in ('unknown', 'fetching', 'ready', 'partial', 'none', 'error')),
  hole_count int,
  unassigned_greens jsonb not null default '[]',
  geometry_fetched_at timestamptz,
  fetch_started_at timestamptz,
  fetch_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (osm_type, osm_id)
);

create index courses_center_idx on public.courses (center_lat, center_lng);
create index courses_name_trgm_idx on public.courses using gin (name extensions.gin_trgm_ops);

-- 2. Holes ---------------------------------------------------------------------------------

create table public.course_holes (
  id bigint generated always as identity primary key,
  course_id bigint not null references public.courses(id) on delete cascade,
  -- '' for a single loop; otherwise the OSM golf:course:name or a derived 'A'/'B'/... label.
  loop_key text not null default '',
  hole_number int not null check (hole_number between 1 and 36),
  par int check (par between 3 and 6),
  handicap int check (handicap between 1 and 36),
  length_yds int check (length_yds between 30 and 800),
  hole_line jsonb,               -- [[lat, lng], ...] tee -> green
  tee_lat double precision,
  tee_lng double precision,
  green_center_lat double precision,
  green_center_lng double precision,
  green_front_lat double precision,
  green_front_lng double precision,
  green_back_lat double precision,
  green_back_lng double precision,
  green_polygon jsonb,           -- [[lat, lng], ...]
  tees jsonb not null default '[]',      -- [[lat, lng], ...] tee box centroids
  fairways jsonb not null default '[]',  -- [[[lat, lng], ...], ...]
  hazards jsonb not null default '[]',   -- [{id, kind, name, polygon}]
  osm_way_id bigint,
  unique (course_id, loop_key, hole_number)
);
-- The unique (course_id, loop_key, hole_number) index already serves lookups by course_id,
-- so no separate course_id index is created.

-- 3. Nearby-search grid cache ---------------------------------------------------------------

create table public.course_search_cells (
  cell_key text primary key,              -- 0.1 degree grid, e.g. '33.1:-117.3'
  course_ids bigint[] not null default '{}',
  radius_m int not null default 25000,    -- radius that was searched (a cache hit needs >= requested)
  searched_at timestamptz not null default now()
);

-- 4. Per-user green pins (tap-to-set when OSM has no green) ---------------------------------

create table public.user_hole_pins (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  course_id bigint not null references public.courses(id) on delete cascade,
  loop_key text not null default '',
  hole_number int not null check (hole_number between 1 and 36),
  par int check (par between 3 and 6),
  green_center_lat double precision not null check (green_center_lat between -90 and 90),
  green_center_lng double precision not null check (green_center_lng between -180 and 180),
  green_front_lat double precision check (green_front_lat between -90 and 90),
  green_front_lng double precision check (green_front_lng between -180 and 180),
  green_back_lat double precision check (green_back_lat between -90 and 90),
  green_back_lng double precision check (green_back_lng between -180 and 180),
  tee_lat double precision check (tee_lat between -90 and 90),
  tee_lng double precision check (tee_lng between -180 and 180),
  updated_at timestamptz not null default now(),
  unique (user_id, course_id, loop_key, hole_number)
);
-- The unique index (user_id, ...) covers "my pins for this course" lookups.

-- 5. Rounds <-> course -----------------------------------------------------------------------

alter table public.rounds
  add column course_id bigint references public.courses(id) on delete set null,
  add column loop_keys text[],
  add column finished_at timestamptz;

create index rounds_user_started_idx on public.rounds (user_id, started_at desc);

-- 6. Row level security and privileges -------------------------------------------------------

alter table public.courses enable row level security;
alter table public.course_holes enable row level security;
alter table public.course_search_cells enable row level security;
alter table public.user_hole_pins enable row level security;

-- Shared cache: clients read only; edge functions write with service_role (bypasses RLS).
revoke insert, update, delete, truncate on public.courses from anon, authenticated;
revoke insert, update, delete, truncate on public.course_holes from anon, authenticated;
revoke all on public.course_search_cells from anon, authenticated;
revoke all on public.courses from anon;
revoke all on public.course_holes from anon;

create policy "Authenticated read courses" on public.courses
  for select to authenticated using (true);
create policy "Authenticated read course holes" on public.course_holes
  for select to authenticated using (true);
-- course_search_cells: no policies => no client access even if privileges were re-granted.

-- user_hole_pins: owner-only.
revoke all on public.user_hole_pins from anon;
revoke truncate on public.user_hole_pins from authenticated;
grant select, insert, update, delete on public.user_hole_pins to authenticated;

create policy "Users read own hole pins" on public.user_hole_pins
  for select to authenticated using (auth.uid() = user_id);
create policy "Users insert own hole pins" on public.user_hole_pins
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Users update own hole pins" on public.user_hole_pins
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own hole pins" on public.user_hole_pins
  for delete to authenticated using (auth.uid() = user_id);

-- 7. Functions --------------------------------------------------------------------------------

-- Name search (security invoker: runs with the caller's RLS, i.e. authenticated read).
-- Trigram similarity plus substring match; nearest first when a location is given.
create or replace function public.search_courses_by_name(
  q text,
  p_lat double precision default null,
  p_lng double precision default null,
  lim int default 20
)
returns setof public.courses
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
  from public.courses c
  where c.name operator(extensions.%) q
     or c.name ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by
    extensions.similarity(c.name, q) desc,
    case
      when p_lat is null or p_lng is null then 0
      else power(c.center_lat - p_lat, 2) + power((c.center_lng - p_lng) * cos(radians(p_lat)), 2)
    end asc,
    c.id
  limit least(greatest(coalesce(lim, 20), 1), 50);
$$;

revoke execute on function public.search_courses_by_name(text, double precision, double precision, int) from public, anon;
grant execute on function public.search_courses_by_name(text, double precision, double precision, int) to authenticated;

-- Claims the right to fetch a course's geometry (one fetcher at a time). Returns true if the
-- caller should fetch. A 'fetching' claim older than 2 minutes is considered abandoned.
-- 'error' is retried after a 2 minute cooldown so a broken course can't hammer Overpass.
create or replace function public.claim_course_fetch(
  p_course_id bigint,
  p_ttl interval default interval '180 days',
  p_force boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed bigint;
begin
  update public.courses c
  set hole_data_status = 'fetching',
      fetch_started_at = now(),
      updated_at = now()
  where c.id = p_course_id
    and (
      c.hole_data_status = 'unknown'
      or (c.hole_data_status = 'error'
          and (c.fetch_started_at is null or c.fetch_started_at < now() - interval '2 minutes'))
      or (c.hole_data_status = 'fetching'
          and (c.fetch_started_at is null or c.fetch_started_at < now() - interval '2 minutes'))
      or (c.hole_data_status in ('ready', 'partial', 'none')
          and (p_force or c.geometry_fetched_at is null or c.geometry_fetched_at < now() - p_ttl))
    )
  returning c.id into claimed;
  return claimed is not null;
end;
$$;

-- Atomically replaces a course's holes and records the fetch result.
-- p_holes: array of objects with course_holes column names (no id / course_id).
-- Out-of-range numeric values are stored as null rather than failing the whole fetch.
create or replace function public.replace_course_holes(
  p_course_id bigint,
  p_holes jsonb,
  p_status text,
  p_unassigned_greens jsonb,
  p_boundary jsonb,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('ready', 'partial', 'none', 'error') then
    raise exception 'invalid status %', p_status;
  end if;

  delete from public.course_holes where course_id = p_course_id;

  insert into public.course_holes (
    course_id, loop_key, hole_number, par, handicap, length_yds, hole_line,
    tee_lat, tee_lng, green_center_lat, green_center_lng,
    green_front_lat, green_front_lng, green_back_lat, green_back_lng,
    green_polygon, tees, fairways, hazards, osm_way_id
  )
  select
    p_course_id,
    coalesce(h.loop_key, ''),
    h.hole_number,
    case when h.par between 3 and 6 then h.par end,
    case when h.handicap between 1 and 36 then h.handicap end,
    case when h.length_yds between 30 and 800 then h.length_yds end,
    h.hole_line,
    h.tee_lat, h.tee_lng, h.green_center_lat, h.green_center_lng,
    h.green_front_lat, h.green_front_lng, h.green_back_lat, h.green_back_lng,
    h.green_polygon,
    coalesce(h.tees, '[]'::jsonb),
    coalesce(h.fairways, '[]'::jsonb),
    coalesce(h.hazards, '[]'::jsonb),
    h.osm_way_id
  from jsonb_to_recordset(coalesce(p_holes, '[]'::jsonb)) as h(
    loop_key text, hole_number int, par int, handicap int, length_yds int, hole_line jsonb,
    tee_lat double precision, tee_lng double precision,
    green_center_lat double precision, green_center_lng double precision,
    green_front_lat double precision, green_front_lng double precision,
    green_back_lat double precision, green_back_lng double precision,
    green_polygon jsonb, tees jsonb, fairways jsonb, hazards jsonb, osm_way_id bigint
  )
  where h.hole_number between 1 and 36
  on conflict (course_id, loop_key, hole_number) do nothing;

  update public.courses
  set hole_data_status = p_status,
      hole_count = (select count(*) from public.course_holes where course_id = p_course_id),
      unassigned_greens = coalesce(p_unassigned_greens, '[]'::jsonb),
      boundary = p_boundary,
      geometry_fetched_at = now(),
      fetch_error = p_error,
      updated_at = now()
  where id = p_course_id;
end;
$$;

revoke execute on function public.claim_course_fetch(bigint, interval, boolean) from public, anon, authenticated;
revoke execute on function public.replace_course_holes(bigint, jsonb, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.claim_course_fetch(bigint, interval, boolean) to service_role;
grant execute on function public.replace_course_holes(bigint, jsonb, text, jsonb, jsonb, text) to service_role;

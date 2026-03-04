-- Profiles (extends auth.users with app-specific data)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text not null,
  clubs jsonb default '{}',
  subscription_expires_at timestamptz
);

-- Rounds
create table public.rounds (
  id serial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_name text,
  started_at timestamptz not null default now(),
  total_score int
);

-- Holes
create table public.holes (
  id serial primary key,
  round_id int not null references public.rounds(id) on delete cascade,
  hole_number int not null,
  par int,
  strokes int not null,
  putts int,
  fairway_hit boolean,
  gir boolean,
  notes text
);

-- Auto-create profile when a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, first_name, last_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    new.email
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.rounds enable row level security;
alter table public.holes enable row level security;

-- Profiles: users read/update their own
create policy "Users read own profile" on profiles for select using (auth.uid() = id);
create policy "Users update own profile" on profiles for update using (auth.uid() = id);

-- Rounds: users CRUD their own
create policy "Users read own rounds" on rounds for select using (auth.uid() = user_id);
create policy "Users insert own rounds" on rounds for insert with check (auth.uid() = user_id);
create policy "Users delete own rounds" on rounds for delete using (auth.uid() = user_id);
create policy "Users update own rounds" on rounds for update using (auth.uid() = user_id);

-- Holes: users CRUD holes in their rounds
create policy "Users read own holes" on holes for select
  using (round_id in (select id from rounds where user_id = auth.uid()));
create policy "Users insert own holes" on holes for insert
  with check (round_id in (select id from rounds where user_id = auth.uid()));
create policy "Users delete own holes" on holes for delete
  using (round_id in (select id from rounds where user_id = auth.uid()));
create policy "Users update own holes" on holes for update
  using (round_id in (select id from rounds where user_id = auth.uid()));

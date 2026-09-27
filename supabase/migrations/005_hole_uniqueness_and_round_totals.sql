-- 1. One row per hole per round.
-- The app saves holes as hole_number = holes.length + 1, so a double-tap or a retry after
-- a network error inserted the same hole twice. Remove existing duplicates (keeping the
-- most recently saved row), then enforce uniqueness so the client can upsert.
delete from public.holes h
using public.holes newer
where h.round_id = newer.round_id
  and h.hole_number = newer.hole_number
  and h.id < newer.id;

alter table public.holes
  add constraint holes_round_id_hole_number_key unique (round_id, hole_number);

-- 2. Keep rounds.total_score in sync with its holes.
-- Previously the client summed strokes and wrote total_score in separate requests, so a
-- failure part-way (or two concurrent saves) left a stale total that the app then displayed.
create or replace function public.update_round_total_score()
returns trigger as $$
declare
  target_round int;
begin
  target_round := coalesce(new.round_id, old.round_id);
  update public.rounds
  set total_score = (select sum(strokes) from public.holes where round_id = target_round)
  where id = target_round;

  -- A hole moved to another round (not done by the app, but keep both totals right).
  if tg_op = 'UPDATE' and new.round_id is distinct from old.round_id then
    update public.rounds
    set total_score = (select sum(strokes) from public.holes where round_id = old.round_id)
    where id = old.round_id;
  end if;

  return null;
end;
$$ language plpgsql security definer set search_path = '';

create trigger holes_update_round_total
  after insert or update or delete on public.holes
  for each row execute function public.update_round_total_score();

-- 3. Backfill totals for existing rounds.
update public.rounds r
set total_score = (select sum(strokes) from public.holes h where h.round_id = r.id);

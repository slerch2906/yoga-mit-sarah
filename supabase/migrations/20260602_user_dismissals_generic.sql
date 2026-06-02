-- Sarah 2026-06-02: Zentrale, wiederverwendbare Wegklick-Persistenz fuer ALLE
-- Admin-/Yogi-Hinweise. Pro Nutzer + key in der DB -> logout-fest und
-- geraeteuebergreifend. Loest die wiederkehrenden Banner ein fuer alle Mal.
create table if not exists public.user_dismissals (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.user_dismissals enable row level security;

drop policy if exists "user reads own dismissals" on public.user_dismissals;
create policy "user reads own dismissals" on public.user_dismissals
  for select using (auth.uid() = user_id);

drop policy if exists "user inserts own dismissals" on public.user_dismissals;
create policy "user inserts own dismissals" on public.user_dismissals
  for insert with check (auth.uid() = user_id);

-- Backfill: bisher schon weggeklickte Hinweise uebernehmen, damit nichts zurueckspringt
insert into public.user_dismissals(user_id, key)
  select id, 'new_yogi' from public.profiles where new_yogi_hint_dismissed = true
  on conflict do nothing;

insert into public.user_dismissals(user_id, key)
  select p.id, 'birthday:'||to_char(d.week,'YYYY-MM-DD')
  from public.admin_banner_dismissals d
  cross join public.profiles p
  where d.banner = 'birthday' and p.is_admin = true
  on conflict do nothing;

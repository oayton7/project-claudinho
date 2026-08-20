-- Multi-user schema, with no login work.
--
-- The brief's argument: a day now, a painful migration later once there is
-- real data. There are already 169 candidate rows, so "later" has started.
--
-- Nothing about authentication changes. The shared password stays, every row
-- gets a user_id, every query filters on it, and row-level security is written
-- and enabled now so it is exercised with one user rather than switched on for
-- the first time when it matters.
--
-- The seed user exists so existing rows have somewhere to belong. Backfilled
-- rather than left null, because a nullable owner column is the thing that
-- makes the migration painful in the first place.

create table if not exists app_users (
  id          uuid primary key default gen_random_uuid(),
  email       text unique,
  label       text not null default '',
  created_at  timestamptz not null default now()
);

-- One fixed id, so a redeploy or a re-run cannot mint a second owner and
-- orphan everything written under the first.
insert into app_users (id, email, label)
values ('00000000-0000-0000-0000-000000000001', 'oscar@densworth.co.uk', 'Oscar')
on conflict (id) do nothing;

do $$
declare
  t text;
  seed uuid := '00000000-0000-0000-0000-000000000001';
begin
  foreach t in array array[
    'products', 'judgements', 'premortems', 'scout_candidates',
    'reviews', 'keepa_categories', 'category_picks', 'runs'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table %I add column if not exists user_id uuid', t);
      execute format('update %I set user_id = %L where user_id is null', t, seed);
      execute format('alter table %I alter column user_id set default %L', t, seed);
      execute format('alter table %I alter column user_id set not null', t);
      execute format('create index if not exists %I on %I (user_id)', t || '_user_idx', t);

      -- Enabled now, with one user, so the policies are exercised rather than
      -- switched on for the first time on the day a second person appears.
      execute format('alter table %I enable row level security', t);
      execute format('drop policy if exists %I on %I', t || '_owner', t);
      execute format(
        'create policy %I on %I using (user_id = current_setting(''app.user_id'', true)::uuid) with check (user_id = current_setting(''app.user_id'', true)::uuid)',
        t || '_owner', t
      );
    end if;
  end loop;
end $$;

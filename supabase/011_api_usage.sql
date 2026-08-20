-- Rate and spend guards that survive serverless.
--
-- The guards in claude.ts and keepa.ts are module-scope arrays: a counter per
-- process. Vercel runs many processes and recycles them constantly, so a
-- "40 calls an hour" limit is really 40 per process per hour, which is not a
-- limit at all. It has looked like protection for weeks and protected almost
-- nothing.
--
-- One row per hour per kind, counted in the database where every process can
-- see it.

create table if not exists api_usage (
  kind        text not null,
  hour        timestamptz not null,
  calls       integer not null default 0,
  pence       numeric(10,2) not null default 0,
  primary key (kind, hour)
);

create index if not exists api_usage_hour_idx on api_usage (hour desc);

-- Atomic increment. Two processes hitting the limit at the same moment must
-- not both read 39 and both proceed, which is exactly what a read-then-write
-- from application code would allow.
create or replace function bump_api_usage(
  p_kind text,
  p_limit integer,
  p_pence numeric default 0
) returns table (allowed boolean, calls_now integer) as $$
declare
  current_hour timestamptz := date_trunc('hour', now());
  new_count integer;
begin
  insert into api_usage (kind, hour, calls, pence)
  values (p_kind, current_hour, 1, p_pence)
  on conflict (kind, hour) do update
    set calls = api_usage.calls + 1,
        pence = api_usage.pence + p_pence
  returning calls into new_count;

  return query select new_count <= p_limit, new_count;
end;
$$ language plpgsql;

-- The hourly guard was counting its own refusals.
--
-- bump_api_usage incremented before deciding, so a call it refused still added
-- one to the hour. Once the limit was reached every retry pushed the number
-- further above it, and the usage figures reported work that never happened:
-- 240 judge "calls" in a day when the judged count had not moved in a week.
--
-- A refused call costs nothing and is not usage.
create or replace function bump_api_usage(
  p_kind text,
  p_limit integer,
  p_pence numeric default 0
) returns table (allowed boolean, calls_now integer) as $$
declare
  current_hour timestamptz := date_trunc('hour', now());
  existing integer;
begin
  select calls into existing
    from api_usage
   where kind = p_kind and hour = current_hour;

  existing := coalesce(existing, 0);

  -- Decide first, then count. Only a call that is going to happen is usage.
  if existing >= p_limit then
    return query select false, existing;
    return;
  end if;

  insert into api_usage (kind, hour, calls, pence)
  values (p_kind, current_hour, 1, p_pence)
  on conflict (kind, hour) do update
    set calls = api_usage.calls + 1,
        pence = api_usage.pence + p_pence
  returning calls into existing;

  return query select true, existing;
end;
$$ language plpgsql;

-- Adds cost to the current hour without counting another call, for use after a
-- response comes back and the price is actually known. The guard runs before
-- the call, when it is not.
create or replace function record_api_spend(
  p_kind text,
  p_pence numeric
) returns void as $$
begin
  insert into api_usage (kind, hour, calls, pence)
  values (p_kind, date_trunc('hour', now()), 0, p_pence)
  on conflict (kind, hour) do update
    set pence = api_usage.pence + p_pence;
end;
$$ language plpgsql;

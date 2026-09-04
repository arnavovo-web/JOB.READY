-- =============================================================================
-- PRICING MODEL v2 — Job Search Pass = 10 application unlocks per billing period
-- -----------------------------------------------------------------------------
-- The subscription is NO LONGER "unlimited application unlocks while active".
-- It grants a MONTHLY ALLOWANCE of 10 application unlocks, scoped to the Stripe
-- billing period and enforced SERVER-SIDE, concurrency-safe.
--
-- Depends on 20260903090000_pricing_entitlements.sql (the Phase 40 tables + RPCs).
-- Additive at the SCHEMA level (the only DDL is `add column if not exists`), but
-- it deliberately CHANGES BEHAVIOUR: `create or replace function` redefines the
-- already-live has_application_access / consume_free_unlock / consume_unlock_credit
-- (the blanket "active subscription => access to everything" grant and the
-- "subscriber => don't persist" short-circuits are removed). Every statement is
-- still `add column if not exists` or `create or replace`, so it is safe to
-- re-run; only the old migration FILES are left untouched.
-- Timestamped after 20260903140000_ai_usage_duration.sql so the apply order
-- stays monotonic.
--
-- WHAT CHANGES
--   1. public.subscriptions gains `current_period_start` (Stripe billing-period
--      start; the webhook populates it going forward, existing rows are
--      backfilled to a safe value).
--   2. NEW RPC consume_subscription_unlock(uuid) — the ONLY path that writes an
--      application_unlocks row with source='subscription'. It:
--        * takes a per-user transaction advisory lock so concurrent calls are
--          serialised and CANNOT exceed the cap,
--        * counts source='subscription' unlocks created since
--          current_period_start,
--        * allows the unlock when that count < 10, otherwise returns
--          { ok:false, reason:'monthly_unlock_limit_reached', used, limit }.
--      A new billing period => current_period_start moves forward => the count
--      naturally resets. No cron job.
--   3. has_application_access(uuid) — DROPS the blanket "active subscription =>
--      access to every application". Access now always requires an
--      application_unlocks row; a source='subscription' row only grants access
--      while the subscription is still active (existing period logic), so a
--      cancelled subscription grants no further access via that row. free /
--      credit / comp rows are permanent, unchanged.
--   4. consume_free_unlock / consume_unlock_credit — the "active subscriber =>
--      return without persisting" short-circuit is REMOVED. A subscriber's one
--      free unlock and any purchased credits are independent of the monthly
--      allowance and now persist for them like any other user. The INSERT is
--      made upsert-on-source so a stale source='subscription' row is upgraded to
--      the genuine 'free'/'credit' spend rather than silently blocking it.
--   5. NEW RPC get_subscription_unlock_usage() — authoritative read of
--      { active, used, limit, remaining, period_start, period_end } for display.
-- =============================================================================

-- 1) billing-period start ------------------------------------------------------
alter table public.subscriptions
  add column if not exists current_period_start timestamptz;

comment on column public.subscriptions.current_period_start is
  'Stripe billing-period start. Written by stripe-webhook syncSubscription. The Job Search Pass 10-unlock allowance is counted from this timestamp and resets when it advances.';

-- Backfill existing rows to a safe, non-null value so the period count can never
-- fail open on a NULL comparison. Prefer (period_end - 1 month); fall back to
-- the row's own created_at.
update public.subscriptions
   set current_period_start = coalesce(current_period_end - interval '1 month', created_at)
 where current_period_start is null;

-- =============================================================================
-- 2) consume_subscription_unlock — server-authoritative, concurrency-safe cap
-- =============================================================================
create or replace function public.consume_subscription_unlock(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  -- Mirrors SUBSCRIPTION_MONTHLY_UNLOCKS in src/entitlements.js (guarded by test).
  c_monthly_limit constant integer := 10;
  uid            uuid := (select auth.uid());
  v_period_start timestamptz;
  v_period_end   timestamptz;
  v_used         integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.applications a where a.id = p_application_id and a.user_id = uid
  ) then
    raise exception 'application not found' using errcode = '42501';
  end if;

  -- CONCURRENCY: serialise this user's subscription-unlock attempts for the rest
  -- of the transaction, acquired immediately after auth + ownership validation
  -- and BEFORE any entitlement decision. The existing-access check, the
  -- subscription check, the usage count AND the insert all run while this lock is
  -- held, so two simultaneous requests can never both read "9 used" and both
  -- insert. Different users take different lock keys => no cross-user contention.
  -- Auto-released at commit/rollback.
  perform pg_advisory_xact_lock(hashtext('jobready_sub_unlock'), hashtext(uid::text));

  -- Already accessible? (a free/credit/comp row, or a subscription row while the
  -- subscription is still active). No charge, no write. Matches has_application_access.
  if exists (
    select 1 from public.application_unlocks u
    where u.user_id = uid and u.application_id = p_application_id
      and (
        u.source in ('free', 'credit', 'comp')
        or (u.source = 'subscription' and public.has_active_subscription(uid))
      )
  ) then
    return jsonb_build_object('ok', true, 'already', true, 'source', 'existing');
  end if;

  -- Must have a live subscription to draw on the monthly allowance.
  if not public.has_active_subscription(uid) then
    return jsonb_build_object('ok', false, 'reason', 'no_subscription');
  end if;

  -- Current Stripe billing period for this user's active subscription.
  select s.current_period_start, s.current_period_end
    into v_period_start, v_period_end
    from public.subscriptions s
   where s.user_id = uid
     and s.status in ('active', 'trialing')
     and s.current_period_end is not null
     and s.current_period_end + interval '1 day' > now()
   order by s.current_period_end desc
   limit 1;

  -- Defensive: never let a NULL period start make the count fail open.
  v_period_start := coalesce(v_period_start, now() - interval '31 days');

  select count(*) into v_used
    from public.application_unlocks u
   where u.user_id = uid
     and u.source = 'subscription'
     and u.created_at >= v_period_start;

  if v_used >= c_monthly_limit then
    return jsonb_build_object(
      'ok', false,
      'reason', 'monthly_unlock_limit_reached',
      'used', v_used,
      'limit', c_monthly_limit,
      'period_end', v_period_end
    );
  end if;

  insert into public.application_unlocks (user_id, application_id, source)
  values (uid, p_application_id, 'subscription')
  on conflict (user_id, application_id) do update set source = excluded.source;

  return jsonb_build_object(
    'ok', true,
    'source', 'subscription',
    'used', v_used + 1,
    'limit', c_monthly_limit,
    'remaining', c_monthly_limit - (v_used + 1),
    'period_end', v_period_end
  );
end;
$$;

-- =============================================================================
-- 3) has_application_access — no more blanket subscription grant
-- =============================================================================
create or replace function public.has_application_access(p_application_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null or p_application_id is null then
    return false;
  end if;
  if not exists (
    select 1 from public.applications a where a.id = p_application_id and a.user_id = uid
  ) then
    return false;
  end if;
  -- Access requires an application_unlocks row. free / credit / comp are
  -- permanent; a subscription row only counts while the subscription is active
  -- (so a cancelled subscription stops granting access via that row, per the
  -- existing Stripe subscription-period logic).
  return exists (
    select 1 from public.application_unlocks u
    where u.user_id = uid and u.application_id = p_application_id
      and (
        u.source in ('free', 'credit', 'comp')
        or (u.source = 'subscription' and public.has_active_subscription(uid))
      )
  );
end;
$$;

-- =============================================================================
-- 4) consume_free_unlock / consume_unlock_credit — drop the subscriber
--    short-circuit; a subscriber's free + purchased credits are independent of
--    the monthly allowance and persist for them like any other user.
-- =============================================================================
create or replace function public.consume_free_unlock(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := (select auth.uid());
  ent public.user_entitlements;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.applications a where a.id = p_application_id and a.user_id = uid
  ) then
    raise exception 'application not found' using errcode = '42501';
  end if;

  -- Already accessible (free/credit/comp, or subscription while active) -> no-op.
  if exists (
    select 1 from public.application_unlocks u
    where u.user_id = uid and u.application_id = p_application_id
      and (
        u.source in ('free', 'credit', 'comp')
        or (u.source = 'subscription' and public.has_active_subscription(uid))
      )
  ) then
    return jsonb_build_object('ok', true, 'already', true, 'source', 'existing');
  end if;

  insert into public.user_entitlements (user_id) values (uid) on conflict (user_id) do nothing;
  select * into ent from public.user_entitlements where user_id = uid for update;

  if ent.free_unlock_used then
    return jsonb_build_object('ok', false, 'reason', 'free_unlock_used',
                              'unlock_credits', ent.unlock_credits);
  end if;

  update public.user_entitlements
     set free_unlock_used = true, updated_at = now()
   where user_id = uid;

  insert into public.application_unlocks (user_id, application_id, source)
  values (uid, p_application_id, 'free')
  on conflict (user_id, application_id) do update set source = excluded.source;

  return jsonb_build_object('ok', true, 'source', 'free', 'unlock_credits', ent.unlock_credits);
end;
$$;

create or replace function public.consume_unlock_credit(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := (select auth.uid());
  ent public.user_entitlements;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.applications a where a.id = p_application_id and a.user_id = uid
  ) then
    raise exception 'application not found' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.application_unlocks u
    where u.user_id = uid and u.application_id = p_application_id
      and (
        u.source in ('free', 'credit', 'comp')
        or (u.source = 'subscription' and public.has_active_subscription(uid))
      )
  ) then
    return jsonb_build_object('ok', true, 'already', true, 'source', 'existing');
  end if;

  insert into public.user_entitlements (user_id) values (uid) on conflict (user_id) do nothing;
  select * into ent from public.user_entitlements where user_id = uid for update;

  if ent.unlock_credits < 1 then
    return jsonb_build_object('ok', false, 'reason', 'no_credits',
                              'free_unlock_used', ent.free_unlock_used);
  end if;

  update public.user_entitlements
     set unlock_credits = unlock_credits - 1, updated_at = now()
   where user_id = uid;

  insert into public.application_unlocks (user_id, application_id, source)
  values (uid, p_application_id, 'credit')
  on conflict (user_id, application_id) do update set source = excluded.source;

  return jsonb_build_object('ok', true, 'source', 'credit',
                            'unlock_credits', ent.unlock_credits - 1);
end;
$$;

-- =============================================================================
-- 5) get_subscription_unlock_usage — authoritative display read
-- =============================================================================
create or replace function public.get_subscription_unlock_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c_monthly_limit constant integer := 10;
  uid            uuid := (select auth.uid());
  v_period_start timestamptz;
  v_period_end   timestamptz;
  v_used         integer;
begin
  if uid is null then
    return jsonb_build_object('active', false, 'limit', c_monthly_limit, 'used', 0, 'remaining', 0);
  end if;

  if not public.has_active_subscription(uid) then
    return jsonb_build_object('active', false, 'limit', c_monthly_limit, 'used', 0, 'remaining', 0);
  end if;

  select s.current_period_start, s.current_period_end
    into v_period_start, v_period_end
    from public.subscriptions s
   where s.user_id = uid
     and s.status in ('active', 'trialing')
     and s.current_period_end is not null
     and s.current_period_end + interval '1 day' > now()
   order by s.current_period_end desc
   limit 1;

  v_period_start := coalesce(v_period_start, now() - interval '31 days');

  select count(*) into v_used
    from public.application_unlocks u
   where u.user_id = uid
     and u.source = 'subscription'
     and u.created_at >= v_period_start;

  return jsonb_build_object(
    'active', true,
    'limit', c_monthly_limit,
    'used', v_used,
    'remaining', greatest(0, c_monthly_limit - v_used),
    'period_start', v_period_start,
    'period_end', v_period_end
  );
end;
$$;

-- =============================================================================
-- GRANTS — authenticated end users only; helpers stay internal
-- =============================================================================
revoke all on function public.consume_subscription_unlock(uuid)     from public, anon;
revoke all on function public.get_subscription_unlock_usage()        from public, anon;
grant execute on function public.consume_subscription_unlock(uuid)   to authenticated;
grant execute on function public.get_subscription_unlock_usage()     to authenticated;

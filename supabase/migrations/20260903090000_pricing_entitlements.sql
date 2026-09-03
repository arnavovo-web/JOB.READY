-- =============================================================================
-- PRICING, PAYMENTS & PAYWALL (Phase 40)
-- -----------------------------------------------------------------------------
-- Adds the database-backed entitlement system behind JOB.READY's four plans:
--
--   Free              £0        1 application unlock (explicit-confirm, once per account)
--   Last-Minute Saver £2.99     +1 application unlock credit (one-time)
--   Student Pack      £4.99     +5 application unlock credits (one-time)
--   Job Search Pass   £7.99/mo  unlimited application unlocks while active
--
-- Timestamped AFTER 20260902200000_profiles_reference_code.sql (and after the
-- latest entry in the live migration ledger) so the repo's apply order stays
-- monotonic and matches production.
--
-- PRODUCT RULE: creating and saving an application is NEVER gated. Access is
-- only ever checked when the user actively opens a *preparation resource*
-- (interview build/generation, Application analysis, Classroom lesson /
-- development module, Assessment Centre scenario) for a specific application.
-- The free unlock is spent only after the user explicitly confirms it in a
-- modal — never silently.
--
-- Purely additive. Four new tables + SECURITY DEFINER RPCs. Touches the
-- existing schema in exactly one place: handle_new_user() also seeds a
-- user_entitlements row for new accounts (create-or-replace, idempotent).
-- Every statement is `... if not exists`, `create or replace`, or
-- `drop ... if exists` + recreate, so this is a safe re-run.
--
-- SECURITY MODEL
--   * user_entitlements / application_unlocks / payments / subscriptions have
--     RLS with SELECT-own-rows only and NO insert/update/delete policy, so the
--     browser (anon key + user JWT) can read its own entitlement state but can
--     never forge credits, unlocks or subscriptions.
--   * The only ways a row is written:
--       - consume_free_unlock() / consume_unlock_credit(): SECURITY DEFINER,
--         validate application ownership + entitlement invariants atomically.
--       - the Stripe webhook Edge Function, using the service-role key, after
--         verifying the Stripe signature.
--   * has_application_access() is SECURITY DEFINER and is what the ai-generate
--     Edge Function calls to refuse application-scoped AI work for a locked
--     application — so access cannot be gained by calling the AI API directly.
-- =============================================================================

-- gen_random_uuid() is core Postgres (>=13); this project is PG17. No extension.

-- =============================================================================
-- TABLES
-- =============================================================================

-- One row per user: the free unlock flag + purchased unlock credits.
create table if not exists public.user_entitlements (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  free_unlock_used boolean not null default false,
  unlock_credits   integer not null default 0 check (unlock_credits >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Which specific applications a user has unlocked, and how it was paid for.
create table if not exists public.application_unlocks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  source         text not null check (source in ('free', 'credit', 'subscription', 'comp')),
  created_at     timestamptz not null default now(),
  constraint application_unlocks_user_application_unique unique (user_id, application_id)
);
create index if not exists application_unlocks_user_id_idx        on public.application_unlocks (user_id);
create index if not exists application_unlocks_application_id_idx  on public.application_unlocks (application_id);

-- One-time Stripe purchases (Last-Minute Saver / Student Pack). Audit + webhook idempotency.
create table if not exists public.payments (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references public.profiles(id) on delete cascade,
  provider                text not null default 'stripe',
  provider_checkout_id    text unique,
  provider_payment_intent text,
  product                 text not null check (product in ('last_minute_saver', 'student_pack')),
  amount_total            integer,
  currency                text not null default 'gbp',
  credits_granted         integer not null default 0,
  status                  text not null default 'pending' check (status in ('pending', 'completed', 'refunded')),
  created_at              timestamptz not null default now(),
  completed_at            timestamptz
);
create index if not exists payments_user_id_idx on public.payments (user_id);

-- Job Search Pass — a mirror of the user's Stripe subscription, kept in sync by the webhook.
create table if not exists public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.profiles(id) on delete cascade,
  provider               text not null default 'stripe',
  stripe_customer_id     text,
  stripe_subscription_id text unique,
  status                 text not null default 'incomplete',
  price_id               text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);

-- =============================================================================
-- ROW LEVEL SECURITY  (SELECT-own only; no write policy == browser cannot write)
-- =============================================================================
alter table public.user_entitlements  enable row level security;
alter table public.application_unlocks enable row level security;
alter table public.payments            enable row level security;
alter table public.subscriptions       enable row level security;

drop policy if exists user_entitlements_select_self on public.user_entitlements;
create policy user_entitlements_select_self on public.user_entitlements
  for select using (user_id = (select auth.uid()));

drop policy if exists application_unlocks_select_self on public.application_unlocks;
create policy application_unlocks_select_self on public.application_unlocks
  for select using (user_id = (select auth.uid()));

drop policy if exists payments_select_self on public.payments;
create policy payments_select_self on public.payments
  for select using (user_id = (select auth.uid()));

drop policy if exists subscriptions_select_self on public.subscriptions;
create policy subscriptions_select_self on public.subscriptions
  for select using (user_id = (select auth.uid()));

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- Lazily create + return the caller's entitlement row (covers accounts that
-- pre-date this migration; new accounts are also seeded by handle_new_user).
create or replace function public.ensure_user_entitlements()
returns public.user_entitlements
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
  insert into public.user_entitlements (user_id) values (uid)
  on conflict (user_id) do nothing;
  select * into ent from public.user_entitlements where user_id = uid;
  return ent;
end;
$$;

-- Internal helper: is this user's Stripe subscription currently granting access?
create or replace function public.has_active_subscription(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user_id
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end + interval '1 day' > now())
  );
$$;

-- Server-side access check for a preparation resource. Called by the
-- ai-generate Edge Function (with the caller's JWT) before spending an AI call
-- on application-scoped work, and available to the client for display.
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
  if public.has_active_subscription(uid) then
    return true;
  end if;
  return exists (
    select 1 from public.application_unlocks u
    where u.user_id = uid and u.application_id = p_application_id
  );
end;
$$;

-- Spend the one free unlock on an application the caller owns. Idempotent:
-- re-calling once the application is already unlocked just returns ok.
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

  if exists (
    select 1 from public.application_unlocks u
    where u.user_id = uid and u.application_id = p_application_id
  ) then
    return jsonb_build_object('ok', true, 'already', true, 'source', 'existing');
  end if;

  -- An active subscription already grants access — record the unlock without
  -- spending the free one.
  if public.has_active_subscription(uid) then
    insert into public.application_unlocks (user_id, application_id, source)
    values (uid, p_application_id, 'subscription')
    on conflict (user_id, application_id) do nothing;
    return jsonb_build_object('ok', true, 'source', 'subscription');
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
  on conflict (user_id, application_id) do nothing;

  return jsonb_build_object('ok', true, 'source', 'free', 'unlock_credits', ent.unlock_credits);
end;
$$;

-- Spend one purchased unlock credit on an application the caller owns.
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
  ) then
    return jsonb_build_object('ok', true, 'already', true, 'source', 'existing');
  end if;

  if public.has_active_subscription(uid) then
    insert into public.application_unlocks (user_id, application_id, source)
    values (uid, p_application_id, 'subscription')
    on conflict (user_id, application_id) do nothing;
    return jsonb_build_object('ok', true, 'source', 'subscription');
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
  on conflict (user_id, application_id) do nothing;

  return jsonb_build_object('ok', true, 'source', 'credit',
                            'unlock_credits', ent.unlock_credits - 1);
end;
$$;

-- Apply a completed one-time Stripe purchase: claim the checkout session
-- idempotently AND grant its credits, atomically, in one transaction. Called by
-- the stripe-webhook Edge Function (service role) instead of a service-role
-- read-modify-write, which could lose an increment under concurrent webhook
-- delivery or leave a payment permanently "processed" without its credits if the
-- process died between the two writes.
--
--   * The INSERT into public.payments uses provider_checkout_id (UNIQUE) as the
--     idempotency key: on conflict it does nothing and row_count is 0.
--   * Only when a payment row is newly inserted (row_count = 1) do we increment
--     credits, via a single atomic `unlock_credits = unlock_credits + p_credits`
--     upsert (which also creates the user_entitlements row if it is missing).
--   * Both writes are in the same function body, so they commit or roll back
--     together — a failure can never leave the payment claimed without credits.
create or replace function public.apply_purchase_credits(
  p_checkout_id     text,
  p_user_id         uuid,
  p_product         text,
  p_credits         integer,
  p_amount_total    integer default null,
  p_currency        text    default 'gbp',
  p_payment_intent  text    default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_credits    integer := greatest(coalesce(p_credits, 0), 0);
  v_claimed    integer;
  v_balance    integer;
begin
  if p_checkout_id is null or p_user_id is null then
    raise exception 'apply_purchase_credits requires a checkout id and a user id'
      using errcode = '22004';
  end if;

  -- (1) idempotent claim of this checkout session
  insert into public.payments (
    user_id, provider, provider_checkout_id, provider_payment_intent,
    product, amount_total, currency, credits_granted, status, completed_at
  )
  values (
    p_user_id, 'stripe', p_checkout_id, p_payment_intent,
    p_product, p_amount_total, coalesce(p_currency, 'gbp'), v_credits, 'completed', now()
  )
  on conflict (provider_checkout_id) do nothing;

  get diagnostics v_claimed = row_count;

  -- (2) already processed -> do nothing, report it explicitly
  if v_claimed = 0 then
    return jsonb_build_object('ok', true, 'already_processed', true, 'credits_granted', 0);
  end if;

  -- (3) first time only: create the entitlement row if needed AND atomically
  --     increment, in one statement (no read-modify-write, no lost update).
  insert into public.user_entitlements (user_id, unlock_credits, updated_at)
  values (p_user_id, v_credits, now())
  on conflict (user_id) do update
     set unlock_credits = user_entitlements.unlock_credits + v_credits,
         updated_at      = now()
  returning unlock_credits into v_balance;

  return jsonb_build_object(
    'ok', true,
    'already_processed', false,
    'credits_granted', v_credits,
    'unlock_credits', v_balance
  );
end;
$$;

-- ---- execute grants: authenticated only; helpers stay internal --------------
revoke all on function public.ensure_user_entitlements()          from public, anon;
revoke all on function public.consume_free_unlock(uuid)           from public, anon;
revoke all on function public.consume_unlock_credit(uuid)         from public, anon;
revoke all on function public.has_application_access(uuid)        from public, anon;
revoke all on function public.has_active_subscription(uuid)       from public, anon, authenticated;
-- apply_purchase_credits is called ONLY by the stripe-webhook Edge Function
-- (service role). No end-user role may call it.
revoke all on function public.apply_purchase_credits(text, uuid, text, integer, integer, text, text)
  from public, anon, authenticated;

grant execute on function public.ensure_user_entitlements()   to authenticated;
grant execute on function public.consume_free_unlock(uuid)    to authenticated;
grant execute on function public.consume_unlock_credit(uuid)  to authenticated;
grant execute on function public.has_application_access(uuid) to authenticated;
grant execute on function public.apply_purchase_credits(text, uuid, text, integer, integer, text, text)
  to service_role;

-- =============================================================================
-- SEED user_entitlements + grandfather existing applications
-- =============================================================================
insert into public.user_entitlements (user_id)
select p.id from public.profiles p
on conflict (user_id) do nothing;

-- Grandfather every application that already exists when this migration runs.
-- Users who were preparing before pricing existed keep full, unlimited access to
-- those applications; the paywall applies only to applications created afterwards.
-- `free_unlock_used` is deliberately left false, so existing users still get one
-- free unlock for their next new application.
insert into public.application_unlocks (user_id, application_id, source)
select a.user_id, a.id, 'comp'
from public.applications a
on conflict (user_id, application_id) do nothing;

-- Re-assert handle_new_user() with the added user_entitlements seed. This is a
-- superset of the baseline definition — profiles + candidate_dna behaviour is
-- unchanged.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  insert into public.candidate_dna (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  insert into public.user_entitlements (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

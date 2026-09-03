-- =============================================================================
-- CONTACT US / FEEDBACK  (contact form submissions)
-- -----------------------------------------------------------------------------
-- One additive table. Backs the "Contact Us" dialog in the shared NavBar
-- (public landing pages + authenticated app). Cheapest sensible sink: the
-- browser INSERTs one row directly (anon key for logged-out visitors, the
-- user's JWT when signed in). No Edge Function, no third-party SaaS.
--
-- SECURITY MODEL
--   * RLS enabled, INSERT-only. There is NO select/update/delete policy, so
--     the table is write-only through the API — rows are readable only with
--     the service role (Supabase dashboard, or a future internal admin view).
--   * A signed-in sender may only attribute a row to their own auth.uid();
--     an anonymous sender must leave user_id null. Neither can spoof another
--     user's id.
--   * Lightweight shape guards (CHECK constraints) keep obviously-bad or
--     abusive payloads out. This is not a substitute for a spam filter; a
--     honeypot / rate limit can be layered on later without a schema change.
--
-- IDEMPOTENT: `create table if not exists`, `create index if not exists`,
-- `drop policy if exists` + recreate. Safe to re-run.
--
-- Timestamped after 20260903090000_pricing_entitlements.sql so the repo apply
-- order stays monotonic.
--
-- ⚠️  DEPLOYMENT: this file is NOT applied to the live database by creating it
-- here. The live migration ledger and the repo's migration files already
-- diverge (see supabase/README.md); applying this requires a deliberate,
-- reviewed step. Until it is applied, the Contact dialog's submit fails
-- cleanly and shows an honest error — it never falsely claims success.
-- =============================================================================

create table if not exists public.contact_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete set null,
  name        text        check (name is null or char_length(name) <= 200),
  email       text not null check (char_length(email) between 3 and 320),
  message     text not null check (char_length(message) between 1 and 5000),
  page        text        check (page is null or char_length(page) <= 300),
  user_agent  text        check (user_agent is null or char_length(user_agent) <= 500),
  status      text not null default 'new' check (status in ('new', 'read', 'responded', 'spam')),
  created_at  timestamptz not null default now()
);

create index if not exists contact_messages_created_at_idx on public.contact_messages (created_at desc);
create index if not exists contact_messages_user_id_idx    on public.contact_messages (user_id);

alter table public.contact_messages enable row level security;

-- Anonymous (logged-out) visitors: may insert, must not attribute a user_id.
drop policy if exists contact_messages_insert_anon on public.contact_messages;
create policy contact_messages_insert_anon on public.contact_messages
  for insert to anon
  with check (user_id is null);

-- Signed-in users: may insert; either unattributed or attributed to themselves.
drop policy if exists contact_messages_insert_authenticated on public.contact_messages;
create policy contact_messages_insert_authenticated on public.contact_messages
  for insert to authenticated
  with check (user_id is null or user_id = (select auth.uid()));

-- No SELECT / UPDATE / DELETE policy on purpose: the table is a write-only
-- sink from the client. Read it with the service role.

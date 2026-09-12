-- =============================================================================
-- CONTACT MESSAGES — email notification layer (outreach team)
-- -----------------------------------------------------------------------------
-- Every successful INSERT into public.contact_messages (the single write-only
-- sink behind the shared Contact dialog — general feedback, "Book a university
-- demo", and the EKI² auth no-workspace "Arrange a demo" action all write here,
-- see 20260903120000_contact_messages.sql) fires an ADDITIVE async notification
-- to the "notify-contact-message" Edge Function, which emails
-- outreachteam@jobreadyai.pro. contact_messages itself remains the sole source
-- of record — nothing here replaces or weakens it, and no existing RLS policy
-- changes: the client can still only INSERT, never SELECT/UPDATE/DELETE.
--
-- RELIABILITY: the trigger below is wrapped in its own BEGIN/EXCEPTION block
-- and net.http_post() is asynchronous (pg_net queues the call and returns
-- immediately) — a queueing problem or the notification endpoint being briefly
-- unreachable can NEVER roll back the row that already committed. The two new
-- columns (notified_at / notify_error) make the outcome observable on the row
-- itself: `select * from contact_messages where notified_at is null` finds any
-- submission whose owner should still hear about it, `notify_error` says why.
--
-- SECURITY: the Edge Function trusts only the row `id` from the webhook body —
-- it re-reads name/email/message/etc. from contact_messages itself (the
-- service-role client bypasses RLS the same way every other server-side
-- notify/webhook function in this project does), so a forged webhook body can
-- never inject arbitrary email content. It requires a valid Supabase JWT
-- (verify_jwt=true); the trigger authenticates with the publishable anon key,
-- which is already public in the client bundle (src/App.jsx SUPABASE_ANON_KEY)
-- — nothing new is exposed by embedding it here.
--
-- IDEMPOTENT: `create extension/table/column if not exists`,
-- `drop trigger/function if exists` + recreate. Safe to re-run.
--
-- Timestamped between 20260903120000_contact_messages.sql and
-- 20260903130000_profiles_education.sql — same student-domain lineage, not the
-- institutional/EKI² layer (see foundationMigration.test.js's ordering guard).
--
-- MANUAL STEP REQUIRED: this migration wires the pipeline, but sending actually
-- requires the "notify-contact-message" Edge Function's RESEND_API_KEY secret
-- to be set (Project Settings -> Edge Functions -> notify-contact-message ->
-- Secrets). Until then every notification is logged as
-- notify_error='email_not_configured' and the row is otherwise unaffected.
-- =============================================================================

-- pg_net: async, non-blocking HTTP from Postgres. Installed into `extensions`
-- (Supabase convention, matches btree_gist in 20260909180000_careers_appointments.sql).
create schema if not exists extensions;
create extension if not exists pg_net with schema extensions;

-- Observability columns only — additive, nullable, no default that could
-- change existing row semantics.
alter table public.contact_messages add column if not exists notified_at timestamptz;
alter table public.contact_messages add column if not exists notify_error text
  check (notify_error is null or char_length(notify_error) <= 300);

create or replace function public.notify_contact_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Fire-and-forget: net.http_post() queues the call and returns immediately.
  -- Any error here (extension unavailable, malformed call, etc.) is caught and
  -- logged, never re-raised -- the INSERT that already happened must never be
  -- rolled back by a notification-layer problem.
  begin
    perform net.http_post(
      url     := 'https://dcltfxnzzfqjtctixlxe.supabase.co/functions/v1/notify-contact-message',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        -- publishable anon key -- already public in the client bundle, only
        -- used here to satisfy the Edge Function's verify_jwt gate.
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjbHRmeG56emZxanRjdGl4bHhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMjM4MjksImV4cCI6MjEwMjc5OTgyOX0.GufInmeZqrzCuI59k9pWvjysbIX1Uld0fgxG-YNa-uc'
      ),
      -- Only the row id is sent. The function re-reads everything else from
      -- contact_messages itself -- see the security note above.
      body    := jsonb_build_object('id', new.id)
    );
  exception when others then
    raise warning 'notify_contact_message: failed to queue notification for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists contact_messages_notify on public.contact_messages;
create trigger contact_messages_notify
  after insert on public.contact_messages
  for each row execute function public.notify_contact_message();

-- notify_contact_message() is a trigger function (returns trigger) -- Postgres
-- only ever allows it to run as a trigger, regardless of grants ("trigger
-- functions can only be called as triggers"). It's still SECURITY DEFINER with
-- zero arguments, which the Supabase linter flags as PostgREST-reachable via
-- /rest/v1/rpc; revoking EXECUTE closes that harmless-but-unnecessary surface
-- without affecting the trigger, which fires independently of role grants.
revoke all on function public.notify_contact_message() from public, anon, authenticated;

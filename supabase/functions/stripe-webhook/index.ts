import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.7.0";

// =============================================================================
// stripe-webhook  (Phase 40 — pricing / payments)
// -----------------------------------------------------------------------------
// The ONLY place paid entitlements are granted. Deploy with
// `--no-verify-jwt` — Stripe cannot send a Supabase user JWT. Authenticity is
// established by verifying the Stripe signature against STRIPE_WEBHOOK_SECRET;
// an unsigned / wrongly-signed request is rejected with 400 before any write.
//
// Writes run with the service-role key (RLS bypassed) because the paying user
// is not the caller here. Everything is keyed for idempotency so Stripe's
// at-least-once redelivery never double-grants:
//   * one-time purchases  -> public.payments.provider_checkout_id is UNIQUE;
//     credits are added to public.user_entitlements only on the first insert.
//   * subscriptions       -> upsert on public.subscriptions.stripe_subscription_id.
//
// Handled events:
//   checkout.session.completed            (mode=payment  -> grant credits)
//                                         (mode=subscription -> sync subscription)
//   customer.subscription.created|updated|deleted  -> sync subscription
// =============================================================================

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");

// Mirrors src/entitlements.js CREDITS_PER_PRODUCT (guarded by the phase test).
const CREDITS_PER_PRODUCT: Record<string, number> = {
  last_minute_saver: 1,
  student_pack: 5,
};

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

function isoFromUnix(sec: number | null | undefined): string | null {
  if (!sec || !Number.isFinite(sec)) return null;
  return new Date(sec * 1000).toISOString();
}

async function grantCredits(userId: string, product: string, session: Stripe.Checkout.Session) {
  const db = admin();
  const credits = CREDITS_PER_PRODUCT[product] ?? 0;

  // Idempotent claim of this checkout session. ignoreDuplicates -> a redelivery
  // returns an empty array and we skip the grant.
  const { data: inserted, error: insErr } = await db
    .from("payments")
    .upsert(
      {
        user_id: userId,
        provider: "stripe",
        provider_checkout_id: session.id,
        provider_payment_intent:
          typeof session.payment_intent === "string" ? session.payment_intent : null,
        product,
        amount_total: session.amount_total ?? null,
        currency: session.currency ?? "gbp",
        credits_granted: credits,
        status: "completed",
        completed_at: new Date().toISOString(),
      },
      { onConflict: "provider_checkout_id", ignoreDuplicates: true },
    )
    .select();

  if (insErr) {
    console.error("payments upsert failed:", insErr.message);
    throw new Error("payments upsert failed");
  }
  if (!inserted || inserted.length === 0) {
    console.log("checkout session already processed, skipping grant:", session.id);
    return;
  }

  await db.from("user_entitlements").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  const { data: entRow, error: entErr } = await db
    .from("user_entitlements")
    .select("unlock_credits")
    .eq("user_id", userId)
    .maybeSingle();
  if (entErr) {
    console.error("user_entitlements read failed:", entErr.message);
    throw new Error("entitlements read failed");
  }
  const next = Math.max(0, (entRow?.unlock_credits ?? 0)) + credits;
  const { error: updErr } = await db
    .from("user_entitlements")
    .update({ unlock_credits: next, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (updErr) {
    console.error("user_entitlements credit update failed:", updErr.message);
    throw new Error("entitlements update failed");
  }
  console.log(`granted ${credits} credit(s) to ${userId} for ${product} (session ${session.id})`);
}

async function syncSubscription(sub: Stripe.Subscription) {
  const db = admin();
  const userId =
    (sub.metadata && (sub.metadata as Record<string, string>).user_id) || null;
  if (!userId) {
    console.error("subscription has no user_id metadata, cannot attribute:", sub.id);
    return;
  }
  const row = {
    user_id: userId,
    provider: "stripe",
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
    stripe_subscription_id: sub.id,
    status: sub.status,
    price_id: sub.items?.data?.[0]?.price?.id ?? null,
    // `current_period_end` is top-level on older Stripe API versions and on the
    // subscription item on newer ones — read whichever is present.
    current_period_end: isoFromUnix(
      (sub as any).current_period_end ?? (sub.items?.data?.[0] as any)?.current_period_end,
    ),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db
    .from("subscriptions")
    .upsert(row, { onConflict: "stripe_subscription_id" });
  if (error) {
    console.error("subscriptions upsert failed:", error.message);
    throw new Error("subscriptions upsert failed");
  }
  console.log(`synced subscription ${sub.id} for ${userId} -> ${sub.status}`);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    console.error("Stripe secrets are not configured for this project.");
    return new Response("Payments are not configured", { status: 500 });
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY);
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("Stripe signature verification failed:", (e as Error).message);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId =
          (session.metadata && (session.metadata as Record<string, string>).user_id) ||
          session.client_reference_id ||
          null;
        if (!userId) {
          console.error("checkout.session.completed without a user id:", session.id);
          break;
        }
        if (session.mode === "payment" && session.payment_status === "paid") {
          const product = (session.metadata as Record<string, string>)?.product || "";
          if (CREDITS_PER_PRODUCT[product] === undefined) {
            console.error("checkout.session.completed with unknown product:", product);
            break;
          }
          await grantCredits(userId, product, session);
        } else if (session.mode === "subscription" && session.subscription) {
          const subId =
            typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          if (!sub.metadata?.user_id) sub.metadata = { ...(sub.metadata || {}), user_id: userId };
          await syncSubscription(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await syncSubscription(sub);
        break;
      }
      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break;
    }
  } catch (e) {
    // 500 -> Stripe will retry with backoff. Safe because every write is idempotent.
    console.error("webhook handler error:", (e as Error).message);
    return new Response("handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

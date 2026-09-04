import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.7.0";

// =============================================================================
// create-checkout  (Phase 40 — pricing / payments)
// -----------------------------------------------------------------------------
// Authenticated. Deploy with verify_jwt = true (the default): Supabase's edge
// runtime rejects any request without a valid user JWT before this code runs.
//
// Creates a Stripe Checkout Session for one of the three purchasable plans and
// returns its hosted-checkout URL. The browser only ever redirects to that URL;
// it never sees a card number or a Stripe secret. Entitlements are granted
// later, server-side, by the `stripe-webhook` function after Stripe confirms
// payment — this function grants nothing.
//
// Prices are defined inline via `price_data` (amounts below), so no Stripe
// dashboard Product/Price setup is required — only the STRIPE_SECRET_KEY.
// The amounts mirror src/entitlements.js PRICING_PLANS (kept honest by
// src/phase40PricingPaywall.test.js).
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
// Optional: the canonical site origin used to build success/cancel URLs. When
// unset, the request's Origin header is used if it looks like a JOB.READY
// deployment (localhost or *.vercel.app) — otherwise the request is rejected.
const PUBLIC_SITE_URL = Deno.env.get("PUBLIC_SITE_URL");

type ProductId = "last_minute_saver" | "student_pack" | "job_search_pass";

const PRODUCTS: Record<ProductId, {
  name: string;
  description: string;
  amount: number; // pence
  mode: "payment" | "subscription";
  recurring?: { interval: "month" };
}> = {
  // Display strings only — Stripe uses inline price_data, so there is NO persisted
  // Stripe Product/Price to keep in sync. The product id KEYS
  // (last_minute_saver / student_pack / job_search_pass) are the stable functional
  // identifiers echoed back in checkout-session metadata and never change. The
  // `amount` (pence) values mirror src/entitlements.js PRICING_PLANS, guarded by
  // src/phase40PricingPaywall.test.js.
  last_minute_saver: {
    name: "JOB.READY — Single Application",
    description: "Unlock 1 application",
    amount: 299,
    mode: "payment",
  },
  student_pack: {
    name: "JOB.READY — Application Pack",
    description: "Unlock 4 applications",
    amount: 499,
    mode: "payment",
  },
  job_search_pass: {
    name: "JOB.READY — Job Search Pass",
    description: "Unlock up to 10 applications every month",
    amount: 899,
    mode: "subscription",
    recurring: { interval: "month" },
  },
};

function resolveSiteOrigin(req: Request): string | null {
  if (PUBLIC_SITE_URL) return PUBLIC_SITE_URL.replace(/\/+$/, "");
  const origin = req.headers.get("origin") || "";
  try {
    const u = new URL(origin);
    const okHost =
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname.endsWith(".vercel.app");
    if (okHost) return `${u.protocol}//${u.host}`;
  } catch { /* fall through */ }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!STRIPE_SECRET_KEY) {
    console.error("STRIPE_SECRET_KEY is not configured for this project.");
    return json({ error: "Payments are not configured. Please contact support." }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
  const user = userData.user;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const productId = String(body?.product || "") as ProductId;
  const product = PRODUCTS[productId];
  if (!product) return json({ error: "Unknown product" }, 400);

  const siteOrigin = resolveSiteOrigin(req);
  if (!siteOrigin) return json({ error: "Checkout origin not allowed" }, 400);

  // Optional: the application the user was trying to unlock, echoed back on
  // return so the UI can resume that flow. Not trusted for anything paid.
  const applicationId = typeof body?.applicationId === "string" ? body.applicationId : "";
  const returnPath = typeof body?.returnPath === "string" && body.returnPath.startsWith("/")
    ? body.returnPath
    : "/";

  const successUrl =
    `${siteOrigin}${returnPath}${returnPath.includes("?") ? "&" : "?"}checkout=success&product=${productId}` +
    (applicationId ? `&application=${encodeURIComponent(applicationId)}` : "");
  const cancelUrl =
    `${siteOrigin}${returnPath}${returnPath.includes("?") ? "&" : "?"}checkout=cancel&product=${productId}`;

  // No explicit apiVersion — the Stripe SDK uses the account's default version.
  const stripe = new Stripe(STRIPE_SECRET_KEY);

  const metadata: Record<string, string> = {
    user_id: user.id,
    product: productId,
  };
  if (applicationId) metadata.application_id = applicationId;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: product.mode,
      client_reference_id: user.id,
      customer_email: user.email ?? undefined,
      allow_promotion_codes: true,
      metadata,
      // For subscriptions, also stamp the user id on the subscription itself so
      // customer.subscription.* webhook events can be attributed without a lookup.
      ...(product.mode === "subscription"
        ? { subscription_data: { metadata: { user_id: user.id } } }
        : {}),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: product.amount,
            product_data: { name: product.name, description: product.description },
            ...(product.recurring ? { recurring: product.recurring } : {}),
          },
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("Stripe checkout session creation failed:", (e as Error).message);
    return json({ error: "Couldn't start checkout. Please try again." }, 502);
  }
});

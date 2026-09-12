import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// =============================================================================
// notify-contact-message
// -----------------------------------------------------------------------------
// Fired (async, fire-and-forget) by the `contact_messages_notify` trigger on
// every INSERT into public.contact_messages -- the single write-only sink
// behind the site's shared Contact dialog (general feedback, "Book a
// university demo", and the EKI² auth no-workspace "Arrange a demo" action all
// land there). Sends ONE email notification to the outreach team. It is an
// ADDITIONAL notification layer: contact_messages remains the source of
// record regardless of whether this function, or the email send inside it,
// succeeds.
//
// TRUST MODEL: the webhook body carries only `{ id }`. Every other field
// (name, email, message, page, user_agent, created_at) is re-read from
// contact_messages itself using the service-role client, which is the same
// "server-side re-authorises, never trusts the caller's payload for content"
// shape as stripe-webhook and eki-adviser-briefing in this project. A forged
// call can at most name an id that does or doesn't exist -- it can never
// inject arbitrary email content, and it can never see data it couldn't
// already reach (the row it names was, by definition, already written).
//
// RELIABILITY: this function only ever runs AFTER the row has committed. If
// it never runs, times out, or the email provider fails, the row is
// completely unaffected -- notified_at stays null and notify_error records
// why, both directly queryable on contact_messages (the source of record).
// A failed send is safe to retry by re-POSTing the same { id } (idempotent:
// an already-notified row is a same-shape 200, no resend, no duplicate).
// =============================================================================

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
// Resend's shared sandbox sender works with no domain verification, so
// notifications flow the moment RESEND_API_KEY is set; swap in a verified
// jobreadyai.pro sender via this env var once one exists.
const NOTIFY_FROM_EMAIL = Deno.env.get("NOTIFY_FROM_EMAIL") || "JOB.READY Notifications <onboarding@resend.dev>";
const NOTIFY_TO_EMAIL = Deno.env.get("NOTIFY_TO_EMAIL") || "outreachteam@jobreadyai.pro";

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Pulls a "Label: value" line out of the free-text message (case-insensitive,
 * tolerant of the "Role / team" style label). Used only to surface fields the
 * existing form already invites the sender to type -- no schema/UI change. */
function extractField(message: string, label: string): string {
  const re = new RegExp(`^${label}\\s*:\\s*(.+)$`, "im");
  const m = re.exec(message || "");
  return m ? m[1].trim() : "";
}

const DEMO_PREFIX = /^\[University demo request\]/i;

function classify(message: string): { type: string; institution: string; role: string; country: string } {
  const isDemo = DEMO_PREFIX.test((message || "").trim());
  return {
    type: isDemo ? "University Demo Request" : "Website Feedback",
    institution: extractField(message, "Institution"),
    role: extractField(message, "Role\\s*/\\s*team"),
    country: extractField(message, "Country"),
  };
}

function buildEmail(row: {
  id: string; name: string | null; email: string; message: string;
  page: string | null; user_agent: string | null; created_at: string;
}) {
  const { type, institution, role, country } = classify(row.message);
  const subjectName = (type === "University Demo Request" ? institution : "") || row.name || row.email;
  const subject = `[JOB.READY] ${type} — ${subjectName}`;

  const lines = [
    `Submission type: ${type}`,
    `Name: ${row.name || "(not provided)"}`,
    `Email: ${row.email}`,
    institution ? `University / organisation: ${institution}` : null,
    role ? `Role / title: ${role}` : null,
    country ? `Country: ${country}` : null,
    `Submitted: ${row.created_at}`,
    row.page ? `Page: ${row.page}` : null,
    row.user_agent ? `User agent: ${row.user_agent}` : null,
    "",
    "Message:",
    row.message,
    "",
    `(contact_messages.id: ${row.id})`,
  ].filter((l): l is string => l !== null);

  return { subject, text: lines.join("\n") };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let payload: { id?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, reason: "invalid_json" }, 400);
  }
  const id = payload?.id;
  if (typeof id !== "string" || !id) return json({ ok: false, reason: "missing_id" }, 400);

  const db = admin();

  // Source of record: re-read the real row, ignore everything else the caller sent.
  const { data: row, error: fetchErr } = await db
    .from("contact_messages")
    .select("id, name, email, message, page, user_agent, created_at, notified_at")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    console.error("contact_messages lookup failed:", fetchErr.message);
    return json({ ok: false, reason: "lookup_failed" }, 500);
  }
  if (!row) return json({ ok: false, reason: "not_found" }, 404);

  if (row.notified_at) {
    // Idempotent: a retry / replay of the same id never re-sends.
    return json({ ok: true, skipped: "already_notified" });
  }

  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not configured -- notification not sent for", row.id);
    await db.from("contact_messages").update({ notify_error: "email_not_configured" }).eq("id", id);
    // 200: this is a known, observable configuration gap, not a caller error.
    return json({ ok: false, reason: "email_not_configured" });
  }

  const { subject, text } = buildEmail(row as any);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: NOTIFY_FROM_EMAIL,
        to: [NOTIFY_TO_EMAIL],
        reply_to: row.email,
        subject,
        text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Resend send failed:", res.status, detail.slice(0, 300));
      await db.from("contact_messages").update({ notify_error: `resend_${res.status}` }).eq("id", id);
      // Still 200: the DATABASE record is intact and the failure is logged +
      // recorded on the row. The caller (pg_net) has nothing useful to retry
      // differently, and a genuine ops retry can re-POST the same { id }.
      return json({ ok: false, reason: "email_send_failed" });
    }
  } catch (e) {
    console.error("Resend request error:", (e as Error).message);
    await db.from("contact_messages").update({ notify_error: String((e as Error).message).slice(0, 300) }).eq("id", id);
    return json({ ok: false, reason: "email_send_error" });
  }

  const { error: markErr } = await db
    .from("contact_messages")
    .update({ notified_at: new Date().toISOString(), notify_error: null })
    .eq("id", id);
  if (markErr) console.error("failed to mark contact_messages as notified:", markErr.message);

  return json({ ok: true });
});

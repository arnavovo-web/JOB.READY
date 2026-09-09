/* ================================================================== *
 * INSTITUTIONAL INSIGHTS — Supabase client
 * ------------------------------------------------------------------
 * The institutional (B2B) product is a SEPARATE React tree mounted at
 * /institutional (see src/main.jsx). It deliberately does not import
 * anything from the 12k-line student App.jsx, so it carries its own
 * thin Supabase client here — same project, same public anon key,
 * same CDN-UMD load pattern the student app uses. RLS + the
 * SECURITY DEFINER inst_* RPCs are what actually enforce access;
 * the anon key grants nothing on its own.
 * ================================================================== */

export const SUPABASE_URL = "https://dcltfxnzzfqjtctixlxe.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjbHRmeG56emZxanRjdGl4bHhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMjM4MjksImV4cCI6MjEwMjc5OTgyOX0.GufInmeZqrzCuI59k9pWvjysbIX1Uld0fgxG-YNa-uc";

const CDN_SRC = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";

let loadPromise = null;
function loadSupabaseUmd() {
  if (typeof window !== "undefined" && window.supabase && window.supabase.createClient) {
    return Promise.resolve(window.supabase);
  }
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CDN_SRC;
    script.onload = () => resolve(window.supabase);
    script.onerror = () => {
      loadPromise = null; // let a later retry actually re-fetch
      reject(new Error("Couldn't load the authentication service. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });
  return loadPromise;
}

let client = null;
export async function getSupabase() {
  if (client) return client;
  const sb = await loadSupabaseUmd();
  client = sb.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    // Institutional links are never emailed with auth tokens in the URL, but
    // keep parity with the student client so a shared session behaves the same.
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

export async function getSession() {
  const supabase = await getSupabase();
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

export async function signInWithPassword(email, password) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message || "Sign in failed.");
  return data.session;
}

export async function signOut() {
  const supabase = await getSupabase();
  await supabase.auth.signOut();
}

export async function onAuthStateChange(cb) {
  const supabase = await getSupabase();
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data?.subscription?.unsubscribe?.();
}

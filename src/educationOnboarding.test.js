/* ================================================================== *
 * OPTIONAL EDUCATION INFO (university / degree) AT SIGN-UP
 * ------------------------------------------------------------------
 * Source-inspection guards (node env, no DOM), same idiom as
 * referenceCodeAndInterviewLoadingCopy.test.js. Confirms:
 *   - an additive migration adds attends_university / university / degree
 *     to public.profiles, timestamped after 20260903120000;
 *   - the sign-up view has an OPTIONAL education section with a clear
 *     "I don't attend university" choice and free-text University + Degree;
 *   - education is never a required field and never gates anything;
 *   - the values are carried through signUp() metadata and backfilled onto
 *     the profile write-once (never overwritten) — exactly like the
 *     reference code / name fields;
 *   - no normalisation / institutional-lookup / rewards logic is added.
 * ================================================================== */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const SRC = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const slice = (start, end) => {
  const s = SRC.indexOf(start);
  const e = SRC.indexOf(end, s + start.length);
  if (s === -1 || e === -1) throw new Error(`markers not found: ${start} .. ${end}`);
  return SRC.slice(s, e);
};

const LOGIN = slice('{screen === "login" && ', "{/* ---------------- DASHBOARD ----------------");
const SIGNUP_VIEW = LOGIN.slice(LOGIN.indexOf('{authView === "signup"'), LOGIN.indexOf('{authView === "signin"'));
const SIGNIN_VIEW = LOGIN.slice(LOGIN.indexOf('{authView === "signin"'), LOGIN.indexOf('{authView === "forgot"'));
const HANDLE_SIGN_UP = slice("async function handleSignUp(", "\n  async function handleSignIn(");
const ON_AUTHED = slice("async function onAuthed(", "setUser({ id: authUser.id");

/* ---------------------------------------------------------------- *
 * 1. Migration
 * ---------------------------------------------------------------- */
describe("profiles education migration", () => {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const file = readdirSync(dir).find((f) => /education/i.test(f) && f.endsWith(".sql"));
  const sql = file ? readFileSync(new URL(file, dir), "utf8") : "";

  it("exists, is timestamped after 20260903120000, and is a plain additive column migration", () => {
    expect(file, "a *education*.sql migration").toBeTruthy();
    expect(/^\d{14}_/.test(file)).toBe(true);
    expect(file.slice(0, 14) > "20260903120000").toBe(true);
    expect(/baseline/i.test(file)).toBe(false);
  });

  it("adds exactly the three nullable columns to public.profiles, each guarded with IF NOT EXISTS", () => {
    expect(sql).toMatch(/alter table public\.profiles add column if not exists attends_university boolean/i);
    expect(sql).toMatch(/alter table public\.profiles add column if not exists university\s+text/i);
    expect(sql).toMatch(/alter table public\.profiles add column if not exists degree\s+text/i);
  });

  it("does not touch existing schema / migration history (purely additive)", () => {
    expect(sql).not.toMatch(/drop table|drop column|drop policy|truncate|delete from|alter column|create policy/i);
    expect(sql).not.toMatch(/schema_migrations|migration repair|db push/i);
  });
});

/* ---------------------------------------------------------------- *
 * 2. Sign-up view — optional education section
 * ---------------------------------------------------------------- */
describe("sign-up view — optional education fields", () => {
  it("has an Education section, explicitly marked Optional, with a helper tooltip about anonymised aggregate use", () => {
    expect(SIGNUP_VIEW).toMatch(/id="signup-education-label"/);
    expect(SIGNUP_VIEW).toMatch(/Education\s*<span[^>]*>\(Optional\)/);
    expect(SIGNUP_VIEW).toMatch(/aggregate and anonymised/);
  });

  it("offers a clear 'I don't attend university' choice — a complete answer, not a forced university entry", () => {
    expect(SIGNUP_VIEW).toContain("I don't attend university");
    expect(SIGNUP_VIEW).toContain("I attend / attended university");
    // both choices are real toggle buttons with aria-pressed (keyboard + SR reachable)
    expect(SIGNUP_VIEW).toMatch(/aria-pressed=\{educationStatus === val\}/);
    // a group label so screen readers announce it as one question
    expect(SIGNUP_VIEW).toMatch(/role="group" aria-labelledby="signup-education-label"/);
  });

  it("shows free-text University + Degree inputs ONLY when the user says they attend university", () => {
    expect(SIGNUP_VIEW).toMatch(/\{educationStatus === "university" && \(/);
    expect(SIGNUP_VIEW).toMatch(/id="signup-university"[\s\S]*value=\{universityInput\}/);
    expect(SIGNUP_VIEW).toMatch(/id="signup-degree"[\s\S]*value=\{degreeInput\}/);
    // free text — plain <input>, no <select>, no dropdown of institutions
    expect(SIGNUP_VIEW).not.toMatch(/signup-university[\s\S]{0,60}<select/);
  });

  it("does NOT leak any education field onto the Sign In view (the 'university' in the email placeholder doesn't count)", () => {
    expect(SIGNIN_VIEW).not.toMatch(/signup-education-label|signup-university|signup-degree|educationStatus|attends_university|I don't attend university/);
  });
});

/* ---------------------------------------------------------------- *
 * 3. Never required, never gating
 * ---------------------------------------------------------------- */
describe("education is optional and non-gating", () => {
  it("handleSignUp never blocks sign-up on an education field", () => {
    // the only required-field guards are name / email / password
    expect(HANDLE_SIGN_UP).toMatch(/if \(!firstNameInput\.trim\(\) \|\| !lastNameInput\.trim\(\)\)/);
    expect(HANDLE_SIGN_UP).not.toMatch(/educationStatus[\s\S]{0,40}return;/);
    expect(HANDLE_SIGN_UP).not.toMatch(/universityInput[\s\S]{0,40}return;/);
    expect(HANDLE_SIGN_UP).not.toMatch(/degreeInput[\s\S]{0,40}return;/);
  });

  it("nothing anywhere in the app requires a university to proceed", () => {
    // no guard clause / early-return keyed on the profile's education fields
    expect(SRC).not.toMatch(/if \(!\w*[Uu]niversity\b[\s\S]{0,40}return/);
    expect(SRC).not.toMatch(/attends_university[\s\S]{0,40}(return;|throw )/);
  });
});

/* ---------------------------------------------------------------- *
 * 4. Storage: signup metadata -> write-once profile backfill
 * ---------------------------------------------------------------- */
describe("education is stored on the profile the same way the reference code is", () => {
  it("handleSignUp maps the toggle to attends_university (true / false / null) and only sends set values", () => {
    expect(HANDLE_SIGN_UP).toMatch(/educationStatus === "university" \? true/);
    expect(HANDLE_SIGN_UP).toMatch(/educationStatus === "not_university" \? false/);
    expect(HANDLE_SIGN_UP).toMatch(/: null;/);
    // university/degree only captured when the user actually attends, capped in length, sanitised
    expect(HANDLE_SIGN_UP).toMatch(/attendsUniversity === true \? sanitizeText\(universityInput\.trim\(\)\)\.slice\(0, 200\)/);
    expect(HANDLE_SIGN_UP).toMatch(/attendsUniversity === true \? sanitizeText\(degreeInput\.trim\(\)\)\.slice\(0, 200\)/);
    expect(HANDLE_SIGN_UP).toMatch(/\.\.\.\(attendsUniversity !== null \? \{ attends_university: attendsUniversity \} : \{\}\)/);
    expect(HANDLE_SIGN_UP).toMatch(/\.\.\.\(cleanUniversity \? \{ university: cleanUniversity \} : \{\}\)/);
    expect(HANDLE_SIGN_UP).toMatch(/\.\.\.\(cleanDegree \? \{ degree: cleanDegree \} : \{\}\)/);
  });

  it("onAuthed backfills education from signup metadata write-once, never overwriting an existing value", () => {
    expect(ON_AUTHED).toMatch(/const metaAttendsUniversity = authUser\.user_metadata\?\.attends_university/);
    expect(ON_AUTHED).toMatch(/const metaUniversity = authUser\.user_metadata\?\.university/);
    expect(ON_AUTHED).toMatch(/const metaDegree = authUser\.user_metadata\?\.degree/);
    expect(ON_AUTHED).toMatch(/p\?\.attends_university == null && metaAttendsUniversity != null \? \{ attends_university: metaAttendsUniversity \}/);
    expect(ON_AUTHED).toMatch(/!p\?\.university && metaUniversity \? \{ university: metaUniversity \}/);
    expect(ON_AUTHED).toMatch(/!p\?\.degree && metaDegree \? \{ degree: metaDegree \}/);
    // still one single profiles.update, still keyed to the caller's own id
    expect(ON_AUTHED).toMatch(/\.from\("profiles"\)\.update\(\{[\s\S]*\}\)\.eq\("id", authUser\.id\)/);
  });

  it("introduces no institutional-lookup / normalisation / rewards logic — storage only", () => {
    const block = HANDLE_SIGN_UP + ON_AUTHED;
    expect(block).not.toMatch(/normaliz|canonical|institutionLookup|lookupUniversity|ucas|hesa|reward\(|discount\(/i);
  });
});

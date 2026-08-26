/* ================================================================== *
 * PHASE 8 — INTERVIEW INVITATION SCANNER: OPTIONAL LIVE EVALUATION
 * ------------------------------------------------------------------
 * §17/§18: this file is picked up by the NORMAL `npm test` (vitest's
 * default include is every *.test.js file), but every test inside is
 * SKIPPED unless RUN_LIVE_INVITATION_EVAL=1 is set — so `npm test` never
 * makes a network/AI call, never needs credentials, and never gets slower
 * because this file exists. It is deliberately a single test file, not a
 * separate vitest config, since vitest is already this repo's only
 * JSX-aware runtime — reusing it here (rather than adding a new devDependency
 * or a hand-rolled JSX loader) is the natural fit, not unnecessary complexity.
 *
 * Run it for real with:
 *   npm run evaluate:interview-invitations
 * which sets RUN_LIVE_INVITATION_EVAL=1 and requires two more env vars
 * (INVITATION_EVAL_EMAIL / INVITATION_EVAL_PASSWORD — a real Supabase user
 * for this project) so it can authenticate. No API key of any kind is ever
 * hardcoded, logged, or committed — only the two credential env var NAMES
 * live in this file. The Anthropic key itself is never available to this
 * script or any client code; it lives only in the deployed Supabase Edge
 * Function's own server-side secrets, exactly as in production.
 *
 * This calls the REAL buildInvitationExtractionPrompt + the REAL deployed
 * "ai-generate" Edge Function + the REAL validateInvitationExtraction — the
 * full genuine extraction path, not a re-implementation of it. The only
 * code duplicated here is the minimal HTTP transport (auth + a fetch to the
 * Edge Function URL) that callClaude() also does internally — App.jsx
 * doesn't export callClaude/getSupabase (they're wired to browser-only
 * supabase-js loaded from a <script> tag), so a thin, transport-only
 * fetch() call is the pragmatic way to reach the same real endpoint from a
 * plain Node test run, per §18 ("if the current architecture makes this
 * unnecessarily complex, do not force it").
 * ================================================================== */
import { describe, it, expect, beforeAll } from "vitest";
import {
  validateInvitationExtraction, invitationExtractionHasUsableSignal,
  buildInvitationExtractionPrompt, INTERVIEW_FORMATS,
} from "./App.jsx";
import { isKnowledgeLayerApplicable, resolveKnowledgeDomain, KNOWLEDGE_DOMAINS } from "./interviewKnowledge.js";
import {
  loadAllInvitationFixtures, evaluateInvitationFixture,
  buildInvitationEvaluationReport, formatInvitationEvaluationReport,
} from "./invitationScannerEvaluation.js";

const LIVE_ENABLED = process.env.RUN_LIVE_INVITATION_EVAL === "1";
// Never hardcoded: both must come from the SAME env vars documented in .env.example
// (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) — this script refuses to run without them
// rather than falling back to any value baked into source.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

// Authenticates via Supabase's password grant and returns a short-lived access token.
// Never logs the password/token; never persists either anywhere.
async function getLiveAccessToken() {
  const email = process.env.INVITATION_EVAL_EMAIL;
  const password = process.env.INVITATION_EVAL_PASSWORD;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "RUN_LIVE_INVITATION_EVAL=1 was set but VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing. " +
      "Set both (see .env.example) to point at the Supabase project to evaluate against."
    );
  }
  if (!email || !password) {
    throw new Error(
      "RUN_LIVE_INVITATION_EVAL=1 was set but INVITATION_EVAL_EMAIL / INVITATION_EVAL_PASSWORD are missing. " +
      "Set both to a real Supabase user's credentials for this project to run the live evaluation."
    );
  }
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Live evaluation sign-in failed (HTTP ${res.status}). Check INVITATION_EVAL_EMAIL/PASSWORD.`);
  const data = await res.json();
  if (!data?.access_token) throw new Error("Live evaluation sign-in did not return an access token.");
  return data.access_token;
}

// Same transport contract as App.jsx's callClaude(): calls the real deployed "ai-generate"
// Edge Function and parses its JSON content, stripping any markdown fences. Never sends
// useWebSearch (this feature never uses web search) and always passes requestType so the
// Edge Function's own logging/rate-limiting can distinguish this traffic like any other.
async function liveCallClaude(accessToken, system, userText, maxTokens = 1600) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ system, userText, maxTokens, useWebSearch: false, requestType: "invitation_extraction_live_eval" }),
  });
  if (!res.ok) throw new Error(`ai-generate returned HTTP ${res.status}`);
  const data = await res.json();
  const text = (data?.content || []).map((b) => b.text || "").join("\n");
  const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse the live AI response as JSON.");
  }
}

describe.skipIf(!LIVE_ENABLED)("LIVE interview invitation evaluation (real AI calls — opt-in only)", () => {
  let accessToken;

  beforeAll(async () => {
    accessToken = await getLiveAccessToken();
  }, 30000);

  it(
    "runs the full 20-fixture corpus through the REAL extraction endpoint and prints an evaluation report",
    async () => {
      const fixtures = loadAllInvitationFixtures();
      const evaluations = [];
      for (const fixture of fixtures) {
        const { system, userText } = buildInvitationExtractionPrompt(fixture.emailText);
        let validated;
        try {
          const raw = await liveCallClaude(accessToken, system, userText);
          validated = validateInvitationExtraction(raw);
        } catch (e) {
          // A live network/AI failure for one fixture must not abort the whole run — it is
          // reported as a FAIL with a clear reason, exactly like a bad extraction would be.
          validated = validateInvitationExtraction({});
          evaluations.push({ id: fixture.id, sector: fixture.expected.sector, verdict: "FAIL", identity: [], config: [], logistics: [], content: { verdict: "FAIL", missing: [], hallucinated: [] }, reasons: [`live call failed: ${e.message}`] });
          continue;
        }
        evaluations.push(evaluateInvitationFixture(fixture, validated));

        // Structural invariants that must hold even under genuine model variance — a live
        // regression here is a serious, real bug, never just AI wording variance, so these are
        // hard assertions rather than part of the informational pass-rate report below.
        const pipeline = INTERVIEW_FORMATS[validated.format]?.pipeline;
        if (pipeline === "independent_batch") {
          const anyDomain = KNOWLEDGE_DOMAINS.find((d) => d.id === fixture.expected.knowledgeDomainId) || null;
          expect(isKnowledgeLayerApplicable({ pipeline, category: "technical_functional", domain: anyDomain }), `${fixture.id}: HireVue/batch must never activate the Knowledge Layer`).toBe(false);
        }
      }

      const report = buildInvitationEvaluationReport(evaluations);
      // eslint-disable-next-line no-console
      console.log(formatInvitationEvaluationReport(report));

      // Informational only: a live run surfaces real AI regressions for a human to read in the
      // report above. We do not hard-fail the whole command on an individual fixture's verdict
      // (real model output legitimately varies run to run) — but we DO assert the run actually
      // exercised the full corpus and never silently skipped fixtures.
      expect(report.total).toBe(fixtures.length);
    },
    120000
  );
});

describe.skipIf(LIVE_ENABLED)("LIVE interview invitation evaluation — disabled by default", () => {
  it("is skipped under the normal test suite (no network call, no credentials needed)", () => {
    expect(LIVE_ENABLED).toBe(false);
  });
});

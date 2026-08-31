/* ==================================================================== *
 * JOB.READY — PRIVACY POLICY (structured content)
 * -------------------------------------------------------------------- *
 * Every claim below was written against the actual repository:
 *   - Supabase Auth (email + password only; password reset by email;
 *     no third-party / social sign-in) — src/App.jsx, src/authForms.js
 *   - Supabase Postgres tables + private "documents" storage bucket —
 *     supabase/migrations/*.sql
 *   - AI via the authenticated Supabase Edge Function "ai-generate",
 *     which calls the Anthropic API server-side (the API key never
 *     reaches the browser) — supabase/functions/ai-generate/index.ts
 *   - Front-end static assets from Google Fonts, jsDelivr and cdnjs;
 *     hosting on Vercel — src/App.jsx, README.md, vercel.json
 *   - Session token kept in the browser's local storage by supabase-js
 *     (persistSession: true); no cookies set by the app; no analytics,
 *     advertising or tracking code anywhere in the repo.
 *
 * Nothing here describes a data practice the code does not perform. Where
 * the product does not yet support something (self-service account
 * deletion or data export), the policy says so plainly.
 *
 * This is a professionally structured draft. It has NOT been reviewed by
 * a qualified lawyer; independent legal review is recommended before
 * commercial launch (see the Phase 30 report).
 * ==================================================================== */

import { LEGAL_CONTACT, legalContactBlurb } from "./legalContact.js";

const P = LEGAL_CONTACT.productName;

export const PRIVACY_POLICY = {
  id: "privacy",
  title: "Privacy Policy",
  subtitle: `How ${P} handles your personal information.`,
  sections: [
    {
      id: "introduction",
      heading: "1. Introduction",
      paragraphs: [
        `This Privacy Policy explains how ${P} ("we", "us") collects, uses and protects personal information when you use ${P} — a career-preparation platform that helps you practise for interviews, organise the roles you are applying for, and develop the areas an interview would test.`,
        `It applies to everyone who creates a ${P} account and uses the application. ${P} is operated from the ${LEGAL_CONTACT.operatingCountry} and is intended to comply with the UK GDPR and the Data Protection Act 2018.`,
        `Please read this alongside our Terms of Service, which govern your use of ${P}.`,
      ],
    },
    {
      id: "information-we-collect",
      heading: "2. Information we collect",
      paragraphs: [
        `We only collect information you give us or that is created as you use the features you choose. In practice this includes:`,
      ],
      list: [
        "Account information — your first name, last name and email address. Authentication and your password are handled by our authentication provider (Supabase Auth); we do not see or store your password ourselves.",
        "Application information — the companies, roles, job descriptions or pasted job-advert text and context you add, and any planned interview stage, format, length or date you record.",
        "CV and career documents — files you upload as a CV or supporting document (plain text, PDF or Word/DOCX) and the text extracted from them. PDF and DOCX text extraction happens in your browser; the file and its extracted text are then stored in a private, per-account storage area.",
        "Interview and practice content — the answers you type during practice interviews, the questions generated for you, the per-answer and overall evaluations and scores produced for those answers, and the interview reports and written feedback.",
        "Assessment Centre content — the submissions you type for practice exercises (for example case studies, written tasks or presentations) and the resulting scorecards.",
        "Learning content — the development topics identified for you, the AI-generated lessons and development modules built from them, and your quiz and written-check answers and scores.",
        "Progress and profile insights — aggregated views of your strengths, focus areas and interview style (“Interview DNA”); your competency scores over time; “Interview Memory”, which keeps past questions together with the answer you gave and the score, so the app can show whether you have improved on a similar question; and “career claims” derived from your CV or interview answers.",
        "Technical and authentication information — a login session token stored in your browser's local storage to keep you signed in, and a per-account record of how many AI requests you have made, of what type, and the number of tokens used. That usage record is used for fair-use rate limiting and to understand operating costs; it does not contain the content of your requests.",
      ],
      trailing: [
        `${P} does not ask for special category data (such as health, ethnicity or political opinions). If you include such information in free-text fields or uploaded documents, it is processed only as part of the content you submitted — please avoid submitting anything that is not necessary for the preparation task.`,
      ],
    },
    {
      id: "how-we-use",
      heading: "3. How we use information",
      paragraphs: [
        "We use the information above to:",
      ],
      list: [
        "provide and operate the platform and your account;",
        "generate role-specific interview questions and adapt them based on how you answer;",
        "evaluate your answers and produce reports, scores and feedback;",
        "track your progress and maintain your Interview DNA, competency history and Interview Memory;",
        "identify development areas and generate learning recommendations, lessons and modules;",
        "apply fair-use rate limits and protect the service against misuse;",
        "keep the service reliable and secure and diagnose technical problems; and",
        "respond to your questions and any requests you make about your information.",
      ],
    },
    {
      id: "ai-processing",
      heading: "4. AI processing",
      paragraphs: [
        `${P} uses artificial intelligence to provide several of its core features: generating interview questions, evaluating answers, producing reports and feedback, extracting structured details from job descriptions and interview invitations, and building learning content.`,
        `To do this, relevant content you provide is sent to a third-party AI provider (Anthropic) and the generated output is returned to ${P}. The request is made by a ${P} server component; the AI provider's credentials are never exposed to your browser. Depending on the feature, the content sent may include job descriptions and application details, text extracted from your CV, the answers you give in practice interviews and assessment exercises, and career claims derived from those sources. Some requests may also use the AI provider's web-search tool to look up publicly available information about a company or role.`,
        "Please do not submit personal information — your own or anyone else's — or third-party confidential or proprietary material that is not necessary for the preparation task.",
        "AI-generated output, including questions, scores, evaluations, feedback and lessons, can be inaccurate, incomplete or out of date. Treat it as practice guidance, not a definitive or predictive assessment, and apply your own judgement before relying on it.",
        `Beyond the way we integrate their service, we do not control how the AI provider processes requests. Please refer to the AI provider's own terms and privacy information for details of how they handle data sent to their API.`,
      ],
    },
    {
      id: "legal-bases",
      heading: "5. Legal bases for processing",
      paragraphs: [
        "Where the UK GDPR applies, we rely on the following legal bases:",
      ],
      list: [
        "Performance of a contract (Article 6(1)(b)) — creating and maintaining your account and providing the features you ask for.",
        "Legitimate interests (Article 6(1)(f)) — keeping the service secure and reliable, preventing abuse, enforcing fair-use limits, and improving stability. We balance these interests against your rights and freedoms.",
        "Consent (Article 6(1)(a)) — where we ever rely on your consent for optional processing. You can withdraw consent at any time.",
        "Legal obligation (Article 6(1)(c)) — complying with applicable law and responding to lawful requests.",
      ],
    },
    {
      id: "storage",
      heading: "6. How your information is stored",
      paragraphs: [
        "Your account and application data is held in a hosted PostgreSQL database provided by Supabase. Documents you upload are held in a private, per-account storage area provided by Supabase. The application itself is hosted on Vercel.",
        "Access to your database rows and stored files is restricted by per-account access rules (row-level security), so each account can only reach its own data. Traffic between your browser and our providers uses HTTPS.",
        "We do not hold any specific security certification and do not claim one. We apply reasonable technical and organisational measures appropriate to the nature of the data (see “Security” below).",
      ],
    },
    {
      id: "sharing",
      heading: "7. Sharing your information",
      paragraphs: [
        `We share information only with the service providers needed to operate ${P}:`,
      ],
      list: [
        "Supabase — authentication, database, file storage and the serverless function that makes AI requests.",
        "Vercel — application hosting and delivery.",
        "Anthropic — AI generation and evaluation, called by our server component as described in section 4.",
        "Content delivery networks (Google Fonts, jsDelivr and Cloudflare/cdnjs) — these serve fonts and front-end libraries to your browser and, as a normal part of serving a request, receive your IP address and basic request information.",
      ],
      trailing: [
        `We do not sell your personal information and we do not share it for advertising. We may disclose information where required by law, or where necessary to establish, exercise or defend legal claims, or to protect the rights, property or safety of ${P}, our users or others.`,
      ],
    },
    {
      id: "international-transfers",
      heading: "8. International transfers",
      paragraphs: [
        `Some of the providers and infrastructure used to run ${P} may process information outside the ${LEGAL_CONTACT.operatingCountry}. Where personal information is transferred outside the UK, we rely on the transfer mechanisms available under UK data protection law — for example UK adequacy regulations, or the International Data Transfer Agreement or the UK Addendum to the EU Standard Contractual Clauses — as applicable to each provider.`,
        `We cannot promise that your information will remain exclusively within the UK.`,
      ],
    },
    {
      id: "retention",
      heading: "9. Data retention",
      paragraphs: [
        `We keep your account and the information associated with it for as long as your ${P} account exists.`,
        `${P} does not currently provide a way to delete your account, or to export your data, from within the application. If you want your account and its associated data deleted, or a copy of your data, contact us using the details in the “Contact” section and we will action your request. When an account is deleted, associated database records are removed; related backups and any records we are required to keep by law may be retained for a limited additional period before being deleted or anonymised.`,
      ],
    },
    {
      id: "your-rights",
      heading: "10. Your rights",
      paragraphs: [
        "Under the UK GDPR you have the right to:",
      ],
      list: [
        "access — ask for a copy of the personal information we hold about you;",
        "rectification — ask us to correct information that is inaccurate or incomplete;",
        "erasure — ask us to delete your personal information in certain circumstances;",
        "restriction — ask us to limit how we use your information in certain circumstances;",
        "objection — object to processing we carry out on the basis of legitimate interests;",
        "portability — ask for certain information in a portable, machine-readable format;",
        "withdraw consent — where our processing is based on your consent; and",
        "complain — lodge a complaint with the Information Commissioner's Office (ico.org.uk).",
      ],
      trailing: [
        "Because self-service tools for these requests are not built into the application yet, we handle them manually. Contact us using the details below and we will respond within the timeframe required by law (normally one month).",
      ],
    },
    {
      id: "security",
      heading: "11. Security",
      paragraphs: [
        "We take reasonable technical and organisational measures designed to protect personal information — including per-account data isolation, authenticated server-side handling of AI requests, and encryption of data in transit (HTTPS).",
        "No method of transmission or storage is completely secure, and we cannot guarantee absolute security. If we become aware of a personal data breach that is likely to result in a risk to your rights and freedoms, we will notify the ICO and, where required, affected users, in line with our legal obligations.",
      ],
    },
    {
      id: "children",
      heading: "12. Children's privacy",
      paragraphs: [
        `${P} is intended for people preparing for jobs, internships and graduate schemes. It is not directed at children under 16, and we do not knowingly collect personal information from anyone under 16.`,
        "If you believe someone under 16 has provided us with personal information, please contact us and we will delete it.",
      ],
    },
    {
      id: "changes",
      heading: "13. Changes to this policy",
      paragraphs: [
        "We may update this Privacy Policy from time to time. When we do, we will change the “Last updated” date at the top of this page. If the changes are material, we will take reasonable steps to bring them to your attention, for example with an in-app notice.",
      ],
    },
    {
      id: "contact",
      heading: "14. Contact",
      paragraphs: legalContactBlurb(),
    },
  ],
};

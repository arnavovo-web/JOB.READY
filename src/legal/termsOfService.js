/* ==================================================================== *
 * JOB.READY — TERMS OF SERVICE (structured content)
 * -------------------------------------------------------------------- *
 * Written for JOB.READY specifically, against the actual feature set in
 * the repository (interview practice with AI-generated questions and
 * evaluation, application workspaces, Classroom learning content and
 * development modules, Assessment Centre practice, progress insights).
 *
 * The AI wording never promises an interview outcome, a job offer,
 * improved performance, or accurate evaluations. The user-content clause
 * is a limited processing licence, not an ownership transfer. The
 * limitation-of-liability clause is written for a UK consumer context:
 * it does not attempt a blanket US-style exclusion and expressly
 * preserves liability that cannot be excluded by law.
 *
 * This is a professionally structured draft. It has NOT been reviewed by
 * a qualified lawyer; independent legal review is recommended before
 * commercial launch (see the Phase 30 report).
 * ==================================================================== */

import { LEGAL_CONTACT, legalContactBlurb } from "./legalContact.js";

const P = LEGAL_CONTACT.productName;

export const TERMS_OF_SERVICE = {
  id: "terms",
  title: "Terms of Service",
  subtitle: `The agreement between you and ${P}.`,
  sections: [
    {
      id: "acceptance",
      heading: "1. Acceptance of these Terms",
      paragraphs: [
        `These Terms of Service ("Terms") govern your use of ${P}. By creating an account or using ${P}, you agree to these Terms and to our Privacy Policy. If you do not agree, do not use ${P}.`,
      ],
    },
    {
      id: "eligibility",
      heading: "2. Eligibility and your account",
      paragraphs: [
        `You must be at least 16 years old to use ${P}.`,
        "When you create an account you agree to provide accurate information and to keep it up to date. You are responsible for keeping your login credentials secure and for activity that takes place under your account. Accounts are for a single person; do not share your account.",
        "Tell us promptly if you believe your account has been accessed without your permission.",
      ],
    },
    {
      id: "service",
      heading: "3. What JOB.READY provides",
      paragraphs: [
        `${P} is a career-preparation platform. Depending on the features you use, it provides:`,
      ],
      list: [
        "interview preparation — role-specific practice interviews with AI-generated questions, adaptive and set-length practice formats, answer evaluation, and written reports;",
        "application workspaces — a place to record the companies and roles you are preparing for, add job descriptions and context, and see a suggested next step;",
        "Classroom — learning topics identified from your interviews and assessment practice, with AI-generated lessons and development modules;",
        "Assessment Centre — practice exercises such as case studies, written tasks, group exercises and presentations, with scorecards;",
        "progress insights — your Interview DNA, competency history, Interview Memory and career-claim tracking.",
      ],
      trailing: [
        "Features may be added, changed or removed over time.",
      ],
    },
    {
      id: "ai-features",
      heading: "4. AI-powered features",
      paragraphs: [
        `Several ${P} features generate content using artificial intelligence. That output is produced to support your preparation and learning.`,
        "AI-generated output — including questions, scores, evaluations, feedback and lessons — may contain errors, omissions or out-of-date information. Scores and evaluations are indicative practice feedback, not a professional, official or predictive assessment. You are responsible for reviewing AI-generated output and deciding how to use it.",
        `${P} does not guarantee any interview outcome, job offer, place on a scheme, improvement in your performance, or that its AI evaluations are accurate. ${P} is not a recruiter and is not affiliated with the companies or schemes you practise for.`,
      ],
    },
    {
      id: "user-content",
      heading: "5. Your content",
      paragraphs: [
        `"Your content" means the information you submit to ${P}, such as your CV text, interview and assessment answers, application details and the job descriptions you add.`,
        `You retain ownership of your content. You grant ${P} the permissions reasonably necessary to host, store, process and transmit your content — including sending relevant parts of it to our AI provider — solely to operate the features you use. This licence ends when the relevant content is deleted, except where we are required to retain it by law.`,
        "You confirm that you have the right to submit your content, that it does not infringe anyone else's rights or break the law, and that you will not submit:",
      ],
      list: [
        "personal information about other people that is not necessary for the preparation task;",
        "confidential or proprietary material belonging to a third party — for example an employer's confidential assessment materials, or a non-public document you are not permitted to share;",
        "unlawful, harmful, or deliberately misleading content.",
      ],
    },
    {
      id: "acceptable-use",
      heading: "6. Acceptable use",
      paragraphs: [
        "You agree not to:",
      ],
      list: [
        `use ${P} for any unlawful purpose or in breach of these Terms;`,
        `disrupt, overload, probe, or attempt to gain unauthorised access to ${P}, its infrastructure, or other users' accounts or data;`,
        "abuse, manipulate, or attempt to extract the underlying prompts or models behind the AI features, or circumvent rate limits;",
        "upload malicious code or content;",
        `misrepresent ${P} output as an official assessment, or use ${P} to deceive an employer or scheme.`,
      ],
    },
    {
      id: "ip",
      heading: "7. Intellectual property",
      paragraphs: [
        `The ${P} name, branding, user interface, and software are owned by us or our licensors and are protected by intellectual property law. These Terms do not give you any right to use ${P} branding except as needed to use the service normally.`,
        "AI-generated practice content is made available to you for your personal preparation use. Your own content remains yours (see section 5). Nothing in these Terms transfers ownership of your CV or career information to us.",
      ],
    },
    {
      id: "no-advice",
      heading: "8. No professional advice",
      paragraphs: [
        `${P} is a preparation and productivity tool. It does not provide legal, financial, immigration, employment-law or professional careers advice, and its output is not a substitute for advice from a qualified professional or for an employer's own recruitment process.`,
      ],
    },
    {
      id: "availability",
      heading: "9. Availability",
      paragraphs: [
        `${P} is provided on an "as available" basis. We may change, suspend or withdraw features, and planned maintenance or unplanned outages may occur. We do not guarantee that ${P} will be available uninterrupted or error-free.`,
      ],
    },
    {
      id: "termination",
      heading: "10. Suspension and termination",
      paragraphs: [
        `We may suspend or restrict your access to ${P}, or close your account, if you breach these Terms, misuse the service, or where we reasonably need to in order to protect ${P}, other users, or third parties.`,
        `You can stop using ${P} at any time. Deleting your account is currently handled on request — contact us, or see the Privacy Policy — because a self-service deletion tool is not yet available.`,
      ],
    },
    {
      id: "disclaimers",
      heading: "11. Disclaimers",
      paragraphs: [
        `To the fullest extent permitted by law, ${P} and its content are provided without warranties of any kind, whether express or implied. In particular, we do not warrant that AI-generated output, scores or feedback are accurate, complete, reliable or fit for any particular purpose.`,
        "Nothing in this section limits your rights under mandatory consumer protection law.",
      ],
    },
    {
      id: "liability",
      heading: "12. Limitation of liability",
      paragraphs: [
        "Nothing in these Terms excludes or limits our liability where it would be unlawful to do so. This includes liability for death or personal injury caused by our negligence, for fraud or fraudulent misrepresentation, and for any other liability that cannot be excluded or limited under applicable law (including under the Consumer Rights Act 2015).",
        `Subject to the paragraph above, and to the extent permitted by law, ${P} is not liable for: loss of opportunity, loss of an interview, job offer or place on a scheme; loss or corruption of data; loss of profit, revenue or anticipated savings; or any indirect or consequential loss. In particular, ${P} is not liable for any decision you make, or outcome you experience, based on AI-generated output.`,
        `Where ${P} is provided to you free of charge, our total liability to you arising out of or in connection with the service is limited to the maximum extent permitted by law.`,
      ],
    },
    {
      id: "changes",
      heading: "13. Changes to these Terms",
      paragraphs: [
        `We may update these Terms from time to time. We will change the "Last updated" date on this page, and for material changes we will take reasonable steps to notify you — for example with an in-app notice. Continuing to use ${P} after changes take effect means you accept the updated Terms. If you do not agree, stop using the service.`,
      ],
    },
    {
      id: "governing-law",
      heading: "14. Governing law",
      paragraphs: [
        `${P} is operated from the ${LEGAL_CONTACT.operatingCountry}. These Terms, and any dispute or claim arising out of or in connection with them, are governed by the laws of England and Wales. The courts of England and Wales have non-exclusive jurisdiction, and nothing in this section affects any mandatory rights you have as a consumer under the law of your country of residence.`,
      ],
    },
    {
      id: "contact",
      heading: "15. Contact",
      paragraphs: legalContactBlurb(),
    },
  ],
};

/* ==================================================================== *
 * JOB.READY — CENTRAL LEGAL CONTACT / METADATA
 * -------------------------------------------------------------------- *
 * Single source of truth for the identity and contact details used by
 * the Privacy Policy and the Terms of Service.
 *
 * ⚠️  PRE-LAUNCH: the fields set to `null` below have NOT been confirmed
 * for JOB.READY. No legal entity name, registered address, company
 * number, ICO registration or contact email exists in the repository,
 * so none is asserted here or shown to users. Fill these in (and review
 * the effective date) before JOB.READY is made generally available.
 * The policy pages render a clearly-worded placeholder wherever a real
 * value is missing — see `legalContactBlurb()` below.
 * ==================================================================== */

export const LEGAL_CONTACT = {
  productName: "JOB.READY",

  // --- NOT YET CONFIRMED — replace before public launch ---------------
  legalEntityName: null,        // e.g. "JOB.READY Ltd"
  registeredAddress: null,      // full registered office address
  companyNumber: null,          // Companies House number, if incorporated
  icoRegistrationNumber: null,  // ICO data-protection fee registration (assessment pending)
  privacyContactEmail: null,    // e.g. "privacy@jobready.example"
  supportContactEmail: null,    // e.g. "support@jobready.example"
  // ------------------------------------------------------------------

  // Operating context — used for the governing-law / UK GDPR framing.
  operatingCountry: "United Kingdom",
  supervisoryAuthority: {
    name: "Information Commissioner's Office (ICO)",
    website: "https://ico.org.uk",
  },
};

// The single date shown as "Last updated" on both legal pages. Bump this
// whenever the wording of either document changes.
export const LEGAL_EFFECTIVE_DATE = "2026-08-31";

/** "31 August 2026" from an ISO yyyy-mm-dd string (no locale dependency). */
export function formatLegalDate(iso = LEGAL_EFFECTIVE_DATE) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  const months = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * True when at least one real contact route (a confirmed email) is set.
 * When false, the policy pages must not render an empty address — they
 * fall back to `legalContactBlurb()`.
 */
export function hasResolvedLegalContact() {
  return Boolean(LEGAL_CONTACT.privacyContactEmail || LEGAL_CONTACT.supportContactEmail);
}

/**
 * The paragraph(s) rendered in the "Contact" section of each policy.
 * If a real email exists it is used; otherwise a clearly identifiable
 * placeholder is returned so nothing false or empty is shown to users.
 */
export function legalContactBlurb() {
  if (hasResolvedLegalContact()) {
    const email = LEGAL_CONTACT.privacyContactEmail || LEGAL_CONTACT.supportContactEmail;
    const lines = [
      `If you have questions about this document, or you want to make a data protection request (including access, correction or deletion), contact ${LEGAL_CONTACT.productName} at ${email}.`,
    ];
    if (LEGAL_CONTACT.legalEntityName || LEGAL_CONTACT.registeredAddress) {
      lines.push([LEGAL_CONTACT.legalEntityName, LEGAL_CONTACT.registeredAddress]
        .filter(Boolean).join(", "));
    }
    return lines;
  }
  return [
    `${LEGAL_CONTACT.productName} is being prepared for launch. A dedicated address for privacy, legal and data protection enquiries — and the details of the entity that operates ${LEGAL_CONTACT.productName} — will be published here before the service is made generally available.`,
    `Until then, please raise any question or data protection request (including access to, correction of, or deletion of your information) through the same channel you used to obtain access to ${LEGAL_CONTACT.productName}. We will handle each request manually and respond within the timeframe required by applicable law.`,
  ];
}
